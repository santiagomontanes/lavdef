import { BrowserWindow } from 'electron';
import { diagnosticLogger } from './diagnostic-logger.js';

export type PrinterInfo = {
  name: string;
  isDefault: boolean;
  status: number;
};

export type PrintCopyInput = {
  /** 'customer' | 'internal' | cualquier etiqueta usada solo para el log. */
  document?: string;
  copyIndex?: number;
  copiesTotal?: number;
  printerName?: string | null;
};

const ESC = 0x1b;

// ESC p m t1 t2
const CASH_DRAWER_PULSE = Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);

const WINDOWS_ONLY_HARDWARE_MESSAGE =
  'Esta funcionalidad requiere hardware (impresora, lector QR, cajón de dinero) que solo está disponible en Windows. En macOS no podrás usar estas funciones. El resto de la aplicación funciona con normalidad.';

// Pausa entre copias de la impresión reforzada. Se deja en 0 a propósito:
// cada trabajo espera la confirmación del spooler antes de enviar el
// siguiente, así que no hace falta un retardo artificial. Si algún driver
// térmico llegara a fusionar trabajos consecutivos, subir a 200-500.
const COPY_INTERVAL_MS = 0;

class PrinterService {
  // Un solo trabajo de impresión a la vez por proceso. Electron rechaza
  // print() concurrentes sobre el mismo webContents y un doble clic no
  // debe poder duplicar los trabajos.
  private printing = false;

  private ensureHardwareSupported() {
    if (process.platform !== 'win32') {
      throw new Error(WINDOWS_ONLY_HARDWARE_MESSAGE);
    }
  }

  async listPrinters(): Promise<PrinterInfo[]> {
    this.ensureHardwareSupported();

    const win = BrowserWindow.getAllWindows()[0];

    if (!win) {
      throw new Error('No hay ventana activa para consultar impresoras.');
    }

    const printers = await win.webContents.getPrintersAsync();

    return printers.map((p) => ({
      name: p.name,
      isDefault: Boolean(p.isDefault),
      status: Number(p.status ?? 0)
    }));
  }

  /**
   * Envía UN solo trabajo de impresión (copies: 1) del contenido actual de
   * la ventana y resuelve cuando el spooler confirma el trabajo. La
   * repetición de copias la hace quien llama, un trabajo a la vez, para no
   * depender del parámetro "copias" del driver (que muchas impresoras
   * térmicas ignoran).
   *
   * No abre el cajón de dinero: eso sigue siendo responsabilidad exclusiva
   * de openDrawer().
   */
  async printCopy(webContents: Electron.WebContents, input: PrintCopyInput = {}) {
    this.ensureHardwareSupported();

    if (!webContents || webContents.isDestroyed()) {
      throw new Error('La ventana de impresión ya no está disponible.');
    }

    if (this.printing) {
      throw new Error('Ya hay una impresión en curso. Espera a que termine.');
    }

    const document = String(input.document ?? 'documento');
    const copyIndex = Number(input.copyIndex ?? 1);
    const copiesTotal = Number(input.copiesTotal ?? 1);
    const label = `copy=${copyIndex}/${copiesTotal} document=${document}`;

    const requestedPrinter = String(input.printerName ?? '').trim();
    let deviceName = '';

    if (requestedPrinter) {
      const printers = await webContents.getPrintersAsync();
      const match = printers.find((p) => p.name === requestedPrinter);
      if (!match) {
        throw new Error(
          `La impresora configurada ("${requestedPrinter}") no está disponible en Windows.`
        );
      }
      deviceName = match.name;
    }

    this.printing = true;
    diagnosticLogger.info('print', `${label} started`, {
      printer: deviceName || '(predeterminada)'
    });

    try {
      await new Promise<void>((resolve, reject) => {
        webContents.print(
          {
            silent: true,
            printBackground: true,
            // Siempre 1: las copias se repiten desde la aplicación.
            copies: 1,
            margins: { marginType: 'none' },
            ...(deviceName ? { deviceName } : {})
          },
          (success: boolean, failureReason: string) => {
            if (success) {
              resolve();
              return;
            }
            reject(new Error(failureReason || 'La impresora rechazó el trabajo.'));
          }
        );
      });

      diagnosticLogger.info('print', `${label} success`);

      if (COPY_INTERVAL_MS > 0 && copyIndex < copiesTotal) {
        await new Promise((resolve) => setTimeout(resolve, COPY_INTERVAL_MS));
      }

      return {
        success: true as const,
        document,
        copyIndex,
        copiesTotal,
        printerName: deviceName || null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnosticLogger.error('print', `${label} failed: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      this.printing = false;
    }
  }

  async openDrawer(printerName?: string) {
    this.ensureHardwareSupported();

    const printers = await this.listPrinters();
    let printer: any;
    try {
      const printerModule = await import('@alexssmusica/node-printer');
      printer = printerModule.default;
    } catch (error) {
      throw new Error(
        `No fue posible cargar el módulo nativo de impresión (@alexssmusica/node-printer). ${
          error instanceof Error ? error.message : ''
        }`.trim()
      );
    }

    const selected =
      printerName?.trim()
        ? printers.find((p) => p.name === printerName.trim())
        : printers.find((p) => p.isDefault) ?? printers[0];

    if (!selected) {
      throw new Error('No se encontró ninguna impresora.');
    }

    await new Promise<void>((resolve, reject) => {
      printer.printDirect({
        printer: selected.name,
        data: CASH_DRAWER_PULSE,
        type: 'RAW',
        success: () => resolve(),
        error: (err: Error | string) =>
          reject(err instanceof Error ? err : new Error(String(err)))
      });
    });

    return {
      success: true,
      printerName: selected.name,
      message: `Cajón abierto por la impresora: ${selected.name}`
    };
  }
}

export const printerService = new PrinterService();

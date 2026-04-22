import { BrowserWindow } from 'electron';

export type PrinterInfo = {
  name: string;
  isDefault: boolean;
  status: number;
};

const ESC = 0x1b;

// ESC p m t1 t2
const CASH_DRAWER_PULSE = Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);

const WINDOWS_ONLY_HARDWARE_MESSAGE =
  'Esta funcionalidad requiere hardware (impresora, lector QR, cajón de dinero) que solo está disponible en Windows. En macOS no podrás usar estas funciones. El resto de la aplicación funciona con normalidad.';

class PrinterService {
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

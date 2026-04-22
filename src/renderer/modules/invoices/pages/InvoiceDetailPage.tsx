import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { Button, PageHeader } from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';
import { Barcode } from '@renderer/ui/components/Barcode';
import { showToast } from '@renderer/utils/toast';
import type { SessionUser } from '@shared/types';

const renderValue = (value?: string | null) => {
  const text = String(value ?? '').trim();
  return text ? text : '—';
};

const renderDateOnly = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-CO');
};

const localDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeBarcode = (value?: string | number | null) =>
  String(value ?? '')
    .replace(/[–—−]/g, '-')
    .replace(/"/g, '-')
    .replace(/'/g, '-')
    .trim()
    .toUpperCase();

export const InvoiceDetailPage = ({ user }: { user: SessionUser }) => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [runningPdfAction, setRunningPdfAction] = useState(false);
  const autoSavedRef = useRef(false);
  const autoPrintedRef = useRef(false);

  const shouldAutoPrint = searchParams.get('autoPrint') === '1';
  const shouldAutoSave = searchParams.get('autoSave') !== '0';
  const numericOrderId = Number(orderId);

  const { data: pdfOutputDir } = useQuery({
    queryKey: ['pdf-output-dir'],
    queryFn: async () => {
      try {
        return await api.getPdfOutputDir();
      } catch {
        return null;
      }
    }
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['invoice-from-order', orderId],
    queryFn: async () => api.createInvoiceFromOrder(numericOrderId),
    enabled: Number.isFinite(numericOrderId) && numericOrderId > 0,
    retry: 0
  });

  const barcodeValue = useMemo(
    () => normalizeBarcode(data?.orderNumber || data?.ticketCode || data?.orderId),
    [data?.orderNumber, data?.ticketCode, data?.orderId]
  );

  const normalizedPhone = String(data?.clientPhone ?? '').replace(/\D/g, '');
  const saveSubfolder = `Facturas generadas/${localDateKey(new Date())}`;
  const pdfFileName = data ? `Factura-${data.orderNumber}.pdf` : 'factura.pdf';

  const generatePdf = async () => {
    if (!data) {
      throw new Error('No hay datos de la factura.');
    }

    return api.printToPdfAuto({
      defaultFileName: pdfFileName,
      targetDir: pdfOutputDir ?? null,
      subfolder: saveSubfolder,
      pageSize: 'A4',
      landscape: false,
      preferCssPageSize: false
    });
  };

  const handleSavePdf = async () => {
    try {
      setRunningPdfAction(true);
      const result = await generatePdf();
      if (result.saved) {
        showToast(`PDF guardado${result.path ? `: ${result.path}` : ''}`, 'success');
      }
    } catch (saveError) {
      showToast(
        saveError instanceof Error ? saveError.message : 'No fue posible generar el PDF.',
        'error'
      );
    } finally {
      setRunningPdfAction(false);
    }
  };

  const handlePrint = async () => {
    try {
      setRunningPdfAction(true);
      const result = await generatePdf();
      if (result.saved) {
        window.setTimeout(() => window.print(), 150);
      }
    } catch (printError) {
      showToast(
        printError instanceof Error ? printError.message : 'No fue posible imprimir la factura.',
        'error'
      );
    } finally {
      setRunningPdfAction(false);
    }
  };

  const handleWhatsapp = async () => {
    if (!data) return;
    if (!normalizedPhone) {
      showToast('El cliente no tiene teléfono válido para WhatsApp.', 'error');
      return;
    }

    const withCountryCode = normalizedPhone.startsWith('57') ? normalizedPhone : `57${normalizedPhone}`;
    const url = `https://wa.me/${withCountryCode}?text=${encodeURIComponent(data.whatsappMessage)}`;
    await api.openExternal(url);
  };

  useEffect(() => {
    if (!data || !shouldAutoSave || shouldAutoPrint || autoSavedRef.current) return;
    autoSavedRef.current = true;

    void generatePdf().catch((saveError) => {
      console.error('No fue posible autoguardar la factura en PDF:', saveError);
    });
  }, [data, shouldAutoSave, shouldAutoPrint, pdfOutputDir]);

  useEffect(() => {
    if (!data || !shouldAutoPrint || autoPrintedRef.current) return;
    autoPrintedRef.current = true;

    let cancelled = false;
    const run = async () => {
      try {
        await generatePdf();
        autoSavedRef.current = true;
        if (!cancelled) {
          window.setTimeout(() => window.print(), 180);
        }
      } catch (printError) {
        console.error('No fue posible preparar la impresión automática:', printError);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [data, shouldAutoPrint, pdfOutputDir]);

  if (isLoading) {
    return <div className="card-panel">Cargando factura...</div>;
  }

  if (isError || !data) {
    return (
      <div className="card-panel">
        <p className="error-text">
          {(error as Error)?.message || 'No fue posible generar la factura.'}
        </p>
      </div>
    );
  }

  return (
    <section className="stack-gap invoice-page">
      <div className="no-print">
        <PageHeader
          title={`Factura ${data.invoiceNumber}`}
          subtitle={`Orden ${data.orderNumber} · Cliente: ${data.clientName}`}
          actions={
            <div className="row-actions no-print">
              <Button variant="secondary" onClick={() => navigate(`/ordenes/${orderId}`)}>
                Volver
              </Button>
              <Button variant="secondary" onClick={handleWhatsapp}>
                Enviar por WhatsApp
              </Button>
              <Button
                variant="secondary"
                onClick={handleSavePdf}
                disabled={runningPdfAction}
              >
                {runningPdfAction ? 'Generando PDF...' : 'Guardar PDF'}
              </Button>
              <Button onClick={handlePrint} disabled={runningPdfAction}>
                {runningPdfAction ? 'Preparando impresión...' : 'Imprimir'}
              </Button>
            </div>
          }
        />
      </div>

      <div className="thermal-invoice">
        <div className="thermal-header">
          {data.companyLogo ? (
            <img
              src={data.companyLogo}
              alt="Logo del negocio"
              className="thermal-logo"
            />
          ) : null}

          <h2>{renderValue(data.companyName)}</h2>
          {data.companyLegalName ? <p>{data.companyLegalName}</p> : null}
          {data.companyNit ? <p>NIT: {data.companyNit}</p> : null}
          {data.companyPhone ? <p>Tel: {data.companyPhone}</p> : null}
          {data.companyAddress ? <p>{data.companyAddress}</p> : null}
          {data.companyEmail ? <p>{data.companyEmail}</p> : null}
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <div className="thermal-order-row">
            <h3>Orden:</h3>
            <div className="thermal-order-number">{data.orderNumber}</div>
          </div>
          <p><strong>Fecha:</strong> {dateTime(data.createdAt)}</p>
          <p><strong>Fecha promesa:</strong> {renderDateOnly(data.dueDate)}</p>
          <p><strong>Estado:</strong> {Number(data.balanceDue) > 0 ? 'Con saldo' : 'Pagada'}</p>
          <p><strong>Generado por:</strong> {renderValue(user.displayName || user.username)}</p>
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <h3>Cliente</h3>
          <p><strong>Nombre:</strong> {data.clientName}</p>
          <p><strong>Teléfono:</strong> {renderValue(data.clientPhone)}</p>
          {data.notes ? <p><strong>Notas generales:</strong> {data.notes}</p> : null}
        </div>

        <div className="thermal-divider" />

        <div className="thermal-barcode">
          <p><strong>Código de barras</strong></p>
          <Barcode value={barcodeValue} height={64} width={2} displayValue={false} />
          <div className="thermal-barcode-text">{barcodeValue}</div>
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <h3>Notas por ítem</h3>
          {data.items.map((item, index) => (
            <div key={item.id} className="thermal-item">
              <div className="thermal-item-row thermal-item-title">
                <span>{index + 1}. {item.description}</span>
                <strong>{currency(item.total)}</strong>
              </div>
              <div className="thermal-item-row">
                <span>Cant: {item.quantity}</span>
                <span>Unit: {currency(item.unitPrice)}</span>
              </div>
              {(Number(item.discountAmount ?? 0) > 0 || Number(item.surchargeAmount ?? 0) > 0) ? (
                <div className="thermal-item-row">
                  <span>Desc: {currency(item.discountAmount)}</span>
                  <span>Rec: {currency(item.surchargeAmount)}</span>
                </div>
              ) : null}
              {String(item.customerObservations ?? '').trim() ? (
                <p className="thermal-item-note">
                  <strong>Obs:</strong> {item.customerObservations}
                </p>
              ) : (
                <p className="thermal-item-note thermal-muted">
                  Sin notas para este ítem.
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="thermal-divider" />

        <div className="thermal-totals">
          <div><span>Subtotal</span><strong>{currency(data.subtotal)}</strong></div>
          <div><span>Total</span><strong>{currency(data.total)}</strong></div>
          <div><span>Abonado</span><strong>{currency(data.paidTotal)}</strong></div>
          <div><span>Saldo</span><strong>{currency(data.balanceDue)}</strong></div>
        </div>

        {data.activeOrders.length > 0 ? (
          <>
            <div className="thermal-divider" />

            <div className="thermal-section">
              <h3>Órdenes pendientes por reclamar</h3>
              <p>
                Tienes <strong>{data.activeOrders.length}</strong> orden{data.activeOrders.length !== 1 ? 'es' : ''} pendiente{data.activeOrders.length !== 1 ? 's' : ''} con un total de <strong>{data.activeOrders.reduce((sum, o) => sum + o.itemsCount, 0)}</strong> prenda{data.activeOrders.reduce((sum, o) => sum + o.itemsCount, 0) !== 1 ? 's' : ''} por recoger.
              </p>
            </div>
          </>
        ) : null}

        <div className="thermal-divider" />

        <div className="thermal-section">
          <h3>Políticas</h3>
          <p>{data.companyPolicies || 'No hay políticas configuradas.'}</p>
          <p className="thermal-muted thermal-centered">Generada con LavaSuite, software desarrollado por SisteTecni.</p>
        </div>
      </div>

      <style>
        {`
          .thermal-invoice {
            width: 100%;
            max-width: 72mm;
            margin: 0 auto;
            padding: 3mm 2.5mm 4mm;
            box-sizing: border-box;
            background: #fff;
            color: #000;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 10px;
            line-height: 1.35;
          }

          .thermal-header,
          .thermal-barcode {
            text-align: center;
          }

          .thermal-header h2,
          .thermal-section h3 {
            margin: 0 0 4px;
          }

          .thermal-header p,
          .thermal-section p {
            margin: 2px 0;
            word-break: break-word;
          }

          .thermal-logo {
            width: 28mm;
            max-width: 100%;
            max-height: 22mm;
            object-fit: contain;
            margin: 0 auto 4px;
            display: block;
          }

          .thermal-divider {
            border-top: 1px dashed rgba(0, 0, 0, 0.85);
            margin: 8px 0;
          }

          .thermal-order-number-block {
            text-align: center;
            margin: 2px 0 6px;
          }

          .thermal-order-number-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            opacity: 0.8;
          }

          .thermal-order-number {
            font-size: 22px;
            line-height: 1.05;
            font-weight: 800;
            letter-spacing: 0.8px;
          }

          .thermal-order-row {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .thermal-order-row h3 {
            margin: 0;
            font-size: 14px;
          }

          .thermal-item {
            padding: 0 0 7px;
            margin-bottom: 7px;
            border-bottom: 1px dashed rgba(0, 0, 0, 0.2);
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .thermal-active-order:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: 0;
          }

          .thermal-item-row,
          .thermal-totals > div {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
          }

          .thermal-item-title {
            font-weight: 700;
          }

          .thermal-item-title span,
          .thermal-item-row span:first-child,
          .thermal-totals > div span {
            flex: 1;
            min-width: 0;
            word-break: break-word;
          }

          .thermal-item-note {
            margin-top: 4px;
            font-weight: 600;
          }

          .thermal-totals {
            display: grid;
            gap: 4px;
          }

          .thermal-barcode {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            width: 100%;
            overflow: hidden;
          }

          .thermal-barcode svg {
            display: block;
            width: 100%;
            height: auto;
          }

          .thermal-barcode-text {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1.4px;
            font-family: Consolas, 'Courier New', monospace;
            text-align: center;
            word-break: break-word;
          }

          .thermal-muted {
            color: #444;
          }

          .thermal-centered {
            text-align: center;
            font-weight: 600;
          }

          @media print {
            @page {
              size: 80mm auto;
              margin: 0;
            }

            html,
            body {
              width: 80mm !important;
              min-width: 0 !important;
              height: auto !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              overflow: visible !important;
            }

            #root,
            .app-shell,
            .page-content {
              width: 80mm !important;
              height: auto !important;
              min-height: 0 !important;
              overflow: visible !important;
              padding: 0 !important;
              margin: 0 !important;
              display: block !important;
            }

            .no-print {
              display: none !important;
            }

            .invoice-page {
              display: block !important;
              width: 80mm !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: visible !important;
            }

            .thermal-invoice {
              width: 80mm !important;
              max-width: 80mm !important;
              box-sizing: border-box !important;
              margin: 0 !important;
              padding: 4mm 4mm 20mm !important;
              overflow: visible !important;
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }

            .thermal-logo {
              filter: none !important;
            }

            .thermal-item,
            .thermal-section,
            .thermal-totals,
            .thermal-barcode {
              overflow: visible !important;
            }
          }
        `}
      </style>
    </section>
  );
};

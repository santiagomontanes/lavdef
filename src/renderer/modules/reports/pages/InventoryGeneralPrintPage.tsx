import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { Button, PageHeader } from '@renderer/ui/components';
import { showToast } from '@renderer/utils/toast';
import type { InventoryGeneralRow, SessionUser } from '@shared/types';

const PAGE_SIZE = 50;
const CANCELED_CODES = new Set(['CANCELLED', 'CANCELED', 'CANCELADO']);

const localDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatRangeDate = (value?: string | null) => {
  if (!value) return '—';
  const onlyDate = String(value).slice(0, 10);
  const [y, m, d] = onlyDate.split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
};

// "Lun 19 Ene 2026 09:17:51"
const formatPrintDate = () => {
  const d = new Date();
  const weekdayShort = d
    .toLocaleDateString('es-CO', { weekday: 'short' })
    .replace('.', '');
  const day = String(d.getDate()).padStart(2, '0');
  const monthShort = d
    .toLocaleDateString('es-CO', { month: 'short' })
    .replace('.', '');
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${cap(weekdayShort)} ${day} ${cap(monthShort)} ${year} ${hh}:${mm}:${ss}`;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(
    Number(value || 0)
  );

const formatPieces = (value: number) => {
  const n = Number(value || 0);
  // Si la cantidad es entera, muéstrala sin decimales para que entre en 3ch.
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

// Para órdenes digitales mostramos solo el sufijo numérico (ORD-000123 → 123).
const displayOrderNumber = (row: InventoryGeneralRow) => {
  if (row.isManual && row.manualOrderNumber) {
    return row.manualOrderNumber;
  }
  const num = row.orderNumber ?? '';
  const match = num.match(/(\d+)\s*$/);
  if (!match) return num;
  return String(Number(match[1]));
};

export const InventoryGeneralPrintPage = ({ user }: { user: SessionUser }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const today = localDateKey(new Date());
  const fromParam = searchParams.get('from') || today;
  const toParam = searchParams.get('to') || today;
  const shouldAutoPrint = searchParams.get('autoPrint') === '1';

  const [runningPdfAction, setRunningPdfAction] = useState(false);
  const autoPrintedRef = useRef(false);

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

  const { data: company } = useQuery({
    queryKey: ['company-settings-inventario'],
    queryFn: api.companySettings
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inventory-general', fromParam, toParam],
    queryFn: () => api.inventoryGeneral(fromParam, toParam)
  });

  const pages = useMemo<InventoryGeneralRow[][]>(() => {
    const rows = data?.rows ?? [];
    if (rows.length === 0) return [[]];
    const out: InventoryGeneralRow[][] = [];
    for (let i = 0; i < rows.length; i += PAGE_SIZE) {
      out.push(rows.slice(i, i + PAGE_SIZE));
    }
    return out;
  }, [data?.rows]);

  const generatePdf = async () => {
    if (!data) throw new Error('No hay datos del inventario.');
    return api.printToPdfAuto({
      defaultFileName: `Inventario-${fromParam}_a_${toParam}.pdf`,
      targetDir: pdfOutputDir ?? null,
      subfolder: `Inventarios/${today}`,
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
        printError instanceof Error ? printError.message : 'No fue posible imprimir el inventario.',
        'error'
      );
    } finally {
      setRunningPdfAction(false);
    }
  };

  useEffect(() => {
    if (!data || !shouldAutoPrint || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    let cancelled = false;
    const run = async () => {
      try {
        await generatePdf();
        if (!cancelled) window.setTimeout(() => window.print(), 180);
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
    return <div className="card-panel">Cargando inventario...</div>;
  }
  if (isError || !data) {
    return (
      <div className="card-panel">
        <p className="error-text">
          {(error as Error)?.message || 'No fue posible generar el inventario.'}
        </p>
      </div>
    );
  }

  const totalPages = pages.length;
  const subtitleRange =
    fromParam === toParam
      ? `Fecha ${formatRangeDate(fromParam)}`
      : `De ${formatRangeDate(fromParam)} a ${formatRangeDate(toParam)}`;

  return (
    <section className="stack-gap inventario-page">
      <div className="no-print">
        <PageHeader
          title="Inventario general"
          subtitle={subtitleRange}
          actions={
            <div className="row-actions no-print">
              <Button variant="secondary" onClick={() => navigate('/reportes')}>
                Volver a reportes
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

      {pages.map((pageRows, pageIndex) => {
        const isLast = pageIndex === totalPages - 1;
        return (
          <div className="thermal-invoice inv-ticket inv-page" key={`page-${pageIndex}`}>
            <div className="thermal-header">
              {company?.logoBase64 ? (
                <img
                  src={company.logoBase64}
                  alt="Logo del negocio"
                  className="thermal-logo"
                />
              ) : null}
              <h2>{company?.companyName?.toUpperCase() ?? 'NEGOCIO'}</h2>
              <p className="inv-title">INVENTARIO GENERAL</p>
              <p className="inv-range">{subtitleRange}</p>
              <p className="inv-page-num">
                Página {pageIndex + 1} de {totalPages}
              </p>
            </div>

            <div className="inv-divider" />

            <div className="inv-table">
              <div className="inv-row inv-row-head">
                <span className="col-orden">Orden</span>
                <span className="col-pzs">Pzs</span>
                <span className="col-cliente">CLIENTE</span>
                <span className="col-valor">VALOR</span>
              </div>
              {pageRows.length === 0 ? (
                <div className="inv-empty">Sin órdenes en el rango seleccionado.</div>
              ) : (
                pageRows.map((row) => {
                  const canceled = CANCELED_CODES.has(
                    String(row.statusCode ?? '').toUpperCase()
                  );
                  return (
                    <div className="inv-row" key={row.orderId}>
                      <span className="col-orden">{displayOrderNumber(row)}</span>
                      <span className="col-pzs">{formatPieces(row.pieces)}</span>
                      <span className={`col-cliente ${canceled ? 'is-canceled' : ''}`}>
                        {row.clientName}
                        {canceled ? <span className="canc-tag"> (CANC)</span> : null}
                      </span>
                      <span className="col-valor">{formatCurrency(row.total)}</span>
                    </div>
                  );
                })
              )}
            </div>

            {isLast ? (
              <>
                <div className="inv-divider" />
                <div className="inv-totals">
                  <div className="inv-total-row">
                    <span>TOTAL ÓRDENES</span>
                    <strong>{data.totals.totalOrders}</strong>
                  </div>
                  <div className="inv-total-row">
                    <span>TOTAL PIEZAS</span>
                    <strong>{formatPieces(data.totals.totalPieces)}</strong>
                  </div>
                  <div className="inv-total-row">
                    <span>VALOR TOTAL INV.</span>
                    <strong>{formatCurrency(data.totals.totalValue)}</strong>
                  </div>
                </div>
                <div className="inv-divider" />
                <div className="inv-foot">
                  <p>F.Impre: {formatPrintDate()}</p>
                  <p>Usr: {user.displayName || user.username}</p>
                </div>
              </>
            ) : null}
          </div>
        );
      })}

      <style>
        {`
          .inv-ticket {
            width: 100%;
            max-width: 76mm;
            margin: 0 auto 8mm;
            padding: 3mm 2.5mm 4mm;
            box-sizing: border-box;
            background: #fff;
            color: #000;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 10px;
            line-height: 1.3;
          }

          .inv-ticket .thermal-header {
            text-align: center;
          }
          .inv-ticket .thermal-header h2 {
            margin: 0 0 2px;
            font-size: 12px;
            letter-spacing: 0.5px;
          }
          .inv-ticket .thermal-header p {
            margin: 1px 0;
          }
          .inv-ticket .inv-title {
            font-weight: 800;
            letter-spacing: 1px;
            margin-top: 3px !important;
          }
          .inv-ticket .inv-range {
            font-size: 10px;
          }
          .inv-ticket .inv-page-num {
            font-size: 9px;
            color: #444;
          }

          .inv-ticket .thermal-logo {
            width: 22mm;
            max-width: 100%;
            max-height: 18mm;
            object-fit: contain;
            margin: 0 auto 3px;
            display: block;
          }

          .inv-ticket .inv-divider {
            border-top: 1px dashed rgba(0, 0, 0, 0.85);
            margin: 5px 0;
          }

          .inv-ticket .inv-table {
            width: 100%;
            font-family: Consolas, 'Courier New', monospace;
            font-size: 10px;
          }

          .inv-ticket .inv-row {
            display: grid;
            grid-template-columns: 12mm 7mm 1fr 18mm;
            gap: 2px;
            padding: 1px 0;
            border-bottom: 1px dashed rgba(0, 0, 0, 0.18);
          }
          .inv-ticket .inv-row:last-child {
            border-bottom: 0;
          }
          .inv-ticket .inv-row-head {
            font-weight: 800;
            border-bottom: 1px solid #000;
            padding-bottom: 2px;
            margin-bottom: 2px;
          }
          .inv-ticket .col-orden {
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .inv-ticket .col-pzs {
            text-align: center;
          }
          .inv-ticket .col-cliente {
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
          }
          .inv-ticket .col-cliente.is-canceled {
            text-decoration: line-through;
            color: #555;
          }
          .inv-ticket .canc-tag {
            font-weight: 700;
            margin-left: 2px;
          }
          .inv-ticket .col-valor {
            text-align: right;
            white-space: nowrap;
          }

          .inv-ticket .inv-empty {
            text-align: center;
            padding: 8px 0;
            color: #444;
            font-style: italic;
          }

          .inv-ticket .inv-totals {
            display: grid;
            gap: 3px;
          }
          .inv-ticket .inv-total-row {
            display: flex;
            justify-content: space-between;
            font-weight: 700;
            font-size: 10.5px;
          }

          .inv-ticket .inv-foot p {
            margin: 1px 0;
            font-size: 9px;
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

            .inventario-page {
              display: block !important;
              width: 80mm !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: visible !important;
            }

            .inv-ticket {
              width: 80mm !important;
              max-width: 80mm !important;
              box-sizing: border-box !important;
              margin: 0 !important;
              padding: 4mm 4mm 6mm !important;
              overflow: visible !important;
              page-break-after: always;
              break-after: page;
            }
            .inv-ticket:last-child {
              page-break-after: auto;
              break-after: auto;
              padding-bottom: 20mm !important;
            }

            .inv-ticket .inv-row {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          }
        `}
      </style>
    </section>
  );
};

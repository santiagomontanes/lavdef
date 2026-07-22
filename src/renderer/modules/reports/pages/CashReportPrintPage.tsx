import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { Button, PageHeader } from '@renderer/ui/components';
import { currency } from '@renderer/utils/format';
import { showToast } from '@renderer/utils/toast';
import type { ReportsSummary, SessionUser } from '@shared/types';

const localDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  // Aceptamos tanto "YYYY-MM-DD" como ISO; mostramos solo fecha en es-CO.
  const onlyDate = String(value).slice(0, 10);
  const [y, m, d] = onlyDate.split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
};

const formatDateTime = () => {
  const now = new Date();
  return `${localDateKey(now)} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
};

const renderValue = (value?: string | null) => {
  const text = String(value ?? '').trim();
  return text ? text : '—';
};

const sumPaymentsByMethodName = (
  data: ReportsSummary | undefined,
  needles: string[]
): number => {
  if (!data?.paymentMethods?.length) return 0;
  const lowered = needles.map((n) => n.toLowerCase());
  return data.paymentMethods
    .filter((m) => lowered.some((n) => (m.methodName ?? '').toLowerCase().includes(n)))
    .reduce((sum, m) => sum + Number(m.amount ?? 0), 0);
};

const sumExpensesByMethodKind = (
  data: ReportsSummary | undefined,
  kind: 'cash' | 'platform'
): number => {
  if (!data?.expensesByPaymentMethod?.length) return 0;
  return data.expensesByPaymentMethod.reduce((sum, item) => {
    const isCash = (item.methodName ?? '').toLowerCase().includes('efect');
    const include = kind === 'cash' ? isCash : !isCash;
    return include ? sum + Number(item.amount ?? 0) : sum;
  }, 0);
};

export const CashReportPrintPage = ({ user }: { user: SessionUser }) => {
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
    queryKey: ['company-settings-arqueo-print'],
    queryFn: api.companySettings
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reports-summary-arqueo', fromParam, toParam],
    queryFn: () => api.reportsSummary(fromParam, toParam)
  });

  const generatePdf = async () => {
    if (!data) throw new Error('No hay datos del arqueo.');
    return api.printToPdfAuto({
      defaultFileName: `Arqueo-${fromParam}_a_${toParam}.pdf`,
      targetDir: pdfOutputDir ?? null,
      subfolder: `Arqueos/${today}`,
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
        printError instanceof Error ? printError.message : 'No fue posible imprimir el arqueo.',
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
    return <div className="card-panel">Cargando arqueo...</div>;
  }
  if (isError || !data) {
    return (
      <div className="card-panel">
        <p className="error-text">
          {(error as Error)?.message || 'No fue posible generar el arqueo.'}
        </p>
      </div>
    );
  }

  const cashIn = sumPaymentsByMethodName(data, ['efect', 'cash']);
  const cashExpenses = sumExpensesByMethodKind(data, 'cash');
  const platformExpenses = sumExpensesByMethodKind(data, 'platform');
  const cashInBox = cashIn - cashExpenses; // efectivo neto del rango (sin sesión)

  // Métodos a mostrar siempre en el detalle (orden y nombres consistentes).
  // Datáfono y Tarjeta se muestran por separado a pedido del negocio: si en la
  // BD existe un solo método "Tarjeta", todos los pagos cuentan ahí.
  const methodBuckets: Array<{ label: string; needles: string[] }> = [
    { label: 'Efectivo', needles: ['efect', 'cash'] },
    { label: 'Nequi', needles: ['nequi'] },
    { label: 'Daviplata', needles: ['daviplata'] },
    { label: 'Transferencia', needles: ['transfer'] },
    { label: 'Bancolombia', needles: ['bancolombia'] },
    { label: 'Datáfono', needles: ['datáfono', 'datafono'] },
    { label: 'Tarjeta', needles: ['card', 'tarjeta'] }
  ];
  const knownTotals = methodBuckets.reduce(
    (sum, b) => sum + sumPaymentsByMethodName(data, b.needles),
    0
  );
  const otrosTotal = Math.max(0, Number(data.totalPayments ?? 0) - knownTotals);

  // Recaudo en plataformas (todo lo NO efectivo).
  const platformPayments = Math.max(
    0,
    Number(data.totalPayments ?? 0) - cashIn
  );

  const totalGastos = cashExpenses + platformExpenses;
  const saldoFinal = Number(data.totalPayments ?? 0) - totalGastos;

  // Día de la semana en español, con fecha corta DD/MM.
  const formatDayLabel = (isoDate: string) => {
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    const dayName = d.toLocaleDateString('es-CO', { weekday: 'long' });
    const capitalized = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${capitalized} ${dd}/${mm}`;
  };

  return (
    <section className="stack-gap arqueo-page">
      <div className="no-print">
        <PageHeader
          title="Arqueo / Cierre diario"
          subtitle={`Rango ${formatDate(fromParam)} — ${formatDate(toParam)}`}
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

      <div className="thermal-invoice arqueo-ticket">
        <div className="thermal-header">
          {company?.logoBase64 ? (
            <img
              src={company.logoBase64}
              alt="Logo del negocio"
              className="thermal-logo"
            />
          ) : null}
          <h2>{renderValue(company?.companyName)}</h2>
          {company?.legalName ? <p>{company.legalName}</p> : null}
          {company?.nit ? <p>NIT: {company.nit}</p> : null}
          {company?.phone ? <p>Tel: {company.phone}</p> : null}
          {company?.address ? <p>{company.address}</p> : null}
        </div>

        <div className="thermal-section thermal-centered arqueo-meta">
          <p className="thermal-muted">
            Rango: {formatDate(fromParam)} — {formatDate(toParam)}
          </p>
          <p className="thermal-muted">
            Generado: {formatDateTime()} · Usuario: {renderValue(user.displayName || user.username)}
          </p>
        </div>

        {/* ============================================================ */}
        {/* BLOQUE 1: RESUMEN DE CIERRE DIARIO DE CAJA                   */}
        {/* ============================================================ */}
        <div className="arqueo-block-divider" />
        <div className="arqueo-block-title">RESUMEN DE CIERRE DIARIO DE CAJA</div>
        <div className="arqueo-block-divider" />

        <div className="thermal-section">
          <div className="arqueo-table-head">
            <span>Día</span>
            <span>Caja</span>
            <span>Recaudo</span>
            <span>Gastos</span>
            <span>Saldo</span>
          </div>
          {data.dailySeries.map((day) => {
            const saldo = Number(day.payments ?? 0) - Number(day.expenses ?? 0);
            return (
              <div className="arqueo-table-row" key={day.date}>
                <span>{formatDayLabel(day.date)}</span>
                <span>General</span>
                <span>{currency(day.payments)}</span>
                <span>{currency(day.expenses)}</span>
                <span>{currency(saldo)}</span>
              </div>
            );
          })}
        </div>

        <div className="arqueo-section-divider" />

        <div className="thermal-section">
          <div className="thermal-totals">
            <div><span>Total recaudado</span><strong>{currency(data.totalPayments)}</strong></div>
            <div><span>Total gastos</span><strong>{currency(totalGastos)}</strong></div>
            <div className="arqueo-total-row">
              <span><strong>Saldo final</strong></span>
              <strong>{currency(saldoFinal)}</strong>
            </div>
          </div>
        </div>

        <div className="arqueo-section-divider" />

        <div className="thermal-section">
          {data.topRevenueDay ? (
            <p>
              <strong>Día mayor recaudo:</strong>{' '}
              {formatDayLabel(data.topRevenueDay.date)} · {currency(data.topRevenueDay.amount)}
            </p>
          ) : null}
          {data.lowestRevenueDay ? (
            <p>
              <strong>Día menor recaudo:</strong>{' '}
              {formatDayLabel(data.lowestRevenueDay.date)} · {currency(data.lowestRevenueDay.amount)}
            </p>
          ) : null}
          {data.topExpenseDay ? (
            <p>
              <strong>Día mayor gasto:</strong>{' '}
              {formatDayLabel(data.topExpenseDay.date)} · {currency(data.topExpenseDay.amount)}
            </p>
          ) : null}
        </div>

        {/* ============================================================ */}
        {/* BLOQUE 2: RESUMEN ENTRADAS Y RECAUDO                          */}
        {/* ============================================================ */}
        <div className="arqueo-block-divider" />
        <div className="arqueo-block-title">RESUMEN ENTRADAS Y RECAUDO</div>
        <div className="arqueo-block-divider" />

        <div className="thermal-section">
          <div className="arqueo-subtitle">ENTRADAS</div>
          <div className="thermal-totals">
            <div><span>Órdenes creadas</span><strong>{data.totalOrders}</strong></div>
            <div className="thermal-sub-row"><span>Manuales</span><strong>{data.manualOrders}</strong></div>
            <div className="thermal-sub-row"><span>Digitales</span><strong>{data.digitalOrders}</strong></div>
            <div><span>Piezas ingresadas</span><strong>{Number(data.piecesEntered ?? 0)}</strong></div>
            <div><span>Órdenes entregadas</span><strong>{data.ordersDelivered}</strong></div>
            <div><span>Canceladas / anuladas</span><strong>{data.ordersCanceled}</strong></div>
          </div>
        </div>

        <div className="arqueo-section-divider" />

        <div className="thermal-section">
          <div className="arqueo-subtitle">RECAUDO</div>
          <div className="thermal-totals">
            <div><span>Total recaudado</span><strong>{currency(data.totalPayments)}</strong></div>
            <div><span>Efectivo</span><strong>{currency(cashIn)}</strong></div>
            <div><span>Plataformas</span><strong>{currency(platformPayments)}</strong></div>
            <div><span>Otros métodos</span><strong>{currency(otrosTotal)}</strong></div>
            <div><span>Saldo pendiente</span><strong>{currency(data.outstandingBalance)}</strong></div>
          </div>
        </div>

        <div className="arqueo-section-divider" />

        <div className="thermal-section">
          <div className="arqueo-subtitle">MÉTODOS DE PAGO</div>
          <div className="thermal-totals">
            {methodBuckets.map((b) => (
              <div key={b.label}>
                <span>{b.label}</span>
                <strong>{currency(sumPaymentsByMethodName(data, b.needles))}</strong>
              </div>
            ))}
            <div>
              <span>Otro</span>
              <strong>{currency(otrosTotal)}</strong>
            </div>
          </div>
        </div>

        <div className="arqueo-section-divider" />

        <div className="thermal-section">
          <div className="arqueo-subtitle">GASTOS</div>
          <div className="thermal-totals">
            <div><span>Gastos en efectivo</span><strong>{currency(cashExpenses)}</strong></div>
            <div><span>Gastos en plataformas</span><strong>{currency(platformExpenses)}</strong></div>
            <div className="arqueo-total-row">
              <span><strong>Total gastos</strong></span>
              <strong>{currency(totalGastos)}</strong>
            </div>
          </div>
        </div>

        <div className="arqueo-section-divider" />

        <div className="thermal-section">
          <div className="arqueo-subtitle">CAJA</div>
          <div className="thermal-totals">
            <div><span>Efectivo en caja</span><strong>{currency(cashInBox)}</strong></div>
            <div className="arqueo-total-row">
              <span><strong>Saldo final</strong></span>
              <strong>{currency(saldoFinal)}</strong>
            </div>
          </div>
          <p className="thermal-muted" style={{ fontSize: 9, marginTop: 6 }}>
            Efectivo en caja = Efectivo recibido − Gastos en efectivo del rango.
            Para el efectivo real de la sesión actual usa la pantalla de Caja.
          </p>
        </div>

        {data.expensesByCategory && data.expensesByCategory.length > 0 ? (
          <>
            <div className="arqueo-section-divider" />
            <div className="thermal-section">
              <div className="arqueo-subtitle">GASTOS POR CATEGORÍA</div>
              {data.expensesByCategory.map((row) => (
                <div key={row.categoryName} className="thermal-item-row">
                  <span>{row.categoryName}</span>
                  <strong>{currency(row.amount)}</strong>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div className="arqueo-block-divider" />

        <div className="thermal-section thermal-centered">
          <p className="thermal-muted">
            Generado con LavaSuite · {renderValue(company?.companyName)}
          </p>
          <p className="thermal-muted" style={{ fontSize: 9 }}>
            {formatDateTime()} · {renderValue(user.displayName || user.username)}
          </p>
        </div>
      </div>

      <style>
        {`
          .arqueo-ticket {
            width: 100%;
            max-width: 76mm;
            margin: 0 auto;
            padding: 3mm 2.5mm 6mm;
            box-sizing: border-box;
            background: #fff;
            color: #000;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 10px;
            line-height: 1.35;
          }

          .arqueo-ticket .thermal-header,
          .arqueo-ticket .thermal-centered {
            text-align: center;
          }

          .arqueo-ticket .thermal-header h2,
          .arqueo-ticket .thermal-section h3 {
            margin: 0 0 4px;
          }

          .arqueo-ticket .thermal-header p,
          .arqueo-ticket .thermal-section p {
            margin: 2px 0;
            word-break: break-word;
          }

          .arqueo-ticket .thermal-logo {
            width: 28mm;
            max-width: 100%;
            max-height: 22mm;
            object-fit: contain;
            margin: 0 auto 4px;
            display: block;
          }

          .arqueo-ticket .thermal-divider {
            border-top: 1px dashed rgba(0, 0, 0, 0.85);
            margin: 8px 0;
          }

          .arqueo-ticket .thermal-copy-badge {
            text-align: center;
            margin: 6px 0 2px;
            padding: 4px 0;
            border: 1px solid #000;
            border-radius: 2px;
          }
          .arqueo-ticket .thermal-copy-title {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.5px;
            text-transform: uppercase;
          }
          .arqueo-ticket .thermal-copy-tag {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1px;
            margin-top: 2px;
          }

          .arqueo-ticket .arqueo-meta {
            margin: 4px 0 6px;
          }
          .arqueo-ticket .arqueo-meta p {
            margin: 1px 0;
            font-size: 9.5px;
          }

          /* Separador de bloque (===) y de sub-sección (---) */
          .arqueo-ticket .arqueo-block-divider {
            border-top: 3px double #000;
            margin: 6px 0;
          }
          .arqueo-ticket .arqueo-section-divider {
            border-top: 1px solid #000;
            margin: 6px 0;
          }
          .arqueo-ticket .arqueo-block-title {
            text-align: center;
            font-weight: 800;
            font-size: 11.5px;
            letter-spacing: 1px;
            text-transform: uppercase;
            padding: 2px 0;
          }
          .arqueo-ticket .arqueo-subtitle {
            text-align: left;
            font-weight: 800;
            font-size: 10.5px;
            letter-spacing: 0.6px;
            text-transform: uppercase;
            border-bottom: 1px dashed #000;
            padding-bottom: 2px;
            margin-bottom: 4px;
          }

          /* Tabla diaria: Día | Caja | Recaudo | Gastos | Saldo */
          .arqueo-ticket .arqueo-table-head,
          .arqueo-ticket .arqueo-table-row {
            display: grid;
            grid-template-columns: 1.4fr 0.8fr 1fr 1fr 1fr;
            gap: 3px;
            font-size: 9.5px;
          }
          .arqueo-ticket .arqueo-table-head {
            font-weight: 800;
            border-bottom: 1px solid #000;
            padding-bottom: 2px;
            margin-bottom: 2px;
            letter-spacing: 0.3px;
          }
          .arqueo-ticket .arqueo-table-row {
            padding: 2px 0;
            border-bottom: 1px dashed rgba(0, 0, 0, 0.25);
          }
          .arqueo-ticket .arqueo-table-row:last-child {
            border-bottom: 0;
          }
          .arqueo-ticket .arqueo-table-row > span,
          .arqueo-ticket .arqueo-table-head > span {
            text-align: right;
            word-break: break-word;
          }
          .arqueo-ticket .arqueo-table-row > span:first-child,
          .arqueo-ticket .arqueo-table-head > span:first-child,
          .arqueo-ticket .arqueo-table-row > span:nth-child(2),
          .arqueo-ticket .arqueo-table-head > span:nth-child(2) {
            text-align: left;
          }

          /* Fila de total destacada en sub-bloques */
          .arqueo-ticket .arqueo-total-row {
            border-top: 1px solid #000;
            padding-top: 3px;
            margin-top: 3px;
          }

          .arqueo-ticket .thermal-totals {
            display: grid;
            gap: 4px;
          }
          .arqueo-ticket .thermal-totals > div {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
          }
          .arqueo-ticket .thermal-sub-row {
            font-size: 9.5px;
            opacity: 0.85;
          }

          .arqueo-ticket .thermal-item-row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            padding: 2px 0;
          }

          .arqueo-ticket .thermal-muted {
            color: #444;
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

            .arqueo-page {
              display: block !important;
              width: 80mm !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: visible !important;
            }

            .arqueo-ticket {
              width: 80mm !important;
              max-width: 80mm !important;
              box-sizing: border-box !important;
              margin: 0 !important;
              padding: 4mm 4mm 20mm !important;
              overflow: visible !important;
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
          }
        `}
      </style>
    </section>
  );
};

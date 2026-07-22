import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import { useHardwareAvailability } from '@renderer/hooks/useHardwareAvailability';
import type { CashCloseResult } from '@shared/types';
import {
  Button,
  DataTable,
  Input,
  Modal,
  PageHeader,
  PriceInput,
  SummaryCard
} from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';
import { showToast } from '@renderer/utils/toast';

const ADMIN_WHATSAPP_STORAGE_KEY = 'cash_close_admin_whatsapp';
const CASH_OPENING_PRESETS_STORAGE_KEY = 'cash_opening_presets_v1';
const CASH_OPENING_PRESETS_LIMIT = 3;

type CashOpeningPreset = {
  openedByName: string;
  openedByPhone: string;
  adminWhatsapp: string;
};

const normalizePhone = (raw?: string | null) => {
  const digits = String(raw ?? '').replace(/\D/g, '');

  if (!digits) return '';

  if (digits.startsWith('57') && digits.length >= 12) {
    return digits;
  }

  if (digits.length === 10) {
    return `57${digits}`;
  }

  if (digits.length > 10 && !digits.startsWith('57')) {
    return `57${digits.slice(-10)}`;
  }

  return digits;
};

const buildCashCloseWhatsappMessage = (data: CashCloseResult) => {
  const totalsByMethod = data.totalsByMethod ?? [];
  const deliveredOrders = data.deliveredOrders ?? [];
  const sessionPayments = data.sessionPayments ?? [];

  const methodsText = totalsByMethod.length
    ? totalsByMethod
        .map(
          (item) =>
            `- ${item.methodName}: ${new Intl.NumberFormat('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0
            }).format(item.amount)}`
        )
        .join('\n')
    : '- Sin movimientos';

  const expensesByMethod = data.expensesByMethod ?? [];
  const expensesText = expensesByMethod.length
    ? expensesByMethod
        .map(
          (item) =>
            `- ${item.methodName}: ${new Intl.NumberFormat('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0
            }).format(item.amount)}`
        )
        .join('\n')
    : '- Sin gastos';

  const deliveredText = deliveredOrders.length
    ? deliveredOrders
        .map(
          (item) =>
            `- ${item.orderNumber} | Total: ${new Intl.NumberFormat('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0
            }).format(item.total)} | Método: ${item.paymentMethods || '—'}`
        )
        .join('\n')
    : '- No hubo órdenes entregadas';

  const paymentsText = sessionPayments.length
    ? sessionPayments
        .map(
          (item) =>
            `- ${item.orderNumber} | ${item.clientName} | ${new Intl.NumberFormat('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0
            }).format(item.amount)} | ${item.paymentMethodName}`
        )
        .join('\n')
    : '- No hubo abonos';

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(Number(n ?? 0));

  return `*CIERRE DE CAJA*
🏪 Negocio: ${data.companyName || 'Mi Negocio'}
🧾 NIT: ${data.companyNit || '—'}
👤 Cajero cierre: ${data.cashierName || 'Administrador'}
🙍 Abrió caja: ${data.openedByName || '—'}
📱 Celular apertura: ${data.openedByPhone || '—'}
🕒 Fecha: ${data.closedAt ? new Date(data.closedAt).toLocaleString('es-CO') : '—'}
🔢 Sesión: #${data.cashSessionId}

*RESUMEN*
💵 Apertura: ${fmt(data.openingAmount)}
🟢 Esperado efectivo: ${fmt(data.cashOnlyAmount ?? data.systemAmount)}
💲 Declarado: ${fmt(data.declaredAmount)}
➕➖ Diferencia: ${fmt(data.differenceAmount)}
📊 Total sistema (todos los métodos): ${fmt(data.systemAmount)}
${(data.manualCashIn ?? 0) > 0 ? `⬆️ Ingresos manuales: ${fmt(data.manualCashIn ?? 0)}\n` : ''}${(data.manualCashOut ?? 0) > 0 ? `⬇️ Egresos manuales: ${fmt(data.manualCashOut ?? 0)}\n` : ''}${(data.cashRefunds ?? 0) > 0 ? `↩️ Devoluciones efectivo: ${fmt(data.cashRefunds ?? 0)}\n` : ''}
*TOTAL POR MÉTODO*
${methodsText}

*GASTOS POR MÉTODO*
${expensesText}

*ÓRDENES ENTREGADAS*
${deliveredText}

*ABONOS DE LA SESIÓN*
${paymentsText}`;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(value ?? 0));

const formatMovementTypeLabel = (raw: string) => {
  const code = String(raw ?? '').toUpperCase();
  if (code === 'EXPENSE_OUT') return 'Salida por gasto';
  if (code === 'PAYMENT_OUT') return 'Salida por devolución';
  if (code === 'PAYMENT_IN') return 'Ingreso por pago';
  if (code.endsWith('_OUT')) return 'Salida de caja';
  if (code.endsWith('_IN')) return 'Ingreso a caja';
  return raw;
};

const escapeHtml = (value: string) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const buildThermalCloseHtml = (data: CashCloseResult) => {
  const deliveredOrders = data.deliveredOrders ?? [];
  const sessionPayments = data.sessionPayments ?? [];
  const totalsByMethod = data.totalsByMethod ?? [];
  const expensesByMethod = data.expensesByMethod ?? [];

  const methodsHtml = totalsByMethod.length
    ? totalsByMethod
        .map(
          (item) => `
            <div class="row">
              <span>${item.methodName}</span>
              <span>${formatMoney(item.amount)}</span>
            </div>
          `
        )
        .join('')
    : `<div class="small center">Sin movimientos por método.</div>`;

  const deliveredHtml = deliveredOrders.length
    ? deliveredOrders
        .map(
          (item) => `
            <div class="line"></div>
            <div class="row strong">
              <span>${item.orderNumber}</span>
              <span>${formatMoney(item.total)}</span>
            </div>
            <div class="small">Recibe: ${escapeHtml(item.deliveredTo || '—')}</div>
            <div class="small">Abonado: ${formatMoney(item.paidTotal)}</div>
            <div class="small">Saldo: ${formatMoney(Math.max(0, item.total - item.paidTotal))}</div>
            <div class="small">Método: ${escapeHtml(item.paymentMethods || '—')}</div>
            <div class="small">Fecha: ${item.deliveredAt ? new Date(item.deliveredAt).toLocaleString('es-CO') : '—'}</div>
          `
        )
        .join('')
    : `<div class="small center">No hubo órdenes entregadas en esta sesión.</div>`;

  const expensesHtml = expensesByMethod.length
    ? expensesByMethod
        .map(
          (item) => `
            <div class="row">
              <span>${item.methodName}</span>
              <span>${formatMoney(item.amount)}</span>
            </div>
          `
        )
        .join('')
    : `<div class="small center">Sin gastos en la sesión.</div>`;

  const paymentsHtml = sessionPayments.length
    ? sessionPayments
        .map(
          (item) => `
            <div class="line"></div>
            <div class="row strong">
              <span>${item.orderNumber}</span>
              <span>${formatMoney(item.amount)}</span>
            </div>
            <div class="small">Cliente: ${escapeHtml(item.clientName || '—')}</div>
            <div class="small">Método: ${escapeHtml(item.paymentMethodName || '—')}</div>
            <div class="small">Referencia: ${escapeHtml(item.reference || '—')}</div>
            <div class="small">Fecha: ${item.createdAt ? new Date(item.createdAt).toLocaleString('es-CO') : '—'}</div>
          `
        )
        .join('')
    : `<div class="small center">No hubo abonos en esta sesión.</div>`;

  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>Cierre de caja</title>
        <style>
          * {
            box-sizing: border-box;
            font-family: 'Courier New', monospace;
          }

          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            width: 76mm;
            max-width: 100%;
            overflow: visible;
            overflow-x: hidden;
          }

          body {
            padding: 8px 2px;
            font-size: 10px;
            line-height: 1.4;
            font-weight: 700;
            -webkit-font-smoothing: none;
            text-rendering: geometricPrecision;
            overflow: visible;
            overflow-x: hidden;
          }

          .center {
            text-align: center;
          }

          .title {
            font-size: 15px;
            font-weight: 900;
            margin-bottom: 4px;
          }

          .subtitle {
            font-size: 10px;
            margin-bottom: 2px;
            font-weight: 700;
            word-break: break-word;
          }

          .section-title {
            margin-top: 10px;
            margin-bottom: 5px;
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
          }

          .line {
            border-top: 1px dashed #000;
            margin: 6px 0;
          }

          .row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 88px;
            column-gap: 6px;
            margin: 2px 0;
            align-items: start;
            font-weight: 700;
            width: 100%;
          }

          .row > span:first-child {
            min-width: 0;
            word-break: break-word;
          }

          .row > span:last-child {
            width: 88px;
            min-width: 88px;
            max-width: 88px;
            white-space: nowrap;
            text-align: right;
            overflow: hidden;
            }

          .strong {
            font-weight: 900;
          }

          .small {
            font-size: 9px;
            margin: 1px 0;
            word-break: break-word;
            font-weight: 700;
          }

          .footer {
            margin-top: 10px;
            text-align: center;
            font-size: 9px;
            font-weight: 700;
          }

          @media print {
            @page {
              size: 80mm auto;
              margin: 0;
            }

            html, body {
              width: 76mm;
              max-width: 100%;
              overflow: visible;
              overflow-x: hidden;
            }

            body {
              padding: 8px 2mm;
            }
          }
        </style>
      </head>
      <body>
        <div class="center">
          <div class="title">${escapeHtml(data.companyName || 'Mi Negocio')}</div>
          ${data.companyNit ? `<div class="subtitle">NIT: ${escapeHtml(data.companyNit)}</div>` : ''}
          ${data.companyPhone ? `<div class="subtitle">Tel: ${escapeHtml(data.companyPhone)}</div>` : ''}
          ${data.companyAddress ? `<div class="subtitle">${escapeHtml(data.companyAddress)}</div>` : ''}
          <div class="subtitle">CIERRE DE CAJA</div>
          <div class="subtitle">Sesión #${data.cashSessionId}</div>
          <div class="subtitle">${data.closedAt ? new Date(data.closedAt).toLocaleString('es-CO') : ''}</div>
          <div class="subtitle">Cajero cierre: ${escapeHtml(data.cashierName || 'Administrador')}</div>
          <div class="subtitle">Abrió caja: ${escapeHtml(data.openedByName || '—')}</div>
          <div class="subtitle">Celular: ${escapeHtml(data.openedByPhone || '—')}</div>
        </div>

        <div class="line"></div>

        <div class="section-title">Resumen</div>
        <div class="row"><span>Apertura</span><span>${formatMoney(data.openingAmount)}</span></div>
        <div class="row strong"><span>Esperado en efectivo</span><span>${formatMoney(data.cashOnlyAmount ?? data.systemAmount)}</span></div>
        <div class="row strong"><span>Declarado</span><span>${formatMoney(data.declaredAmount)}</span></div>
        <div class="row strong"><span>Diferencia</span><span>${formatMoney(data.differenceAmount)}</span></div>

        <div class="line"></div>

        <div class="row"><span>Total sistema (todos los métodos)</span><span>${formatMoney(data.systemAmount)}</span></div>
        <div class="row"><span>Gastos sesión</span><span>${formatMoney(data.totalExpenses ?? 0)}</span></div>
        ${(data.manualCashIn ?? 0) > 0 ? `<div class="row"><span>Ingresos manuales</span><span>${formatMoney(data.manualCashIn ?? 0)}</span></div>` : ''}
        ${(data.manualCashOut ?? 0) > 0 ? `<div class="row"><span>Egresos manuales</span><span>${formatMoney(data.manualCashOut ?? 0)}</span></div>` : ''}
        ${(data.cashRefunds ?? 0) > 0 ? `<div class="row"><span>Devoluciones (efectivo)</span><span>${formatMoney(data.cashRefunds ?? 0)}</span></div>` : ''}

        <div class="line"></div>

        <div class="section-title">Totales por método</div>
        ${methodsHtml}

        <div class="line"></div>

        <div class="section-title">Gastos por método</div>
        ${expensesHtml}

        <div class="line"></div>

        <div class="section-title">Órdenes entregadas</div>
        ${deliveredHtml}

        <div class="line"></div>

        <div class="section-title">Abonos de la sesión</div>
        ${paymentsHtml}

        <div class="line"></div>

        <div class="footer">
          Documento generado por el sistema
        </div>
      </body>
    </html>
  `;
};

const PrintMoneyRow = ({
  label,
  value,
  strong = false
}: {
  label: string;
  value: number;
  strong?: boolean;
}) => (
  <div className={`cash-print-row${strong ? ' cash-print-row-strong' : ''}`}>
    <span>{label}</span>
    <strong>{currency(value)}</strong>
  </div>
);

const CashClosurePrintReport = ({ data }: { data: CashCloseResult }) => {
  const totalsByMethod = data.totalsByMethod ?? [];
  const expensesByMethod = data.expensesByMethod ?? [];
  const deliveredOrders = data.deliveredOrders ?? [];
  const sessionPayments = data.sessionPayments ?? [];
  const hasCashMovements =
    Number(data.manualCashIn ?? 0) > 0 ||
    Number(data.manualCashOut ?? 0) > 0 ||
    Number(data.cashRefunds ?? 0) > 0;

  return (
    <article className="cash-closure-print-root" aria-label="Reporte de cierre de caja">
      <header className="cash-print-header">
        <div>
          <h1>{data.companyName || 'Mi Negocio'}</h1>
          <p>Cierre de caja</p>
        </div>
        <div className="cash-print-meta">
          <span>Sesion #{data.cashSessionId}</span>
          <span>{data.closedAt ? dateTime(data.closedAt) : 'Sin fecha'}</span>
        </div>
      </header>

      <section className="cash-print-company-grid">
        <div>
          <span>Sucursal</span>
          <strong>{data.companyName || 'Mi Negocio'}</strong>
        </div>
        <div>
          <span>NIT</span>
          <strong>{data.companyNit || '-'}</strong>
        </div>
        <div>
          <span>Usuario cierre</span>
          <strong>{data.cashierName || 'Administrador'}</strong>
        </div>
        <div>
          <span>Abre caja</span>
          <strong>{data.openedByName || '-'}</strong>
        </div>
      </section>

      <section className="cash-print-section">
        <h2>Resumen</h2>
        <div className="cash-print-totals-grid">
          <PrintMoneyRow label="Base de apertura" value={data.openingAmount} />
          <PrintMoneyRow
            label="Esperado en efectivo"
            value={data.cashOnlyAmount ?? data.systemAmount}
            strong
          />
          <PrintMoneyRow label="Efectivo declarado" value={data.declaredAmount} strong />
          <PrintMoneyRow label="Diferencia" value={data.differenceAmount} strong />
          <PrintMoneyRow label="Total sistema" value={data.systemAmount} />
          <PrintMoneyRow label="Gastos de la sesion" value={data.totalExpenses ?? 0} />
        </div>
      </section>

      <section className="cash-print-section">
        <h2>Movimientos</h2>
        {hasCashMovements ? (
          <div className="cash-print-rows">
            {Number(data.manualCashIn ?? 0) > 0 ? (
              <PrintMoneyRow label="Ingresos manuales" value={data.manualCashIn ?? 0} />
            ) : null}
            {Number(data.manualCashOut ?? 0) > 0 ? (
              <PrintMoneyRow label="Egresos manuales" value={data.manualCashOut ?? 0} />
            ) : null}
            {Number(data.cashRefunds ?? 0) > 0 ? (
              <PrintMoneyRow label="Devoluciones en efectivo" value={data.cashRefunds ?? 0} />
            ) : null}
          </div>
        ) : (
          <p className="cash-print-empty">Sin movimientos manuales relevantes.</p>
        )}
      </section>

      <section className="cash-print-section">
        <h2>Totales por metodo</h2>
        {totalsByMethod.length ? (
          <div className="cash-print-rows">
            {totalsByMethod.map((item) => (
              <PrintMoneyRow key={item.methodName} label={item.methodName} value={item.amount} />
            ))}
          </div>
        ) : (
          <p className="cash-print-empty">Sin pagos registrados.</p>
        )}
      </section>

      <section className="cash-print-section">
        <h2>Gastos</h2>
        {expensesByMethod.length ? (
          <div className="cash-print-rows">
            {expensesByMethod.map((item) => (
              <PrintMoneyRow key={item.methodName} label={item.methodName} value={item.amount} />
            ))}
          </div>
        ) : (
          <p className="cash-print-empty">Sin gastos registrados.</p>
        )}
      </section>

      <section className="cash-print-section">
        <h2>Observaciones relevantes</h2>
        <p className="cash-print-note">
          Ordenes entregadas: {deliveredOrders.length}. Abonos registrados:{' '}
          {sessionPayments.length}. Celular apertura: {data.openedByPhone || '-'}.
        </p>
      </section>

      {deliveredOrders.length ? (
        <section className="cash-print-section">
          <h2>Ordenes entregadas</h2>
          <table className="cash-print-table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Recibe</th>
                <th>Total</th>
                <th>Abonado</th>
                <th>Metodo</th>
              </tr>
            </thead>
            <tbody>
              {deliveredOrders.map((item) => (
                <tr key={`${item.orderId}-${item.orderNumber}`}>
                  <td>{item.orderNumber}</td>
                  <td>{item.deliveredTo || '-'}</td>
                  <td>{currency(item.total)}</td>
                  <td>{currency(item.paidTotal)}</td>
                  <td>{item.paymentMethods || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {sessionPayments.length ? (
        <section className="cash-print-section">
          <h2>Abonos de la sesion</h2>
          <table className="cash-print-table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Cliente</th>
                <th>Abono</th>
                <th>Metodo</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {sessionPayments.map((item) => (
                <tr key={item.id}>
                  <td>{item.orderNumber}</td>
                  <td>{item.clientName}</td>
                  <td>{currency(item.amount)}</td>
                  <td>{item.paymentMethodName}</td>
                  <td>{dateTime(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </article>
  );
};

export const CashPage = () => {
  const queryClient = useQueryClient();
  const { isHardwareSupported, message: hardwareMessage } = useHardwareAvailability();

  const { data } = useQuery({
    queryKey: ['cash-summary'],
    queryFn: api.cashSummary
  });

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

  const { data: printers = [] } = useQuery({
    queryKey: ['printers'],
    queryFn: api.listPrinters,
    enabled: isHardwareSupported
  });

  const [openingAmount, setOpeningAmount] = useState(0);
  const [declaredAmount, setDeclaredAmount] = useState(0);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [adminWhatsapp, setAdminWhatsapp] = useState(() => {
    return localStorage.getItem(ADMIN_WHATSAPP_STORAGE_KEY) ?? '';
  });
  const [openedByName, setOpenedByName] = useState('');
  const [openedByPhone, setOpenedByPhone] = useState('');
  const [openingPresets, setOpeningPresets] = useState<CashOpeningPreset[]>(() => {
    try {
      const raw = localStorage.getItem(CASH_OPENING_PRESETS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CashOpeningPreset[];
      return Array.isArray(parsed) ? parsed.slice(0, CASH_OPENING_PRESETS_LIMIT) : [];
    } catch {
      return [];
    }
  });
  const [openCashError, setOpenCashError] = useState<string | null>(null);
  const [lastClosedPreview, setLastClosedPreview] = useState<CashCloseResult | null>(null);
  const [historicClosurePasswordModal, setHistoricClosurePasswordModal] = useState(false);
  const [historicClosurePassword, setHistoricClosurePassword] = useState('');
  const [historicClosurePasswordError, setHistoricClosurePasswordError] = useState<string | null>(null);
  const [pendingHistoricClosureId, setPendingHistoricClosureId] = useState<number | null>(null);

  const [movementType, setMovementType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
  const [movementAmount, setMovementAmount] = useState(0);
  const [movementNotes, setMovementNotes] = useState('');
  const [movementError, setMovementError] = useState<string | null>(null);

  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');

  useEffect(() => {
    if (!data?.activeSession) {
      setOpeningAmount(Number(data?.suggestedOpeningAmount ?? 0));
    }
  }, [data]);

  useEffect(() => {
    localStorage.setItem(ADMIN_WHATSAPP_STORAGE_KEY, adminWhatsapp);
  }, [adminWhatsapp]);

  useEffect(() => {
    localStorage.setItem(
      CASH_OPENING_PRESETS_STORAGE_KEY,
      JSON.stringify(openingPresets.slice(0, CASH_OPENING_PRESETS_LIMIT))
    );
  }, [openingPresets]);

  useEffect(() => {
    if (data?.activeSession) {
      setOpenedByName(data.activeSession.openedByName ?? '');
      setOpenedByPhone(data.activeSession.openedByPhone ?? '');
    }
  }, [data?.activeSession]);

  const openMutation = useMutation({
    mutationFn: api.openCashSession,
    onSuccess: async () => {
      const nextPreset: CashOpeningPreset = {
        openedByName: openedByName.trim(),
        openedByPhone: openedByPhone.trim(),
        adminWhatsapp: adminWhatsapp.trim()
      };

      setOpeningPresets((prev) => {
        const deduped = prev.filter(
          (item) =>
            !(
              item.openedByName === nextPreset.openedByName &&
              item.openedByPhone === nextPreset.openedByPhone &&
              item.adminWhatsapp === nextPreset.adminWhatsapp
            )
        );

        return [nextPreset, ...deduped].slice(0, CASH_OPENING_PRESETS_LIMIT);
      });

      setOpenCashError(null);
      await queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
    }
  });

  const closeMutation = useMutation<CashCloseResult, Error, number>({
    mutationFn: api.closeCashSession,
    onSuccess: async (result) => {
      setDeclaredAmount(0);
      setLastClosedPreview(result);

      await queryClient.invalidateQueries({ queryKey: ['cash-summary'] });

      const adminPhone = normalizePhone(adminWhatsapp);

      if (!adminPhone) return;

      const message = buildCashCloseWhatsappMessage(result);
      const url = `https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`;

      await api.openExternal(url);
    }
  });

  const openDrawerMutation = useMutation({
    mutationFn: api.openCashDrawer
  });

  const loadHistoricClosureMutation = useMutation({
    mutationFn: api.cashClosureDetail,
    onSuccess: (result) => {
      setLastClosedPreview(result);
      setHistoricClosurePasswordModal(false);
      setHistoricClosurePassword('');
      setHistoricClosurePasswordError(null);
      setPendingHistoricClosureId(null);
    }
  });

  const verifyHistoricClosurePasswordMutation = useMutation({
    mutationFn: (password: string) => api.verifyPassword(password),
    onSuccess: async () => {
      if (pendingHistoricClosureId === null) return;
      await loadHistoricClosureMutation.mutateAsync(pendingHistoricClosureId);
    },
    onError: (error: Error) => {
      setHistoricClosurePasswordError(error.message);
    }
  });

  const movementMutation = useMutation({
    mutationFn: api.addCashMovement,
    onSuccess: async () => {
      setMovementAmount(0);
      setMovementNotes('');
      setMovementError(null);
      showToast('Movimiento registrado.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
    },
    onError: (error: Error) => {
      setMovementError(error.message);
    }
  });

  const { data: historyClosures = [] } = useQuery({
    queryKey: ['cash-closures-history', historyFrom, historyTo],
    queryFn: () =>
      api.listCashClosures({
        from: historyFrom || null,
        to: historyTo || null,
        limit: 100
      }),
    enabled: historyModalOpen
  });

  const totalSessionSales =
    (data?.totalsByMethod ?? []).reduce(
      (sum, item) => sum + Number(item.amount ?? 0),
      0
    );

  const systemAmount = Number(data?.systemAmount ?? 0);
  const cashOnlyAmount = Number(data?.cashOnlyAmount ?? 0);
  const manualCashIn = Number(data?.manualCashIn ?? 0);
  const manualCashOut = Number(data?.manualCashOut ?? 0);
  const cashRefunds = Number(data?.cashRefunds ?? 0);

  const handleSubmitMovement = () => {
    if (!data?.activeSession) {
      setMovementError('Debes abrir caja antes de registrar movimientos.');
      return;
    }
    if (!movementAmount || movementAmount <= 0) {
      setMovementError('El monto debe ser mayor a 0.');
      return;
    }
    setMovementError(null);
    movementMutation.mutate({
      type: movementType,
      amount: movementAmount,
      notes: movementNotes.trim() || null
    });
  };

  const closurePreview = useMemo(
    () => lastClosedPreview ?? closeMutation.data ?? null,
    [lastClosedPreview, closeMutation.data]
  );

  const handleRequestHistoricClosure = (closureId: number) => {
    setPendingHistoricClosureId(closureId);
    setHistoricClosurePassword('');
    setHistoricClosurePasswordError(null);
    setHistoricClosurePasswordModal(true);
  };

  const handleConfirmHistoricClosurePassword = async () => {
    if (!historicClosurePassword.trim()) {
      setHistoricClosurePasswordError('Debes ingresar la contraseña.');
      return;
    }

    await verifyHistoricClosurePasswordMutation.mutateAsync(historicClosurePassword);
  };

  const handlePrintThermalClose = () => {
    if (!closurePreview) return;
    if (!isHardwareSupported) return;

    const html = buildThermalCloseHtml(closurePreview);
    const printWindow = window.open('', '_blank', 'width=430,height=900');

    if (!printWindow) {
      showToast('No se pudo abrir la ventana de impresión. Revisa el bloqueador de ventanas emergentes.', 'error');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  };

  const handleSaveClosurePdf = async () => {
    if (!closurePreview) return;

    try {
      const result = await api.printToPdfAuto({
        defaultFileName: `Cierre-caja-${closurePreview.cashSessionId}-${String(closurePreview.closedAt ?? '').slice(0, 10) || 'sin-fecha'}.pdf`,
        targetDir: pdfOutputDir ?? null,
        subfolder: 'Caja',
        pageSize: 'A4',
        preferCssPageSize: true
      });

      showToast(`PDF guardado en: ${result.path ?? 'carpeta configurada'}`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No fue posible guardar el PDF del cierre.', 'error');
    }
  };

  const handleOpenCash = () => {
    if (!String(openedByName).trim()) {
      setOpenCashError('Debes ingresar el nombre de quien abre la caja.');
      return;
    }

    if (!String(openedByPhone).trim()) {
      setOpenCashError('Debes ingresar el celular de quien abre la caja.');
      return;
    }

    setOpenCashError(null);

    openMutation.mutate({
      openingAmount,
      openedByName: openedByName.trim(),
      openedByPhone: openedByPhone.trim()
    });
  };

  const applyOpeningPreset = (preset: CashOpeningPreset) => {
    setOpenedByName(preset.openedByName);
    setOpenedByPhone(preset.openedByPhone);
    setAdminWhatsapp(preset.adminWhatsapp);
  };

  return (
    <section className="stack-gap cash-page">
      {closurePreview ? <CashClosurePrintReport data={closurePreview} /> : null}
      <style>{`
        .cash-closure-print-root {
          display: none;
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }

          html,
          body,
          #root {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            overflow-x: hidden !important;
            background: #fff !important;
            box-sizing: border-box !important;
            transform: none !important;
            zoom: 1 !important;
          }

          .app-shell,
          .content-shell,
          .page-content,
          .cash-page {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            overflow-x: hidden !important;
            box-shadow: none !important;
            transform: none !important;
          }

          .cash-page > :not(.cash-closure-print-root),
          .sidebar,
          .topbar,
          .modal-overlay,
          .row-actions,
          .form-actions,
          button,
          input,
          select,
          textarea {
            display: none !important;
          }

          .cash-closure-print-root,
          .cash-closure-print-root * {
            box-sizing: border-box !important;
            max-width: 100% !important;
            overflow: visible !important;
            transform: none !important;
          }

          .cash-closure-print-root {
            display: block !important;
            width: 100% !important;
            max-width: 186mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            color: #111827 !important;
            background: #fff !important;
            font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
            font-size: 10.5px !important;
            line-height: 1.35 !important;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          .cash-print-header {
            display: flex !important;
            justify-content: space-between !important;
            gap: 12px !important;
            align-items: flex-start !important;
            border-bottom: 2px solid #111827 !important;
            padding-bottom: 8px !important;
            margin-bottom: 10px !important;
          }

          .cash-print-header h1 {
            margin: 0 !important;
            font-size: 18px !important;
            line-height: 1.15 !important;
            letter-spacing: 0 !important;
          }

          .cash-print-header p,
          .cash-print-note,
          .cash-print-empty {
            margin: 3px 0 0 !important;
          }

          .cash-print-meta {
            display: grid !important;
            gap: 2px !important;
            text-align: right !important;
            white-space: normal !important;
          }

          .cash-print-company-grid,
          .cash-print-totals-grid {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 6px 12px !important;
            width: 100% !important;
          }

          .cash-print-company-grid {
            margin-bottom: 10px !important;
          }

          .cash-print-company-grid > div {
            display: grid !important;
            gap: 2px !important;
            border: 1px solid #d1d5db !important;
            padding: 6px !important;
            break-inside: avoid !important;
          }

          .cash-print-company-grid span,
          .cash-print-row span {
            color: #4b5563 !important;
          }

          .cash-print-company-grid strong,
          .cash-print-row strong {
            color: #111827 !important;
          }

          .cash-print-section {
            width: 100% !important;
            margin: 0 0 9px !important;
            padding: 0 !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .cash-print-section h2 {
            margin: 0 0 5px !important;
            padding: 4px 6px !important;
            background: #f3f4f6 !important;
            border: 1px solid #d1d5db !important;
            color: #111827 !important;
            font-size: 11px !important;
            line-height: 1.2 !important;
            text-transform: uppercase !important;
            letter-spacing: 0 !important;
          }

          .cash-print-rows {
            display: grid !important;
            gap: 0 !important;
            width: 100% !important;
            border-top: 1px solid #e5e7eb !important;
          }

          .cash-print-row {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) max-content !important;
            gap: 10px !important;
            align-items: start !important;
            width: 100% !important;
            padding: 4px 0 !important;
            border-bottom: 1px solid #e5e7eb !important;
            break-inside: avoid !important;
          }

          .cash-print-row-strong {
            font-weight: 800 !important;
          }

          .cash-print-row span {
            min-width: 0 !important;
            word-break: break-word !important;
          }

          .cash-print-row strong {
            white-space: nowrap !important;
            text-align: right !important;
          }

          .cash-print-table {
            width: 100% !important;
            max-width: 100% !important;
            border-collapse: collapse !important;
            table-layout: fixed !important;
            font-size: 9px !important;
          }

          .cash-print-table th,
          .cash-print-table td {
            border: 1px solid #d1d5db !important;
            padding: 4px !important;
            text-align: left !important;
            vertical-align: top !important;
            white-space: normal !important;
            word-break: break-word !important;
          }

          .cash-print-table th {
            background: #f3f4f6 !important;
            color: #111827 !important;
            font-weight: 800 !important;
          }
        }
      `}</style>
      <PageHeader
        title="Caja activa"
        subtitle="Resumen por método, apertura actual, cajón y movimientos recientes."
      />

      {!data?.activeSession ? (
        <div className="card-panel stack-gap">
          <h3>Apertura de caja</h3>

          {data?.lastClosure && (
            <div className="card-panel" style={{ background: '#f8fafc' }}>
              <strong>Último cierre</strong>
              <p style={{ margin: '8px 0 0' }}>
                Cerrado: {dateTime(data.lastClosure.closedAt)}
              </p>
              <p style={{ margin: '4px 0 0' }}>
                Monto declarado: {currency(data.lastClosure.declaredAmount)}
              </p>
            </div>
          )}

          <label>
            <span>Nombre quien abre caja</span>
            <Input
              type="text"
              value={openedByName}
              onChange={(e) => setOpenedByName(e.target.value)}
              placeholder="Ej: Santiago Montañes"
            />
          </label>

          <label>
            <span>Celular quien abre caja</span>
            <Input
              type="text"
              value={openedByPhone}
              onChange={(e) => setOpenedByPhone(e.target.value)}
              placeholder="Ej: 3001234567"
            />
          </label>

          <label>
            <span>WhatsApp administrador para cierre</span>
            <Input
              type="text"
              placeholder="Ej: 3001234567 o 573001234567"
              value={adminWhatsapp}
              onChange={(e) => setAdminWhatsapp(e.target.value)}
            />
          </label>

          {openingPresets.length ? (
            <div className="card-panel stack-gap" style={{ background: '#f8fafc' }}>
              <strong>Últimos datos usados</strong>
              {openingPresets.map((preset, index) => (
                <div
                  key={`${preset.openedByName}-${preset.openedByPhone}-${preset.adminWhatsapp}-${index}`}
                  className="recent-preset-row"
                >
                  <div>
                    <strong>{preset.openedByName}</strong>
                    <p style={{ margin: '4px 0 0' }}>
                      {preset.openedByPhone || 'Sin celular'} | Admin: {preset.adminWhatsapp || 'Sin WhatsApp'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => applyOpeningPreset(preset)}
                  >
                    Seleccionar
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <label>
            <span>Monto inicial</span>
            <PriceInput
              value={openingAmount}
              onChange={(v) => setOpeningAmount(v)}
            />
          </label>

          <div className="form-actions">
            <Button onClick={handleOpenCash} disabled={openMutation.isPending}>
              {openMutation.isPending ? 'Abriendo...' : 'Abrir caja'}
            </Button>
          </div>

          {openCashError && <p className="error-text">{openCashError}</p>}

          {openMutation.isError && (
            <p className="error-text">{openMutation.error.message}</p>
          )}
        </div>
      ) : (
        <>
          <div className="summary-grid">
            <SummaryCard
              title="Caja activa"
              value={`#${data.activeSession.id}`}
              accent="#5a7cff"
            />
            <SummaryCard
              title="Apertura"
              value={currency(data.activeSession.openingAmount)}
              accent="#a67c52"
            />
            <SummaryCard
              title="Abierta"
              value={dateTime(data.activeSession.openedAt)}
              accent="#63b08c"
            />
            <SummaryCard
              title="Estado"
              value={data.activeSession.status}
              accent="#d5a24f"
            />
          </div>

          <div className="summary-grid">
            <SummaryCard
              title="Esperado en efectivo"
              value={currency(cashOnlyAmount)}
              accent="#1e8a4f"
            />
            <SummaryCard
              title="Total sistema (todos los métodos)"
              value={currency(systemAmount)}
              accent="#6786a8"
            />
            <SummaryCard
              title="Ventas sesión"
              value={currency(totalSessionSales)}
              accent="#5fae88"
            />
            <SummaryCard
              title="Gastos sesión"
              value={currency(data.totalExpenses ?? 0)}
              accent="#c97373"
            />
            <SummaryCard
              title="Último cierre"
              value={currency(data.lastClosure?.declaredAmount ?? 0)}
              accent="#7a8a94"
            />
          </div>

          {(manualCashIn > 0 || manualCashOut > 0 || cashRefunds > 0) && (
            <div className="summary-grid">
              <SummaryCard
                title="Ingresos manuales"
                value={currency(manualCashIn)}
                accent="#1e8a4f"
              />
              <SummaryCard
                title="Egresos manuales"
                value={currency(manualCashOut)}
                accent="#c97373"
              />
              <SummaryCard
                title="Devoluciones efectivo"
                value={currency(cashRefunds)}
                accent="#a06b1e"
              />
            </div>
          )}

          <div className="card-panel stack-gap">
            <h3>Datos de apertura</h3>

            <div className="detail-row">
              <span>Abrió caja</span>
              <strong>{data.activeSession.openedByName || '—'}</strong>
            </div>

            <div className="detail-row">
              <span>Celular</span>
              <strong>{data.activeSession.openedByPhone || '—'}</strong>
            </div>
          </div>

          <div className="split-grid">
            <div className="card-panel">
              <h3>Totales por método</h3>
              <DataTable
                rows={data.totalsByMethod}
                columns={[
                  {
                    key: 'method',
                    header: 'Método',
                    render: (row) => row.methodName
                  },
                  {
                    key: 'amount',
                    header: 'Monto',
                    render: (row) => currency(row.amount)
                  }
                ]}
              />
            </div>

            <div className="card-panel stack-gap">
              <h3>Cierre de caja</h3>

              <label>
                <span>WhatsApp administrador para cierre</span>
                <Input
                  type="text"
                  placeholder="Ej: 3001234567 o 573001234567"
                  value={adminWhatsapp}
                  onChange={(e) => setAdminWhatsapp(e.target.value)}
                />
              </label>

              <div className="detail-row">
                <span>Apertura</span>
                <strong>{currency(data.activeSession.openingAmount)}</strong>
              </div>

              <div className="detail-row">
                <span>Ventas de la sesión</span>
                <strong>{currency(totalSessionSales)}</strong>
              </div>

              <div className="detail-row">
                <span>Gastos de la sesión</span>
                <strong>{currency(data.totalExpenses ?? 0)}</strong>
              </div>

              <div className="detail-row" style={{ background: '#ecfdf5', borderRadius: 6, padding: 8 }}>
                <span><strong>Esperado en efectivo (a contar)</strong></span>
                <strong style={{ color: '#15803d' }}>{currency(cashOnlyAmount)}</strong>
              </div>

              <div className="detail-row" style={{ fontSize: 12, opacity: 0.8 }}>
                <span>Total sistema (todos los métodos)</span>
                <span>{currency(systemAmount)}</span>
              </div>

              <label>
                <span>Efectivo contado al cierre</span>
                <PriceInput
                  value={declaredAmount}
                  onChange={(v) => setDeclaredAmount(v)}
                />
              </label>

              <div className="form-actions">
                <Button
                  variant="secondary"
                  onClick={() => setDeclaredAmount(cashOnlyAmount)}
                >
                  Usar valor esperado
                </Button>

                <Button onClick={() => closeMutation.mutate(declaredAmount)}>
                  Cerrar caja
                </Button>
              </div>

              {!normalizePhone(adminWhatsapp) && (
                <p className="error-text">
                  Si quieres que el cierre se envíe por WhatsApp, escribe aquí el
                  número del administrador.
                </p>
              )}

              {closeMutation.isError && (
                <p className="error-text">{closeMutation.error.message}</p>
              )}
            </div>
          </div>

          <div className="card-panel stack-gap">
            <h3>Abrir cajón</h3>

            {!isHardwareSupported ? (
              <div className="alert-warning">{hardwareMessage}</div>
            ) : (
              <>
                <label>
                  <span>Impresora</span>
                  <select
                    className="field"
                    value={selectedPrinter}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                  >
                    <option value="">Usar impresora predeterminada</option>
                    {printers.map((printer) => (
                      <option key={printer.name} value={printer.name}>
                        {printer.name}
                        {printer.isDefault ? ' (Predeterminada)' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="form-actions">
                  <Button
                    onClick={() =>
                      openDrawerMutation.mutate(selectedPrinter || undefined)
                    }
                    disabled={openDrawerMutation.isPending}
                  >
                    {openDrawerMutation.isPending ? 'Abriendo...' : 'Abrir cajón'}
                  </Button>
                </div>

                {openDrawerMutation.data && (
                  <div className="card-panel" style={{ background: '#f8fafc' }}>
                    <p style={{ margin: 0 }}>
                      <strong>Resultado:</strong> {openDrawerMutation.data.message}
                    </p>
                    <p style={{ margin: '6px 0 0' }}>
                      <strong>Impresora:</strong> {openDrawerMutation.data.printerName}
                    </p>
                  </div>
                )}

                {openDrawerMutation.isError && (
                  <p className="error-text">
                    {(openDrawerMutation.error as Error).message}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="card-panel">
            <h3>Gastos por método (sesión)</h3>
            <DataTable
              rows={data.expensesByMethod}
              columns={[
                {
                  key: 'method',
                  header: 'Método',
                  render: (row) => row.methodName
                },
                {
                  key: 'amount',
                  header: 'Monto',
                  render: (row) => currency(row.amount)
                }
              ]}
            />
          </div>

          <div className="card-panel stack-gap">
            <h3>Movimiento manual de caja</h3>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
              Registra ingresos (préstamos, base extra) o egresos (retiros, fondo) que afecten el efectivo en caja.
            </p>

            <label>
              <span>Tipo</span>
              <select
                className="field"
                value={movementType}
                onChange={(e) => setMovementType(e.target.value as 'CASH_IN' | 'CASH_OUT')}
              >
                <option value="CASH_IN">Ingreso a caja (CASH_IN)</option>
                <option value="CASH_OUT">Salida de caja (CASH_OUT)</option>
              </select>
            </label>

            <label>
              <span>Monto</span>
              <PriceInput value={movementAmount} onChange={(v) => setMovementAmount(v)} />
            </label>

            <label>
              <span>Notas / motivo</span>
              <Input
                type="text"
                value={movementNotes}
                onChange={(e) => setMovementNotes(e.target.value)}
                placeholder="Ej: Retiro propietario, base de cambios extra…"
              />
            </label>

            <div className="form-actions">
              <Button
                onClick={handleSubmitMovement}
                disabled={movementMutation.isPending}
              >
                {movementMutation.isPending ? 'Registrando...' : 'Registrar movimiento'}
              </Button>
            </div>

            {movementError && <p className="error-text">{movementError}</p>}
          </div>

          <div className="card-panel">
            <h3>Movimientos recientes</h3>
            <DataTable
              rows={data.recentMovements}
              columns={[
                {
                  key: 'type',
                  header: 'Tipo',
                  render: (row) => formatMovementTypeLabel(row.movementType)
                },
                {
                  key: 'amount',
                  header: 'Monto',
                  render: (row) => currency(row.amount)
                },
                {
                  key: 'notes',
                  header: 'Notas',
                  render: (row) => row.notes || '—'
                },
                {
                  key: 'date',
                  header: 'Fecha',
                  render: (row) => dateTime(row.createdAt)
                }
              ]}
            />
          </div>
        </>
      )}

      {closurePreview && (
        <div className="card-panel stack-gap" style={{ background: '#f8fafc' }}>
          <h3>Último cierre generado</h3>

          <div
            style={{
              background: '#ecfdf5',
              padding: 12,
              borderRadius: 6,
              border: '1px solid #bbf7d0'
            }}
          >
            <p style={{ margin: 0 }}>
              <strong>Esperado en efectivo:</strong>{' '}
              <span style={{ color: '#15803d', fontWeight: 700 }}>
                {currency(closurePreview.cashOnlyAmount ?? closurePreview.systemAmount)}
              </span>
            </p>
            <p style={{ margin: '6px 0 0' }}>
              <strong>Declarado:</strong> {currency(closurePreview.declaredAmount)}
            </p>
            <p style={{ margin: '6px 0 0' }}>
              <strong>Diferencia (efectivo):</strong>{' '}
              <span
                style={{
                  color:
                    closurePreview.differenceAmount === 0
                      ? '#15803d'
                      : closurePreview.differenceAmount > 0
                      ? '#1e8a4f'
                      : '#b91c1c',
                  fontWeight: 700
                }}
              >
                {currency(closurePreview.differenceAmount)}
              </span>
            </p>
          </div>

          <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
            Total sistema (todos los métodos, informativo):{' '}
            {currency(closurePreview.systemAmount)}
          </p>

          <p style={{ margin: 0 }}>
            <strong>Abrió caja:</strong> {closurePreview.openedByName || '—'}
          </p>
          <p style={{ margin: '6px 0 0' }}>
            <strong>Celular:</strong> {closurePreview.openedByPhone || '—'}
          </p>

          <div className="form-actions" style={{ marginTop: 12 }}>
            <Button variant="secondary" onClick={handleSaveClosurePdf}>
              Guardar PDF
            </Button>
            {!isHardwareSupported ? (
              <div className="alert-warning" style={{ width: '100%' }}>
                {hardwareMessage}
              </div>
            ) : (
              <Button variant="secondary" onClick={handlePrintThermalClose}>
                Imprimir cierre térmico
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="card-panel stack-gap">
        <div className="form-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Últimos 5 cierres de caja</h3>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setHistoryModalOpen(true)}
          >
            Ver historial completo
          </Button>
        </div>
        <DataTable
          rows={data?.recentClosures ?? []}
          columns={[
            {
              key: 'session',
              header: 'Sesión',
              render: (row) => `#${row.cashSessionId}`
            },
            {
              key: 'declared',
              header: 'Declarado',
              render: (row) => currency(row.declaredAmount)
            },
            {
              key: 'system',
              header: 'Esperado efectivo',
              render: (row) => currency(row.systemAmount)
            },
            {
              key: 'difference',
              header: 'Diferencia',
              render: (row) => (
                <span
                  style={{
                    color:
                      row.differenceAmount === 0
                        ? '#15803d'
                        : row.differenceAmount > 0
                        ? '#1e8a4f'
                        : '#b91c1c',
                    fontWeight: 600
                  }}
                >
                  {currency(row.differenceAmount)}
                </span>
              )
            },
            {
              key: 'closedAt',
              header: 'Fecha',
              render: (row) => dateTime(row.closedAt)
            },
            {
              key: 'actions',
              header: 'Acciones',
              render: (row) => (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleRequestHistoricClosure(row.id)}
                  disabled={verifyHistoricClosurePasswordMutation.isPending || loadHistoricClosureMutation.isPending}
                >
                  Ver
                </Button>
              )
            }
          ]}
        />
      </div>

      {closurePreview?.deliveredOrders?.length ? (
        <div className="card-panel">
          <h3>Órdenes entregadas en este cierre</h3>
          <DataTable
            rows={closurePreview.deliveredOrders}
            columns={[
              {
                key: 'order',
                header: 'Orden',
                render: (row) => row.orderNumber
              },
              {
                key: 'who',
                header: 'Recibe',
                render: (row) => row.deliveredTo || '—'
              },
              {
                key: 'total',
                header: 'Total orden',
                render: (row) => currency(row.total)
              },
              {
                key: 'paid',
                header: 'Abonado',
                render: (row) => currency(row.paidTotal)
              },
              {
                key: 'balance',
                header: 'Saldo',
                render: (row) =>
                  currency(Math.max(0, row.total - row.paidTotal))
              },
              {
                key: 'method',
                header: 'Método de pago',
                render: (row) => row.paymentMethods || '—'
              },
              {
                key: 'date',
                header: 'Fecha entrega',
                render: (row) =>
                  row.deliveredAt ? dateTime(row.deliveredAt) : '—'
              }
            ]}
          />
        </div>
      ) : null}

      {closurePreview?.sessionPayments?.length ? (
        <div className="card-panel">
          <h3>Abonos registrados en la sesión</h3>
          <DataTable
            rows={closurePreview.sessionPayments}
            columns={[
              {
                key: 'order',
                header: 'Orden',
                render: (row) => row.orderNumber
              },
              {
                key: 'client',
                header: 'Cliente',
                render: (row) => row.clientName
              },
              {
                key: 'amount',
                header: 'Abono',
                render: (row) => currency(row.amount)
              },
              {
                key: 'method',
                header: 'Método',
                render: (row) => row.paymentMethodName
              },
              {
                key: 'reference',
                header: 'Referencia',
                render: (row) => row.reference || '—'
              },
              {
                key: 'date',
                header: 'Fecha',
                render: (row) => dateTime(row.createdAt)
              }
            ]}
          />
        </div>
      ) : null}

      {closurePreview?.voidedPayments?.length ? (
        <div className="card-panel">
          <h3>Pagos anulados</h3>
          <DataTable
            rows={closurePreview.voidedPayments}
            columns={[
              { key: 'order', header: 'Orden', render: (row) => row.orderNumber },
              { key: 'client', header: 'Cliente', render: (row) => row.clientName },
              { key: 'amount', header: 'Monto', render: (row) => `-${currency(row.amount)}` },
              { key: 'method', header: 'Método', render: (row) => row.paymentMethodName },
              { key: 'reason', header: 'Motivo', render: (row) => row.reason || '—' },
              {
                key: 'date',
                header: 'Fecha anulación',
                render: (row) => row.voidedAt ? dateTime(row.voidedAt) : '—'
              }
            ]}
          />
        </div>
      ) : null}

      <Modal
        open={historicClosurePasswordModal}
        title="Ver cierre anterior"
        onClose={() => {
          setHistoricClosurePasswordModal(false);
          setHistoricClosurePassword('');
          setHistoricClosurePasswordError(null);
          setPendingHistoricClosureId(null);
        }}
      >
        <div className="stack-gap">
          <p style={{ margin: 0 }}>
            Ingresa la misma contraseña administrativa usada para editar órdenes.
          </p>

          <label>
            <span>Contraseña</span>
            <Input
              type="password"
              value={historicClosurePassword}
              onChange={(e) => setHistoricClosurePassword(e.target.value)}
            />
          </label>

          {historicClosurePasswordError && (
            <p className="error-text">{historicClosurePasswordError}</p>
          )}

          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setHistoricClosurePasswordModal(false);
                setHistoricClosurePassword('');
                setHistoricClosurePasswordError(null);
                setPendingHistoricClosureId(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmHistoricClosurePassword}
              disabled={verifyHistoricClosurePasswordMutation.isPending || loadHistoricClosureMutation.isPending}
            >
              {verifyHistoricClosurePasswordMutation.isPending || loadHistoricClosureMutation.isPending
                ? 'Verificando...'
                : 'Confirmar'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={historyModalOpen}
        title="Historial completo de cierres"
        onClose={() => setHistoryModalOpen(false)}
      >
        <div className="stack-gap">
          <div className="split-grid">
            <label>
              <span>Desde</span>
              <Input
                type="date"
                value={historyFrom}
                onChange={(e) => setHistoryFrom(e.target.value)}
              />
            </label>
            <label>
              <span>Hasta</span>
              <Input
                type="date"
                value={historyTo}
                onChange={(e) => setHistoryTo(e.target.value)}
              />
            </label>
          </div>

          <DataTable
            rows={historyClosures}
            columns={[
              {
                key: 'session',
                header: 'Sesión',
                render: (row) => `#${row.cashSessionId}`
              },
              {
                key: 'declared',
                header: 'Declarado',
                render: (row) => currency(row.declaredAmount)
              },
              {
                key: 'system',
                header: 'Esperado efectivo',
                render: (row) => currency(row.systemAmount)
              },
              {
                key: 'difference',
                header: 'Diferencia',
                render: (row) => (
                  <span
                    style={{
                      color:
                        row.differenceAmount === 0
                          ? '#15803d'
                          : row.differenceAmount > 0
                          ? '#1e8a4f'
                          : '#b91c1c',
                      fontWeight: 600
                    }}
                  >
                    {currency(row.differenceAmount)}
                  </span>
                )
              },
              {
                key: 'closedAt',
                header: 'Fecha',
                render: (row) => dateTime(row.closedAt)
              },
              {
                key: 'actions',
                header: 'Acciones',
                render: (row) => (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setHistoryModalOpen(false);
                      handleRequestHistoricClosure(row.id);
                    }}
                  >
                    Ver
                  </Button>
                )
              }
            ]}
          />

          <div className="form-actions">
            <Button variant="secondary" onClick={() => setHistoryModalOpen(false)}>
              Cerrar
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
};

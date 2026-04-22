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

  return `*CIERRE DE CAJA*
🏪 Negocio: ${data.companyName || 'Mi Negocio'}
🧾 NIT: ${data.companyNit || '—'}
👤 Cajero cierre: ${data.cashierName || 'Administrador'}
🙍 Abrió caja: ${data.openedByName || '—'}
📱 Celular apertura: ${data.openedByPhone || '—'}
🕒 Fecha: ${data.closedAt ? new Date(data.closedAt).toLocaleString('es-CO') : '—'}
🔢 Sesión: #${data.cashSessionId}

*RESUMEN*
💵 Apertura: ${new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(data.openingAmount)}
💰 Sistema: ${new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(data.systemAmount)}
💲 Declarado: ${new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(data.declaredAmount)}
➕➖ Diferencia: ${new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(data.differenceAmount)}

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
            overflow: hidden;
          }

          body {
            padding: 8px 2px;
            font-size: 10px;
            line-height: 1.4;
            font-weight: 700;
            -webkit-font-smoothing: none;
            text-rendering: geometricPrecision;
            overflow: hidden;
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
            display: flex;
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
              overflow: idden;
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
        <div class="row"><span>Declarado</span><span>${formatMoney(data.declaredAmount)}</span></div>
        <div class="row"><span>Sistema</span><span>${formatMoney(data.systemAmount)}</span></div>
        <div class="row"><span>Gastos sesión</span><span>${formatMoney(data.totalExpenses ?? 0)}</span></div>
        <div class="row"><span>Diferencia</span><span>${formatMoney(data.differenceAmount)}</span></div>

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

  const totalSessionSales =
    (data?.totalsByMethod ?? []).reduce(
      (sum, item) => sum + Number(item.amount ?? 0),
      0
    );

  const systemAmount = Number(data?.systemAmount ?? 0);

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
      alert('No se pudo abrir la ventana de impresión.');
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
        subfolder: 'Caja'
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
    <section className="stack-gap">
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
              title="Sistema"
              value={currency(systemAmount)}
              accent="#6786a8"
            />
            <SummaryCard
              title="Último cierre"
              value={currency(data.lastClosure?.declaredAmount ?? 0)}
              accent="#c97373"
            />
            <SummaryCard
              title="Movimientos"
              value={String(data.recentMovements.length)}
              accent="#7a8a94"
            />
          </div>

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

              <div className="detail-row">
                <span>Total sistema</span>
                <strong>{currency(systemAmount)}</strong>
              </div>

              <label>
                <span>Efectivo / total contado al cierre</span>
                <PriceInput
                  value={declaredAmount}
                  onChange={(v) => setDeclaredAmount(v)}
                />
              </label>

              <div className="form-actions">
                <Button
                  variant="secondary"
                  onClick={() => setDeclaredAmount(systemAmount)}
                >
                  Usar valor sistema
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

          <p style={{ margin: 0 }}>
            <strong>Sistema:</strong> {currency(closurePreview.systemAmount)}
          </p>
          <p style={{ margin: '6px 0 0' }}>
            <strong>Declarado:</strong> {currency(closurePreview.declaredAmount)}
          </p>
          <p style={{ margin: '6px 0 0' }}>
            <strong>Diferencia:</strong> {currency(closurePreview.differenceAmount)}
          </p>
          <p style={{ margin: '6px 0 0' }}>
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

      <div className="card-panel">
        <h3>Últimos 5 cierres de caja</h3>
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
              header: 'Sistema',
              render: (row) => currency(row.systemAmount)
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
    </section>
  );
};

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { HealthStatus, PendingReadyCheck, SessionUser } from '@shared/types';
import { api } from './services/api';
import { AppShell } from './ui/layouts/AppShell';
import { Modal } from './ui/components';
import { SetupPage } from './modules/shared/components/SetupPage';
import { LoginPage } from './modules/auth/pages/LoginPage';
import { DashboardPage } from './modules/dashboard/pages/DashboardPage';
import { ClientsPage } from './modules/clients/pages/ClientsPage';
import { NewOrderPage } from './modules/orders/pages/NewOrderPage';
import { OrderDetailPage } from './modules/orders/pages/OrderDetailPage';
import { OrdersPage } from './modules/orders/pages/OrdersPage';
import { PaymentsPage } from './modules/payments/pages/PaymentsPage';
import { InvoicesPage } from './modules/invoices/pages/InvoicesPage';
import { InvoiceDetailPage } from './modules/invoices/pages/InvoiceDetailPage';
import { CashPage } from './modules/cash/pages/CashPage';
import { DeliveriesPage } from './modules/deliveries/pages/DeliveriesPage';
import { InventoryPage } from './modules/inventory/pages/InventoryPage';
import { ExpensesPage } from './modules/expenses/pages/ExpensesPage';
import { WarrantiesPage } from './modules/warranties/pages/WarrantiesPage';
import { ReportsPage } from './modules/reports/pages/ReportsPage';
import { WhatsappPage } from './modules/whatsapp/pages/WhatsappPage';
import { SettingsPage } from './modules/settings/pages/SettingsPage';
import { UsersPage } from './modules/users/pages/UsersPage';
import { AuditPage } from './modules/audit/pages/AuditPage';
import { LicensePage } from './modules/license/pages/LicensePage';
import { LicenseRenewalBanner } from './modules/license/components/LicenseRenewalBanner';

export default function App() {
  const [licenseReady, setLicenseReady] = useState(false);
  const [licenseValid, setLicenseValid] = useState(false);
  const [licenseWarning, setLicenseWarning] = useState(false);
  const [licenseDaysLeft, setLicenseDaysLeft] = useState(0);
  const [licenseBusinessName, setLicenseBusinessName] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingReadyChecks, setPendingReadyChecks] = useState<PendingReadyCheck[]>([]);
  const [rescheduleReadyId, setRescheduleReadyId] = useState<number | null>(null);
  const [rescheduleReadyDate, setRescheduleReadyDate] = useState('');
  const [rescheduleReadyError, setRescheduleReadyError] = useState<string | null>(null);
  // Password step before showing the date picker
  const [rescheduleReadyPasswordModal, setRescheduleReadyPasswordModal] = useState(false);
  const [rescheduleReadyPassword, setRescheduleReadyPassword] = useState('');
  const [rescheduleReadyPasswordError, setRescheduleReadyPasswordError] = useState<string | null>(null);
  const [rescheduleReadyPendingId, setRescheduleReadyPendingId] = useState<number | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const readyStatusIdRef = useRef<number | null>(null);


  const refreshHealth = async () => {
    const nextHealth = await api.health();
    setHealth(nextHealth);
    setUser(null);
  };

  useEffect(() => {
    api.orderCatalogs().then((catalogs) => {
      const readyStatus = catalogs?.statuses?.find(
        (s) => String(s.code).toUpperCase() === 'READY'
      );
      if (readyStatus) readyStatusIdRef.current = readyStatus.id;
    }).catch(() => {});

    const unsubReady = window.desktopApi.onReadyCheckPending((checks) => {
      setPendingReadyChecks(checks);
    });

    const unsubStatusChanged = window.desktopApi.onOrdersStatusChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    });

    return () => { unsubReady(); unsubStatusChanged(); };
  }, [queryClient]);

  useEffect(() => {
    api.health().then(setHealth).finally(() => setLoading(false));

    api.licenseStatus()
      .then((result) => {
        setLicenseValid(Boolean(result?.valid));

        if (result?.valid && result?.warning) {
          setLicenseWarning(true);
          setLicenseDaysLeft(Number(result?.daysLeft ?? 0));
          setLicenseBusinessName(result?.businessName ?? null);
        } else {
          setLicenseWarning(false);
          setLicenseDaysLeft(0);
          setLicenseBusinessName(null);
        }
      })
      .catch(() => {
        setLicenseValid(false);
        setLicenseWarning(false);
        setLicenseDaysLeft(0);
        setLicenseBusinessName(null);
      })
      .finally(() => {
        setLicenseReady(true);
      });
  }, []);

  if (loading) {
    return <div className="center-page">Cargando aplicación...</div>;
  }

  if (!licenseReady) {
    return <div className="center-page">Validando licencia...</div>;
  }

  if (!licenseValid) {
    return <LicensePage onActivated={() => window.location.reload()} />;
  }

  if (!health?.configured || !health.connected) {
    return (
      <SetupPage
        healthMessage={health?.message ?? null}
        onCompleted={refreshHealth}
      />
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const isAdmin = Number(user.roleId) === 1;
  const withRole = (element: JSX.Element, adminOnly = false) =>
    adminOnly && !isAdmin ? <Navigate to="/ordenes" replace /> : element;

  const money = (v: number) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

  const buildReadyWaUrl = (phone: string, clientName: string, orderNumber: string, dueDate: string | null, total: number, paidTotal: number, balanceDue: number, items: Array<{ description: string; quantity: number }>, companyName: string) => {
    const dateStr = dueDate ? new Date(dueDate + 'T12:00:00').toLocaleDateString('es-CO') : 'Sin definir';
    const itemsText = items.length ? items.map((i) => `- ${i.description} - Cant: ${i.quantity}`).join('\n') : '- Sin ítems';
    const msg =
      `👔 *${companyName}*\n\n` +
      `Hola ${clientName}, nos complace informarte que tus prendas ya están listas para recoger.\n\n` +
      `📋 *Orden:* ${orderNumber}\n` +
      `📆 *Fecha prometida de entrega:* ${dateStr}\n\n` +
      `🧺 *Detalle de tu orden:*\n${itemsText}\n\n` +
      `💰 *Total:* ${money(total)}\n` +
      `💳 *Abono realizado:* ${money(paidTotal)}\n` +
      `🔖 *Saldo pendiente:* ${money(balanceDue)}\n\n` +
      `📍 Te esperamos en nuestra tienda en el horario de atención.\n\n` +
      `¡Gracias por confiar en nosotros!`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <>
      {licenseWarning && licenseDaysLeft > 0 && (
        <LicenseRenewalBanner
          daysLeft={licenseDaysLeft}
          businessName={licenseBusinessName}
        />
      )}

      <Routes>
        <Route element={
          <AppShell
            user={user}
            onLogout={() => setUser(null)}
            pendingReadyChecks={pendingReadyChecks}
            onConfirmReady={async (check) => {
              try {
                if (check.type === 'DUE_TOMORROW') {
                  const statusId = readyStatusIdRef.current;
                  if (!statusId) return;
                  await api.updateOrderStatus(check.orderId, statusId);
                  setPendingReadyChecks((prev) => prev.filter((c) => !(c.type === 'DUE_TOMORROW' && c.orderId === check.orderId)));
                  if (check.clientPhone) {
                    const [detail, company] = await Promise.all([
                      api.orderDetail(check.orderId).catch(() => null),
                      api.companySettings().catch(() => null)
                    ]);
                    if (detail) {
                      const url = buildReadyWaUrl(
                        check.clientPhone,
                        check.clientName,
                        check.orderNumber,
                        check.dueDate ?? null,
                        detail.total,
                        detail.paidTotal,
                        detail.balanceDue,
                        detail.items.map((i) => ({ description: i.description, quantity: i.quantity })),
                        company?.companyName ?? 'Lavandería'
                      );
                      await api.openExternal(url);
                    }
                  }
                } else {
                  const result = await api.confirmAndMakeReady(check.queueId);
                  if (result.whatsappUrl) api.openExternal(result.whatsappUrl);
                  setPendingReadyChecks((prev) => prev.filter((c) => c.queueId !== check.queueId || c.type === 'DUE_TOMORROW'));
                }
                await queryClient.invalidateQueries({ queryKey: ['orders'] });
                await queryClient.invalidateQueries({ queryKey: ['order-detail', check.orderId] });
                await queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
                await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                api.triggerReconcile().catch(() => {});
              } catch { /* silencioso */ }
            }}
            onRescheduleReady={(queueId) => {
              setRescheduleReadyPendingId(queueId);
              setRescheduleReadyPassword('');
              setRescheduleReadyPasswordError(null);
              setRescheduleReadyPasswordModal(true);
            }}
            onDismissAllNotifications={() => setPendingReadyChecks([])}
          />
        }>
          <Route path="/" element={withRole(<DashboardPage />, true)} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/ordenes" element={<OrdersPage />} />
          <Route path="/ordenes/nueva" element={<NewOrderPage />} />
          <Route path="/ordenes/:orderId" element={<OrderDetailPage />} />
          <Route path="/pagos" element={<PaymentsPage />} />
          <Route path="/facturacion" element={<InvoicesPage />} />
          <Route path="/facturas/:orderId" element={<InvoiceDetailPage user={user} />} />
          <Route path="/caja" element={<CashPage />} />
          <Route path="/entregas" element={<DeliveriesPage />} />
          <Route path="/gastos" element={<ExpensesPage />} />
          <Route path="/garantias" element={<WarrantiesPage />} />
          <Route path="/inventario" element={withRole(<InventoryPage />, true)} />
          <Route path="/reportes" element={withRole(<ReportsPage />, true)} />
          <Route path="/whatsapp" element={<WhatsappPage />} />
          <Route path="/configuracion" element={withRole(<SettingsPage user={user} />, true)} />
          <Route path="/usuarios" element={withRole(<UsersPage />, true)} />
          <Route
            path="/auditoria"
            element={withRole(<AuditPage />, true)}
          />
          <Route path="*" element={<Navigate to={isAdmin ? '/' : '/ordenes'} replace />} />
        </Route>
      </Routes>

      {/* Modal 1: contraseña para reagendar */}
      <Modal
        open={rescheduleReadyPasswordModal}
        title="Verificar contraseña"
        onClose={() => {
          setRescheduleReadyPasswordModal(false);
          setRescheduleReadyPassword('');
          setRescheduleReadyPasswordError(null);
          setRescheduleReadyPendingId(null);
        }}
      >
        <div className="stack-gap">
          <p style={{ marginTop: 0 }}>Ingresa la contraseña de administrador para editar la fecha promesa.</p>
          <input
            type="password"
            className="field"
            placeholder="Contraseña"
            value={rescheduleReadyPassword}
            autoFocus
            onChange={(e) => setRescheduleReadyPassword(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && rescheduleReadyPassword.trim()) {
                try {
                  await api.verifyPassword(rescheduleReadyPassword);
                  setRescheduleReadyPasswordModal(false);
                  setRescheduleReadyPassword('');
                  setRescheduleReadyPasswordError(null);
                  setRescheduleReadyId(rescheduleReadyPendingId);
                  setRescheduleReadyDate('');
                  setRescheduleReadyError(null);
                  setRescheduleReadyPendingId(null);
                } catch (err: any) {
                  setRescheduleReadyPasswordError(err?.message ?? 'Contraseña incorrecta');
                }
              }
            }}
          />
          {rescheduleReadyPasswordError && <p className="error-text">{rescheduleReadyPasswordError}</p>}
          <div className="form-actions">
            <button className="button button-secondary" onClick={() => {
              setRescheduleReadyPasswordModal(false);
              setRescheduleReadyPassword('');
              setRescheduleReadyPasswordError(null);
              setRescheduleReadyPendingId(null);
            }}>Cancelar</button>
            <button
              className="button button-primary"
              disabled={!rescheduleReadyPassword.trim()}
              onClick={async () => {
                try {
                  await api.verifyPassword(rescheduleReadyPassword);
                  setRescheduleReadyPasswordModal(false);
                  setRescheduleReadyPassword('');
                  setRescheduleReadyPasswordError(null);
                  setRescheduleReadyId(rescheduleReadyPendingId);
                  setRescheduleReadyDate('');
                  setRescheduleReadyError(null);
                  setRescheduleReadyPendingId(null);
                } catch (err: any) {
                  setRescheduleReadyPasswordError(err?.message ?? 'Contraseña incorrecta');
                }
              }}
            >
              Confirmar
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal 2: nueva fecha (solo se abre tras verificar contraseña) */}
      <Modal
        open={rescheduleReadyId !== null}
        title="Reagendar fecha promesa"
        onClose={() => { setRescheduleReadyId(null); setRescheduleReadyError(null); }}
      >
        <div className="stack-gap">
          <p style={{ marginTop: 0 }}>Ingresa la nueva fecha prometida para la orden.</p>
          <input
            type="date"
            className="field"
            value={rescheduleReadyDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setRescheduleReadyDate(e.target.value)}
          />
          {rescheduleReadyError && <p className="error-text">{rescheduleReadyError}</p>}
          <div className="form-actions">
            <button className="button button-secondary" onClick={() => { setRescheduleReadyId(null); setRescheduleReadyError(null); }}>Cancelar</button>
            <button
              className="button button-primary"
              disabled={!rescheduleReadyDate}
              onClick={async () => {
                if (!rescheduleReadyDate || rescheduleReadyId === null) return;
                try {
                  await api.rescheduleReadyQueue(rescheduleReadyId, rescheduleReadyDate);
                  setPendingReadyChecks((prev) => prev.filter((c) => c.queueId !== rescheduleReadyId));
                  setRescheduleReadyId(null);
                  setRescheduleReadyError(null);
                } catch (err: any) {
                  setRescheduleReadyError(err?.message ?? 'Error al reagendar');
                }
              }}
            >
              Confirmar
            </button>
          </div>
        </div>
      </Modal>

    </>
  );
}

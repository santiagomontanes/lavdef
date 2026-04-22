import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { useHardwareAvailability } from '@renderer/hooks/useHardwareAvailability';
import {
  Button,
  DataTable,
  Input,
  Modal,
  PageHeader,
  StatusChip
} from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';
import { showToast } from '@renderer/utils/toast';
import { PaymentForm } from '@renderer/modules/payments/components/PaymentForm';
import { OrderForm } from '../components/OrderForm';

import type { OrderStatus } from '@shared/types';

const buildOrderDraftStorageKey = (orderId: number) => `lavasuite:order-edit-draft:${orderId}`;

const CANCELLED_CODES = new Set(['CANCELLED', 'CANCELED', 'CANCELADO']);

const getValidNextStatuses = (
  currentCode: string,
  currentId: number,
  statuses: OrderStatus[]
): OrderStatus[] => {
  const code = (currentCode ?? '').toUpperCase();
  if (CANCELLED_CODES.has(code)) return [];
  return statuses.filter((s) => {
    const sc = s.code.toUpperCase();
    return sc !== code && s.id !== currentId;
  });
};

const tabs = ['Resumen', 'Pagos', 'Facturas', 'Entregas'] as const;

const renderValue = (value?: string | null) => {
  const text = String(value ?? '').trim();
  return text ? text : '—';
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

const money = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

const buildReadyMessage = ({
  clientName,
  orderNumber,
  total,
  paidTotal,
  balanceDue,
  dueDate,
  items,
  companyName
}: {
  clientName: string;
  orderNumber: string;
  total: number;
  paidTotal: number;
  balanceDue: number;
  dueDate?: string | null;
  items?: Array<{ description: string; quantity: number }>;
  companyName: string;
}) => {
  const dateStr = dueDate
    ? new Date(dueDate).toLocaleDateString('es-CO')
    : 'Sin definir';

  const itemsText = items?.length
    ? items.map((i) => `- ${i.description} - Cant: ${i.quantity}`).join('\n')
    : '- Sin ítems';

  return (
    `👔 *${companyName}*\n\n` +
    `Hola ${clientName}, nos complace informarte que tus prendas ya están listas para recoger.\n\n` +
    `📋 *Orden:* ${orderNumber}\n` +
    `📆 *Fecha prometida de entrega:* ${dateStr}\n\n` +
    `🧺 *Detalle de tu orden:*\n${itemsText}\n\n` +
    `💰 *Total:* ${money(total)}\n` +
    `💳 *Abono realizado:* ${money(paidTotal)}\n` +
    `🔖 *Saldo pendiente:* ${money(balanceDue)}\n\n` +
    `📍 Te esperamos en nuestra tienda en el horario de atención.\n\n` +
    `¡Gracias por confiar en nosotros!`
  );
};

export const OrderDetailPage = () => {
  const { isHardwareSupported, message: hardwareMessage } = useHardwareAvailability();
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: api.listClients
  });

  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const orderId = Number(params.orderId);
  const navigate = useNavigate();
  const [notes, setNotes] = useState('');

  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Resumen');
  const [paymentModal, setPaymentModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [restoredEditDraft, setRestoredEditDraft] = useState<any | null>(null);

  const [passwordModal, setPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'edit' | 'cancel' | 'status' | null>(null);
  const [pendingStatusId, setPendingStatusId] = useState<number | null>(null);

  useEffect(() => {
    if (searchParams.get('action') === 'pay') {
      setPaymentModal(true);
    }
  }, [searchParams]);

  const { data } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: () => api.orderDetail(orderId),
    enabled: Number.isFinite(orderId) && orderId > 0
  });

  const { data: catalogs } = useQuery({
    queryKey: ['order-catalogs'],
    queryFn: api.orderCatalogs
  });

  const { data: cashSummary } = useQuery({
    queryKey: ['cash-summary'],
    queryFn: api.cashSummary
  });

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: api.companySettings
  });

  const isCashOpen = Boolean(cashSummary?.activeSession);

  const paymentMutation = useMutation({
    mutationFn: api.createPaymentBatch,
    onSuccess: async (payments) => {
      setPaymentModal(false);

      await queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['payments'] });
      await queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      const hasCashLine = (payments ?? []).some((payment) => {
        const methodCode = String(
          catalogs?.paymentMethods?.find((method) => method.id === payment.paymentMethodId)?.code ?? ''
        ).trim().toLowerCase();
        const methodName = String(payment.paymentMethodName ?? '').trim().toLowerCase();
        return methodCode === 'cash' || methodName === 'efectivo';
      });

      if (hasCashLine && isHardwareSupported) {
        try {
          await api.openCashDrawer();
        } catch (error) {
          console.error('No se pudo abrir el cajón automáticamente:', error);
        }
      }
    }
  });

  const updateOrderMutation = useMutation({
    mutationFn: (input: any) => api.updateOrder(orderId, input),
    onSuccess: async () => {
      window.localStorage.removeItem(buildOrderDraftStorageKey(orderId));
      setRestoredEditDraft(null);
      setEditModal(false);
      await queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      showToast('La orden fue actualizada correctamente.', 'success');
      navigate('/ordenes');
    }
  });

  const saveNotesMutation = useMutation({
  mutationFn: async (value: string) => {
    if (!data) throw new Error('No hay datos de la orden');

    return api.updateOrder(orderId, {
      clientId: data.clientId,
      notes: value,
      dueDate: data.dueDate,
      discountTotal: data.discountTotal ?? 0,
      discountReason: data.discountReason ?? null,
      initialPaymentLines: [],
      items: data.items.map((item) => ({
        garmentTypeId: item.garmentTypeId,
        serviceId: item.serviceId,
        description: item.description,
        quantity: item.quantity,
        color: item.color,
        brand: item.brand,
        sizeReference: item.sizeReference,
        material: item.material,
        receivedCondition: item.receivedCondition,
        workDetail: item.workDetail,
        stains: item.stains,
        damages: item.damages,
        missingAccessories: item.missingAccessories,
        customerObservations: item.customerObservations,
        internalObservations: item.internalObservations,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount ?? 0,
        discountReason: item.discountReason ?? null,
        surchargeAmount: item.surchargeAmount ?? 0,
        surchargeReason: item.surchargeReason ?? null,
        subtotal: item.subtotal,
        total: item.total
      }))
    });
  },

  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    showToast('La información de la orden fue actualizada correctamente.', 'success');
    navigate('/ordenes');
  },

  onError: (error) => {
    showToast(error instanceof Error ? error.message : 'No fue posible actualizar la orden.', 'error');
  }
});

  const cancelOrderMutation = useMutation({
    mutationFn: () => api.cancelOrder(orderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  });

  const verifyPasswordMutation = useMutation({
    mutationFn: (plainPassword: string) => api.verifyPassword(plainPassword),
    onSuccess: async () => {
      const action = pendingAction;

      setPasswordModal(false);
      setPassword('');
      setPasswordError(null);
      setPendingAction(null);

      if (action === 'edit') {
        openEditModal();
        return;
      }

      if (action === 'cancel') {
        const ok = window.confirm('¿Seguro que deseas cancelar esta orden?');
        if (!ok) return;
        await cancelOrderMutation.mutateAsync();
      }

      if (action === 'status' && pendingStatusId !== null) {
        await updateStatusMutation.mutateAsync(pendingStatusId);
        setPendingStatusId(null);
      }
    },
    onError: (error: Error) => {
      setPasswordError(error.message);
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (statusId: number) => {
      return api.updateOrderStatus(orderId, statusId);
    },
    onSuccess: async (_result, statusId) => {
      await queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });

      const selectedStatus = catalogs?.statuses?.find((s) => s.id === statusId);
      const client = clients.find((c) => c.id === data?.clientId);
      const phone = normalizePhone(client?.phone);

      if (!selectedStatus || !data || !phone) return;

      const statusCode = String(selectedStatus.code ?? '').toUpperCase();

      if (statusCode === 'READY' || statusCode === 'READY_FOR_DELIVERY' || statusCode === 'LISTO') {
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(
          buildReadyMessage({
            clientName: data.clientName,
            orderNumber: data.orderNumber,
            total: data.total,
            paidTotal: data.paidTotal,
            balanceDue: data.balanceDue,
            dueDate: data.dueDate,
            items: data.items.map((i) => ({ description: i.description, quantity: i.quantity })),
            companyName: companySettings?.companyName ?? 'Lavandería'
          })
        )}`;

        await api.openExternal(url);
      }
    },
    onSettled: () => {
      api.triggerReconcile().catch(() => {});
    }
  });

  const requestProtectedAction = (action: 'edit' | 'cancel' | 'status') => {
    setPendingAction(action);
    setPassword('');
    setPasswordError(null);
    setPasswordModal(true);
  };

  const openEditModal = () => {
    try {
      const raw = window.localStorage.getItem(buildOrderDraftStorageKey(orderId));
      setRestoredEditDraft(raw ? JSON.parse(raw) : null);
    } catch {
      setRestoredEditDraft(null);
    }

    setEditModal(true);
  };

  const handleConfirmPassword = async () => {
    if (!password.trim()) {
      setPasswordError('Debes ingresar la contraseña.');
      return;
    }

    await verifyPasswordMutation.mutateAsync(password);
  };

  const tabContent = useMemo(() => {
    if (!data) return null;

    switch (activeTab) {
      case 'Pagos':
        return (
          <DataTable
            rows={data.payments}
            columns={[
              { key: 'method', header: 'Método', render: (row) => row.paymentMethodName },
              { key: 'amount', header: 'Monto', render: (row) => currency(row.amount) },
              { key: 'reference', header: 'Referencia', render: (row) => row.reference || '—' },
              { key: 'date', header: 'Fecha', render: (row) => dateTime(row.createdAt) }
            ]}
          />
        );

      case 'Facturas':
        return (
          <DataTable
            rows={data.invoices}
            columns={[
              { key: 'invoice', header: 'Factura', render: (row) => row.invoiceNumber },
              { key: 'total', header: 'Total', render: (row) => currency(row.total) },
              { key: 'date', header: 'Fecha', render: (row) => dateTime(row.createdAt) },
              {
                key: 'actions',
                header: 'Acciones',
                render: () => (
                  <Link to={`/facturas/${data.id}`} className="button button-secondary">
                    Ver factura
                  </Link>
                )
              }
            ]}
          />
        );

      case 'Entregas':
        return (
          <DataTable
            rows={data.deliveries}
            columns={[
              { key: 'who', header: 'Recibe', render: (row) => row.deliveredTo },
              { key: 'ticket', header: 'Ticket', render: (row) => row.ticketCode },
              { key: 'date', header: 'Fecha', render: (row) => dateTime(row.createdAt) }
            ]}
          />
        );

      default:
        const itemsDiscountTotal = data.items.reduce(
          (sum, item) => sum + Number(item.discountAmount ?? 0),
          0
        );
        const itemsSurchargeTotal = data.items.reduce(
          (sum, item) => sum + Number(item.surchargeAmount ?? 0),
          0
        );
        const discountReasons = Array.from(
          new Set(
            data.items
              .map((item) => String(item.discountReason ?? '').trim())
              .filter(Boolean)
          )
        );
        const surchargeReasons = Array.from(
          new Set(
            data.items
              .map((item) => String(item.surchargeReason ?? '').trim())
              .filter(Boolean)
          )
        );

        return (
          <div className="detail-grid">
            <div className="card-panel stack-gap">
              <div className="detail-row">
                <span>Cliente</span>
                <strong>{data.clientName}</strong>
              </div>

              <div className="detail-row" style={{ alignItems: 'center' }}>
                <span>Estado actual</span>
                <StatusChip label={data.statusName} color={data.statusColor} />
              </div>

              <label>
                <span>Cambiar estado</span>
                <select
                  className="field order-status-select"
                  value={data.statusId}
                  disabled={updateStatusMutation.isPending}
                  onChange={(e) => {
                    const nextStatusId = Number(e.target.value);
                    if (!nextStatusId || nextStatusId === data.statusId) return;
                    setPendingStatusId(nextStatusId);
                    requestProtectedAction('status');
                  }}
                >
                  <option value={data.statusId}>{data.statusName}</option>
                  {getValidNextStatuses(data.statusCode, data.statusId, catalogs?.statuses ?? []).map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="detail-row">
                <span>Fecha promesa</span>
                <strong>{data.dueDate ? dateTime(data.dueDate) : '—'}</strong>
              </div>

              <div
  className="detail-row"
  style={{
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6
  }}
>
  <span>Notas</span>

  <textarea
    value={notes}
    onChange={(e) => setNotes(e.target.value)}
    placeholder="Escribe notas de la orden..."
    style={{
      width: '100%',
      minHeight: 60,
      resize: 'vertical',
      padding: 6,
      fontSize: 13,
      border: '1px solid #ccc',
      borderRadius: 4
    }}
  />

  <div style={{ display: 'flex', gap: 8 }}>
    <Button
      
      onClick={() => saveNotesMutation.mutate(notes)}
      disabled={saveNotesMutation.isPending}
    >
      {saveNotesMutation.isPending ? 'Guardando...' : 'Guardar'}
    </Button>
  </div>
</div>
            </div>

            <div className="card-panel stack-gap">
              <div className="detail-row">
                <span>Subtotal</span>
                <strong>{currency(data.subtotal)}</strong>
              </div>
              <div className="detail-row">
                <span>Descuento global</span>
                <strong>{currency(data.discountTotal)}</strong>
              </div>
              {data.discountReason ? (
                <div className="detail-row">
                  <span>Razón del descuento</span>
                  <strong>{data.discountReason}</strong>
                </div>
              ) : null}
              {itemsDiscountTotal > 0 ? (
                <div className="detail-row">
                  <span>Descuentos por ítems</span>
                  <strong>{currency(itemsDiscountTotal)}</strong>
                </div>
              ) : null}
              {discountReasons.length > 0 ? (
                <div className="detail-row">
                  <span>Motivos descuento ítems</span>
                  <strong>{discountReasons.join(' · ')}</strong>
                </div>
              ) : null}
              {itemsSurchargeTotal > 0 ? (
                <div className="detail-row">
                  <span>Recargos por ítems</span>
                  <strong>{currency(itemsSurchargeTotal)}</strong>
                </div>
              ) : null}
              {surchargeReasons.length > 0 ? (
                <div className="detail-row">
                  <span>Motivos recargo ítems</span>
                  <strong>{surchargeReasons.join(' · ')}</strong>
                </div>
              ) : null}
              <div className="detail-row">
                <span>Total</span>
                <strong>{currency(data.total)}</strong>
              </div>
              <div className="detail-row">
                <span>Pagado</span>
                <strong>{currency(data.paidTotal)}</strong>
              </div>
              <div className="detail-row">
                <span>Saldo</span>
                <strong>{currency(data.balanceDue)}</strong>
              </div>
            </div>
          </div>
        );
    }
  }, [activeTab, data, catalogs, updateStatusMutation, clients, pendingStatusId]);

  useEffect(() => {
  if (data?.notes !== undefined) {
    setNotes(data.notes ?? '');
  }
}, [data?.notes]);

  if (!data) return <section className="card-panel">Cargando detalle...</section>;
  const currentStatusCode = String(data.statusCode ?? '').toUpperCase();
  const isCanceledOrder = CANCELLED_CODES.has(currentStatusCode);
  const isDeliveredOrder = currentStatusCode === 'DELIVERED';

  return (
    <section className="stack-gap">
      <PageHeader
        title={`Orden ${data.orderNumber}`}
        subtitle={`Creada ${dateTime(data.createdAt)}`}
        actions={
  <div className="row-actions">
    <Link className="button button-secondary" to="/ordenes">
      ← Volver
    </Link>

    {!isCashOpen && (
      <span style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600, alignSelf: 'center' }}>
        Abre caja primero
      </span>
    )}
    <Button
      style={{ background: isCashOpen ? '#16a34a' : '#9ca3af', color: '#fff', border: 'none' }}
      disabled={!isCashOpen}
      onClick={() => setPaymentModal(true)}
      title={isCashOpen ? 'Registrar pago' : 'Caja cerrada — ábrela primero'}
    >
      Registrar pago
    </Button>

    <Link
      className="button"
      style={{ background: '#7c3aed', color: '#fff', border: 'none' }}
      to={`/facturas/${data.id}`}
    >
      Factura
    </Link>

    <Button
      style={{ background: '#2563eb', color: '#fff', border: 'none' }}
      onClick={() => navigate(`/entregas?orderId=${data.id}&open=1`)}
    >
      Entregar
    </Button>

    <Button
      style={{ background: '#d97706', color: '#fff', border: 'none' }}
      onClick={() => requestProtectedAction('edit')}
      disabled={isCanceledOrder || isDeliveredOrder}
      title={
        isCanceledOrder || isDeliveredOrder
          ? 'No se puede editar una orden cancelada o entregada'
          : undefined
      }
    >
      Editar orden
    </Button>

    <Button
      variant="danger"
      onClick={() => requestProtectedAction('cancel')}
      disabled={isCanceledOrder || isDeliveredOrder}
      title={
        isCanceledOrder || isDeliveredOrder
          ? 'No se puede cancelar una orden cancelada o entregada'
          : undefined
      }
    >
      Cancelar orden
    </Button>
  </div>
}
      />

      <div className="tabs-row">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tab-chip ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {!isHardwareSupported ? (
        <div className="alert-warning">{hardwareMessage}</div>
      ) : null}

      <div className="card-panel">{tabContent}</div>

      <Modal
        open={paymentModal}
        title="Registrar pago"
        onClose={() => setPaymentModal(false)}
      >
        {paymentMutation.isError && (
          <p className="error-text" style={{ marginBottom: 12 }}>
            {(paymentMutation.error as Error).message}
          </p>
        )}
        <PaymentForm
          orderId={data.id}
          catalogs={catalogs}
          balanceDue={data.balanceDue}
          onSubmit={(value) => paymentMutation.mutate(value)}
        />
      </Modal>

      <Modal
        open={editModal}
        title="Editar orden"
        onClose={() => setEditModal(false)}
      >
        {restoredEditDraft ? (
          <p className="alert-warning" style={{ marginTop: 0 }}>
            Se restauró un borrador temporal de esta edición.
          </p>
        ) : null}
        <OrderForm
          clients={clients}
          catalogs={catalogs}
          onSearchClients={api.searchClientsByName}
          initialValue={data}
          initialDraft={restoredEditDraft}
          onDraftRestored={() => {
            window.localStorage.removeItem(buildOrderDraftStorageKey(orderId));
          }}
          onDraftChange={(value) => {
            window.localStorage.setItem(
              buildOrderDraftStorageKey(orderId),
              JSON.stringify(value)
            );
          }}
          hideInitialPaymentFields
          submitLabel="Guardar cambios"
          onSubmit={(value) => updateOrderMutation.mutate(value)}
        />
        {updateOrderMutation.isError && (
          <p className="error-text">{(updateOrderMutation.error as Error).message}</p>
        )}
      </Modal>

      <Modal
        open={passwordModal}
        title="Confirmación requerida"
        onClose={() => {
          setPasswordModal(false);
          setPassword('');
          setPasswordError(null);
          setPendingAction(null);
          setPendingStatusId(null);
        }}
      >
        <div className="stack-gap">
          <p>
            Ingresa la contraseña para{' '}
            {pendingAction === 'edit' ? 'editar' : pendingAction === 'cancel' ? 'cancelar' : 'cambiar el estado de'} la orden.
          </p>

          <label>
            <span>Contraseña</span>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {passwordError && <p className="error-text">{passwordError}</p>}

          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setPasswordModal(false);
                setPassword('');
                setPasswordError(null);
                setPendingAction(null);
                setPendingStatusId(null);
              }}
            >
              Cancelar
            </Button>

            <Button
              onClick={handleConfirmPassword}
              disabled={verifyPasswordMutation.isPending}
            >
              {verifyPasswordMutation.isPending ? 'Verificando...' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </Modal>

      {cancelOrderMutation.isError && (
        <p className="error-text">{(cancelOrderMutation.error as Error).message}</p>
      )}
    </section>
  );
};

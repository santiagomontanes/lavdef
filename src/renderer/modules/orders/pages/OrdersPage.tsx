import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { DataTable, Input, Modal, PageHeader, StatusChip } from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';
import { normalizeScan } from '@renderer/utils/normalize';

const normalizePhone = (raw?: string | null) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  if (digits.length > 10 && !digits.startsWith('57')) return `57${digits.slice(-10)}`;
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

// CREATED first (newest), then active states, then terminal
const STATUS_SORT_PRIORITY: Record<string, number> = {
  CREATED: 1,
  IN_PROGRESS: 2,
  RECEIVED: 3,
  READY: 4,
  READY_FOR_DELIVERY: 5,
  WARRANTY: 6,
  DELIVERED: 90,
  CANCELLED: 95,
  CANCELED: 95,
  CANCELADO: 95
};

const getPriorityByName = (name: string): number => {
  const n = name.toUpperCase();
  if (n.includes('CREA')) return 1;
  if (n.includes('PROCESO') || n.includes('PROGRESS')) return 2;
  if (n.includes('RECIB')) return 3;
  if (n === 'LISTA' || n === 'READY') return 4;
  if (n.includes('ENTREGAR') || n.includes('DELIVERY')) return 5;
  if (n.includes('GARANT')) return 6;
  if (n === 'ENTREGADA' || n === 'DELIVERED') return 90;
  if (n.includes('CANCEL')) return 95;
  return 50;
};

const TERMINAL = new Set(['CANCELLED', 'CANCELED', 'CANCELADO']);

const validNextStatuses = (
  currentCode: string,
  currentId: number,
  statuses: { id: number; code: string; name: string; color: string }[]
) => {
  const code = (currentCode ?? '').toUpperCase();
  if (TERMINAL.has(code)) return [];
  return statuses.filter((s) => {
    const sc = s.code.toUpperCase();
    if (sc === code || s.id === currentId) return false;
    return true;
  });
};

export const OrdersPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<number | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [pendingScan, setPendingScan] = useState<string | null>(null);

  const [passwordModal, setPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ orderId: number; statusId: number } | null>(null);

  const normalizeScannedCode = (value: string) => {
    const text = normalizeScan(value);
    if (text.startsWith('TK-')) return text.slice(3);
    return text;
  };

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: api.listOrders
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: api.listClients
  });

  const { data: catalogs } = useQuery({
    queryKey: ['order-catalogs'],
    queryFn: api.orderCatalogs
  });

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: api.companySettings
  });

  const doUpdateStatus = async ({ orderId, statusId }: { orderId: number; statusId: number }) => {
    await api.updateOrderStatus(orderId, statusId);
    return { orderId, statusId };
  };

  const updateStatusMutation = useMutation({
    mutationFn: doUpdateStatus,
    onSuccess: async ({ orderId, statusId }) => {
      const selectedStatus = catalogs?.statuses?.find((status) => status.id === statusId);
      const selectedOrder = orders.find((order) => order.id === orderId);

      if (selectedStatus) {
        queryClient.setQueryData(['orders'], (old: any) => {
          if (!Array.isArray(old)) return old;
          return old.map((order: any) =>
            order.id === orderId
              ? {
                  ...order,
                  statusId: selectedStatus.id,
                  statusCode: selectedStatus.code,
                  statusName: selectedStatus.name,
                  statusColor: selectedStatus.color
                }
              : order
          );
        });
      }

      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });

      if (!selectedStatus || !selectedOrder) return;

      const statusCode = String(selectedStatus.code ?? '').trim().toUpperCase();
      const shouldSendReady = statusCode === 'READY' || statusCode === 'READY_FOR_DELIVERY' || statusCode === 'LISTO';
      if (!shouldSendReady) return;

      const client = clients.find((item) => item.id === selectedOrder.clientId);
      const phone = normalizePhone(client?.phone);
      if (!phone) return;

      const orderDetail = await api.orderDetail(orderId).catch(() => null);
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(
        buildReadyMessage({
          clientName: selectedOrder.clientName,
          orderNumber: selectedOrder.orderNumber,
          total: selectedOrder.total,
          paidTotal: selectedOrder.paidTotal,
          balanceDue: selectedOrder.balanceDue,
          dueDate: orderDetail?.dueDate ?? null,
          items: orderDetail?.items.map((i) => ({ description: i.description, quantity: i.quantity })),
          companyName: companySettings?.companyName ?? 'Lavandería'
        })
      )}`;

      await api.openExternal(url);
    },
    onSettled: () => {
      api.triggerReconcile().catch(() => {});
    }
  });

  const verifyPasswordMutation = useMutation({
    mutationFn: api.verifyPassword,
    onSuccess: async () => {
      setPasswordModal(false);
      setPassword('');
      setPasswordError(null);
      if (pendingStatusChange) {
        await updateStatusMutation.mutateAsync(pendingStatusChange);
        setPendingStatusChange(null);
      }
    },
    onError: (error: Error) => {
      setPasswordError(error.message);
    }
  });

  const requestStatusChange = (orderId: number, statusId: number) => {
    setPendingStatusChange({ orderId, statusId });
    setPassword('');
    setPasswordError(null);
    setPasswordModal(true);
  };

  const normalizedSearch = normalizeScannedCode(search);

  const filteredOrders = useMemo(() => {
    const filtered = orders.filter((order) => {
      const matchesStatus = statusFilter === 'ALL' ? true : order.statusId === statusFilter;
      if (!matchesStatus) return false;
      if (!normalizedSearch) return true;

      const orderNumber = normalizeScan(String(order.orderNumber ?? ''));
      const clientName = normalizeScan(String(order.clientName ?? ''));
      const statusName = normalizeScan(String(order.statusName ?? ''));

      return (
        orderNumber.includes(normalizedSearch) ||
        clientName.includes(normalizedSearch) ||
        statusName.includes(normalizedSearch)
      );
    });

    return filtered.sort((a, b) => {
      const codeA = String(a.statusCode ?? '').toUpperCase();
      const codeB = String(b.statusCode ?? '').toUpperCase();
      const pa = codeA ? (STATUS_SORT_PRIORITY[codeA] ?? getPriorityByName(a.statusName)) : getPriorityByName(a.statusName);
      const pb = codeB ? (STATUS_SORT_PRIORITY[codeB] ?? getPriorityByName(b.statusName)) : getPriorityByName(b.statusName);
      if (pa !== pb) return pa - pb;
      return b.id - a.id;
    });
  }, [orders, statusFilter, normalizedSearch]);

  const tryNavigateScan = (normalized: string, orderList: typeof orders) => {
    if (!normalized) return false;
    const exactOrder = orderList.find(
      (order) => normalizeScan(String(order.orderNumber ?? '')) === normalized
    );
    if (exactOrder) {
      navigate(`/ordenes/${exactOrder.id}`);
      return true;
    }
    return false;
  };

  // When orders finish loading, retry any scan that arrived before data was ready
  useEffect(() => {
    if (!pendingScan || orders.length === 0) return;
    if (tryNavigateScan(pendingScan, orders)) setPendingScan(null);
  }, [orders, pendingScan]);

  const handleSearchChange = (value: string) => {
    const cleanedInput = normalizeScan(value);
    setSearch(cleanedInput);

    const normalized = normalizeScannedCode(cleanedInput);
    if (!normalized) return;

    if (!tryNavigateScan(normalized, orders)) {
      // Orders not loaded yet — hold the scan and retry when data arrives
      if (orders.length === 0) setPendingScan(normalized);
    }
  };

  return (
    <section className="stack-gap">
      <PageHeader
        title="Órdenes"
        subtitle="Listado comercial con acciones rápidas sobre cada orden."
        actions={
          <Link className="button button-primary" to="/ordenes/nueva">
            Nueva orden
          </Link>
        }
      />

      <div className="card-panel">
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px', minWidth: 260 }}>
            <Input
              placeholder="Buscar por orden, cliente o escanear código"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              autoFocus
            />
          </div>

          <select
            className="field"
            style={{ maxWidth: 260 }}
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
            }
          >
            <option value="ALL">Todos los estados</option>
            {catalogs?.statuses?.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        </div>

        <DataTable
          rows={filteredOrders}
          columns={[
            {
              key: 'number',
              header: 'Consecutivo',
              render: (row) => row.orderNumber
            },
            {
              key: 'client',
              header: 'Cliente',
              render: (row) => row.clientName
            },
            {
              key: 'status-chip',
              header: 'Estado actual',
              render: (row) => <StatusChip label={row.statusName} color={row.statusColor} />
            },
            {
              key: 'status-change',
              header: 'Cambiar estado',
              render: (row) => (
                <select
                  className="field order-status-select"
                  value={row.statusId}
                  disabled={updateStatusMutation.isPending || TERMINAL.has((row.statusCode ?? '').toUpperCase())}
                  onChange={(e) => {
                    const nextStatusId = Number(e.target.value);
                    if (!nextStatusId || nextStatusId === row.statusId) return;
                    requestStatusChange(row.id, nextStatusId);
                  }}
                >
                  <option value={row.statusId}>{row.statusName}</option>
                  {validNextStatuses(row.statusCode ?? '', row.statusId, catalogs?.statuses ?? []).map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              )
            },
            {
              key: 'total',
              header: 'Total',
              render: (row) => currency(row.total)
            },
            {
              key: 'balance',
              header: 'Saldo',
              render: (row) => currency(row.balanceDue)
            },
            {
              key: 'date',
              header: 'Creada',
              render: (row) => dateTime(row.createdAt)
            },
            {
              key: 'actions',
              header: 'Acciones',
              render: (row) => (
                <div className="row-actions">
                  <Link to={`/ordenes/${row.id}`}>Ver</Link>
                  <Link to={`/ordenes/${row.id}?action=pay`}>Cobrar</Link>
                  <Link to={`/facturas/${row.id}`}>Facturar</Link>
                  <Link to={`/entregas?orderId=${row.id}&open=1`}>Entregar</Link>
                </div>
              )
            }
          ]}
        />
      </div>

      <Modal
        open={passwordModal}
        title="Verificar contraseña"
        onClose={() => {
          setPasswordModal(false);
          setPassword('');
          setPasswordError(null);
          setPendingStatusChange(null);
        }}
      >
        <div className="stack-gap">
          <p style={{ marginTop: 0 }}>
            Ingresa la contraseña de administrador para cambiar el estado de la orden.
          </p>
          <input
            type="password"
            className="field"
            placeholder="Contraseña"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password.trim()) verifyPasswordMutation.mutate(password);
            }}
          />
          {passwordError && <p className="error-text">{passwordError}</p>}
          <div className="form-actions">
            <button
              className="button button-secondary"
              onClick={() => {
                setPasswordModal(false);
                setPassword('');
                setPasswordError(null);
                setPendingStatusChange(null);
              }}
            >
              Cancelar
            </button>
            <button
              className="button button-primary"
              disabled={verifyPasswordMutation.isPending || !password.trim()}
              onClick={() => verifyPasswordMutation.mutate(password)}
            >
              {verifyPasswordMutation.isPending ? 'Verificando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
};

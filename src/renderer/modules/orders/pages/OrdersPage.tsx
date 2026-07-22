import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { DataTable, Input, Modal, PageHeader, StatusChip } from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';
import { normalizeScan } from '@renderer/utils/normalize';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

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
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [passwordModal, setPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ orderId: number; statusId: number } | null>(null);

  const normalizeScannedCode = (value: string) => {
    const text = normalizeScan(value);
    if (text.startsWith('TK-')) return text.slice(3);
    return text;
  };

  // Debounce del buscador: espera a que el usuario deje de escribir (o
  // termine de escanear un código) antes de golpear el backend.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(normalizeScannedCode(search));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Cualquier cambio de filtro o búsqueda vuelve a la primera página.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearch]);

  const {
    data: ordersPage,
    isFetching: isFetchingOrders
  } = useQuery({
    queryKey: ['orders-page', page, PAGE_SIZE, statusFilter, debouncedSearch],
    queryFn: () =>
      api.listOrdersPage({
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter,
        search: debouncedSearch || null
      }),
    placeholderData: keepPreviousData
  });

  const orders = ordersPage?.rows ?? [];
  const total = ordersPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['orders-page'] });
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

  // El filtro de estado y la búsqueda ya se resuelven en SQL (ver
  // api.listOrdersPage). `orders` es directamente la página actual.

  // Escaneo de código de barras: primero intenta un match exacto contra
  // la página cargada (cubre el caso común: la orden escaneada suele
  // estar entre las más recientes/activas, que es justo lo que muestra
  // la primera página). Si no aparece ahí, cae a una búsqueda liviana
  // en el backend (orders:search, ya limitada) para no depender de
  // tener las 800+ órdenes en memoria del renderer.
  const tryNavigateLocal = (normalized: string) => {
    if (!normalized) return false;
    const exactOrder = orders.find(
      (order) => normalizeScan(String(order.orderNumber ?? '')) === normalized
    );
    if (exactOrder) {
      navigate(`/ordenes/${exactOrder.id}`);
      return true;
    }
    return false;
  };

  useEffect(() => {
    const normalized = normalizeScannedCode(debouncedSearch);
    if (!normalized) return;
    if (tryNavigateLocal(normalized)) return;

    let cancelled = false;
    api
      .searchOrders(normalized, 5)
      .then((results) => {
        if (cancelled) return;
        const exact = results.find(
          (order) => normalizeScan(String(order.orderNumber ?? '')) === normalized
        );
        if (exact) navigate(`/ordenes/${exact.id}`);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleSearchChange = (value: string) => {
    setSearch(normalizeScan(value));
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
          rows={orders}
          columns={[
            {
              key: 'number',
              header: 'Consecutivo',
              render: (row) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>{row.orderNumber}</span>
                  {row.isManual && row.manualOrderNumber ? (
                    <small style={{ color: '#92400e', fontWeight: 600 }}>
                      📝 Manual: {row.manualOrderNumber}
                    </small>
                  ) : null}
                </div>
              )
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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 14,
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          <small style={{ color: '#6b7280' }}>
            {total > 0
              ? `Página ${page} de ${totalPages} · ${total} orden${total === 1 ? '' : 'es'} en total`
              : 'Sin órdenes para este filtro.'}
            {isFetchingOrders ? ' · Actualizando...' : ''}
          </small>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="button button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>
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

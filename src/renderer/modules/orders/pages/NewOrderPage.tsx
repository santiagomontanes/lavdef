import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { Button, Modal, PageHeader } from '@renderer/ui/components';
import type { OrderDetail, OrderInput } from '@shared/types';
import { OrderForm } from '../components/OrderForm';

const ORDER_DRAFT_STORAGE_KEY = 'lavasuite:new-order-draft';

const normalizePhone = (raw?: string | null) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  if (digits.length > 10 && !digits.startsWith('57')) return `57${digits.slice(-10)}`;
  return digits;
};

const money = (value: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(value ?? 0));

const buildCreatedOrderMessage = ({
  companyName,
  clientName,
  orderNumber,
  createdAt,
  total,
  paidTotal,
  balanceDue,
  dueDate,
  items
}: {
  companyName: string;
  clientName: string;
  orderNumber: string;
  createdAt: string;
  total: number;
  paidTotal: number;
  balanceDue: number;
  dueDate?: string | null;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    customerObservations?: string | null;
  }>;
}) => {
  const createdDate = new Date(createdAt).toLocaleString('es-CO');
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('es-CO') : 'Sin definir';

  const allObs = items
    .map((i) => String(i.customerObservations ?? '').trim())
    .filter(Boolean)
    .join(', ');

  const itemsText = items.length
    ? items
        .map(
          (i) =>
            `- ${i.description} - Cant: ${i.quantity} - ${money(i.unitPrice)} = ${money(i.total)}`
        )
        .join('\n')
    : '- Sin ítems registrados';

  return (
    `👔 *${companyName}*\n\n` +
    `Hola ${clientName}, tu orden ha sido registrada exitosamente.\n\n` +
    `📋 *Orden:* ${orderNumber}\n` +
    `📅 *Fecha de creación:* ${createdDate}\n` +
    `📆 *Fecha prometida de entrega:* ${dueDateStr}\n\n` +
    `🧺 *Detalle de prendas y servicios:*\n${itemsText}\n\n` +
    `📝 *Observaciones:* ${allObs || 'Ninguna'}\n\n` +
    `💰 *Total:* ${money(total)}\n` +
    `💳 *Abono:* ${money(paidTotal)}\n` +
    `🔖 *Saldo pendiente:* ${money(balanceDue)}\n\n` +
    `Ante cualquier duda comuníquese con nosotros.\n` +
    `¡Gracias por preferirnos!`
  );
};

export const NewOrderPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [restoredDraft, setRestoredDraft] = useState<OrderInput | null>(null);
  const [whatsappModal, setWhatsappModal] = useState(false);
  const [pendingWaUrl, setPendingWaUrl] = useState<string | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ORDER_DRAFT_STORAGE_KEY);
      if (!raw) { setRestoredDraft(null); return; }
      const parsed = JSON.parse(raw) as OrderInput;
      setRestoredDraft(parsed?.items?.length ? parsed : null);
    } catch {
      setRestoredDraft(null);
    }
  }, []);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: api.listClients
  });

  const { data: catalogs } = useQuery({
    queryKey: ['order-catalogs'],
    queryFn: api.orderCatalogs
  });

  const { data: company } = useQuery({
    queryKey: ['company-settings'],
    queryFn: api.companySettings
  });

  const doNavigate = (orderId: number) => navigate(`/facturas/${orderId}`);

  const handleAfterModal = async (sendWa: boolean) => {
    setWhatsappModal(false);
    if (sendWa && pendingWaUrl) {
      await api.openExternal(pendingWaUrl);
    }
    if (pendingOrderId) doNavigate(pendingOrderId);
    setPendingWaUrl(null);
    setPendingOrderId(null);
  };

  const buildWaUrl = (order: OrderDetail) => {
    const client = clients.find((c) => c.id === order.clientId);
    const phone = normalizePhone(client?.phone);
    if (!phone) return null;
    const companyName = String(company?.companyName ?? 'Lavandería');
    const message = buildCreatedOrderMessage({
      companyName,
      clientName: order.clientName,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      total: order.total,
      paidTotal: order.paidTotal,
      balanceDue: order.balanceDue,
      dueDate: order.dueDate,
      items: order.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
        customerObservations: i.customerObservations
      }))
    });
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  const mutation = useMutation({
    mutationFn: api.createOrder,
    onSuccess: async (order) => {
      window.localStorage.removeItem(ORDER_DRAFT_STORAGE_KEY);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['payments'] });
      await queryClient.invalidateQueries({ queryKey: ['cash-summary'] });

      const waUrl = buildWaUrl(order);
      if (waUrl) {
        setPendingWaUrl(waUrl);
        setPendingOrderId(order.id);
        setWhatsappModal(true);
      } else {
        doNavigate(order.id);
      }
    }
  });

  return (
    <section className="stack-gap">
      <PageHeader title="Nueva orden" />
      <div className="card-panel">
        {restoredDraft ? (
          <p className="alert-warning" style={{ marginTop: 0 }}>
            Se restauró un borrador temporal de la orden anterior.
          </p>
        ) : null}
        <OrderForm
          clients={clients}
          catalogs={catalogs}
          onSearchClients={api.searchClientsByName}
          initialDraft={restoredDraft}
          onDraftRestored={() => {
            window.localStorage.removeItem(ORDER_DRAFT_STORAGE_KEY);
            setRestoredDraft(null);
          }}
          onDraftChange={(value) => {
            window.localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(value));
          }}
          onSubmit={(value) => mutation.mutate(value)}
        />
        {mutation.isError && (
          <p className="error-text">{(mutation.error as Error).message}</p>
        )}
      </div>

      <Modal
        open={whatsappModal}
        title="Notificar al cliente"
        onClose={() => handleAfterModal(false)}
      >
        <div className="stack-gap">
          <p>¿Deseas enviar una notificación de creación al cliente por WhatsApp?</p>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => handleAfterModal(false)}>
              No, omitir
            </Button>
            <Button onClick={() => handleAfterModal(true)}>
              Sí, enviar por WhatsApp
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
};

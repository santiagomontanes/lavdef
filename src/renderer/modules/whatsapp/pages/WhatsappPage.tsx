import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import { Button, Input, PageHeader } from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';

type TemplateKey =
  | 'ORDER_RECEIVED'
  | 'BALANCE_REMINDER'
  | 'READY_FOR_DELIVERY'
  | 'DELIVERY_REMINDER'
  | 'CUSTOM';

const templateOptions: Array<{ value: TemplateKey; label: string }> = [
  { value: 'ORDER_RECEIVED', label: 'Orden recibida' },
  { value: 'BALANCE_REMINDER', label: 'Recordatorio de saldo' },
  { value: 'READY_FOR_DELIVERY', label: 'Orden lista para entregar' },
  { value: 'DELIVERY_REMINDER', label: 'Recordatorio de entrega' },
  { value: 'CUSTOM', label: 'Mensaje libre' }
];

const normalizePhone = (raw?: string | null) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  if (digits.length > 10 && !digits.startsWith('57')) return `57${digits.slice(-10)}`;
  return digits;
};

export const WhatsappPage = () => {
  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<number>(0);
  const [template, setTemplate] = useState<TemplateKey>('ORDER_RECEIVED');
  const [customMessage, setCustomMessage] = useState('');
  const [manualMessage, setManualMessage] = useState('');
  const [formError, setFormError] = useState('');

  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: api.listOrders });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: api.listClients });
  const { data: company } = useQuery({ queryKey: ['company-settings'], queryFn: api.companySettings });

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((order) =>
      order.orderNumber.toLowerCase().includes(term) ||
      order.clientName.toLowerCase().includes(term) ||
      order.statusName.toLowerCase().includes(term)
    );
  }, [orders, search]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const selectedClient = useMemo(() => {
    if (!selectedOrder) return null;
    return clients.find((client) => client.id === selectedOrder.clientId) ?? null;
  }, [clients, selectedOrder]);

  const companyName = company?.companyName || 'LavaSuite';
  const clientPhone = normalizePhone(selectedClient?.phone);

  const generatedMessage = useMemo(() => {
    if (!selectedOrder || !selectedClient) return '';

    const clientName = selectedOrder.clientName;
    const orderNumber = selectedOrder.orderNumber;
    const total = currency(selectedOrder.total);
    const paid = currency(selectedOrder.paidTotal);
    const balance = currency(selectedOrder.balanceDue);
    const dueDate = selectedOrder.dueDate ? dateTime(selectedOrder.dueDate) : 'Sin fecha definida';
    const policies = company?.invoicePolicies?.trim()
      ? `\n\n📌 Políticas:\n${company.invoicePolicies.trim()}`
      : '';

    switch (template) {
      case 'ORDER_RECEIVED':
        return `Hola ${clientName} 👋\n\nTe confirmamos que recibimos tu orden *${orderNumber}* en ${companyName}.\n\n📌 Estado: ${selectedOrder.statusName}\n💰 Total: ${total}\n💵 Abonado: ${paid}\n🧾 Saldo: ${balance}\n📅 Fecha promesa: ${dueDate}\n\nGracias por confiar en nosotros.${policies}`;
      case 'BALANCE_REMINDER':
        return `Hola ${clientName} 👋\n\nTe escribimos de ${companyName} por tu orden *${orderNumber}*.\n\n💰 Total: ${total}\n💵 Abonado: ${paid}\n🧾 Saldo pendiente: ${balance}\n\nQuedamos atentos a tu pago. Muchas gracias.${policies}`;
      case 'READY_FOR_DELIVERY':
        return `Hola ${clientName} 👋\n\nTu orden *${orderNumber}* ya está *lista para entregar* en ${companyName}.\n\n💰 Total: ${total}\n💵 Abonado: ${paid}\n🧾 Saldo: ${balance}\n\nPuedes pasar por ella cuando desees.${policies}`;
      case 'DELIVERY_REMINDER':
        return `Hola ${clientName} 👋\n\nTe recordamos que tu orden *${orderNumber}* sigue disponible para entrega en ${companyName}.\n\n📌 Estado actual: ${selectedOrder.statusName}\n💰 Total: ${total}\n💵 Abonado: ${paid}\n🧾 Saldo: ${balance}\n\nTe esperamos.${policies}`;
      case 'CUSTOM':
        return customMessage.trim();
      default:
        return '';
    }
  }, [template, customMessage, selectedOrder, selectedClient, companyName]);

  useEffect(() => {
    setManualMessage(generatedMessage);
  }, [generatedMessage]);

  const handleSend = async () => {
    if (!selectedOrder || !selectedClient) {
      setFormError('Debes seleccionar una orden.');
      return;
    }
    if (!clientPhone) {
      setFormError('El cliente no tiene teléfono válido registrado.');
      return;
    }
    if (!manualMessage.trim()) {
      setFormError('El mensaje está vacío.');
      return;
    }
    setFormError('');
    const url = `https://wa.me/${clientPhone}?text=${encodeURIComponent(manualMessage.trim())}`;
    await api.openExternal(url);
  };

  return (
    <section className="stack-gap">
      <PageHeader
        title="WhatsApp"
        subtitle="Mensajes rápidos, plantillas y vista previa antes de enviar."
      />

      <div className="card-panel stack-gap">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px' }}>
            <label>
              <span>Buscar orden</span>
              <Input
                placeholder="Orden, cliente o estado"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>

          <div style={{ flex: '1 1 280px' }}>
            <label>
              <span>Orden</span>
              <select
                className="field"
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(Number(e.target.value))}
              >
                <option value={0}>Selecciona una orden</option>
                {filteredOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.orderNumber} · {order.clientName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {!selectedOrder && (
          <p style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
            padding: '8px 12px',
            background: 'var(--color-background-secondary)',
            borderRadius: 'var(--border-radius-md)',
            border: '0.5px solid var(--color-border-tertiary)',
          }}>
            Selecciona una orden para cargar los datos del cliente y las plantillas de mensajes.
          </p>
        )}

        <div className="detail-grid">
          <div className="card-panel stack-gap">
            <h3>Datos del cliente</h3>
            <div className="detail-row"><span>Cliente</span><strong>{selectedOrder?.clientName || '—'}</strong></div>
            <div className="detail-row"><span>Teléfono</span><strong>{selectedClient?.phone || '—'}</strong></div>
            <div className="detail-row"><span>Orden</span><strong>{selectedOrder?.orderNumber || '—'}</strong></div>
            <div className="detail-row"><span>Estado</span><strong>{selectedOrder?.statusName || '—'}</strong></div>
          </div>

          <div className="card-panel stack-gap">
            <h3>Resumen comercial</h3>
            <div className="detail-row"><span>Total</span><strong>{selectedOrder ? currency(selectedOrder.total) : '—'}</strong></div>
            <div className="detail-row"><span>Abonado</span><strong>{selectedOrder ? currency(selectedOrder.paidTotal) : '—'}</strong></div>
            <div className="detail-row"><span>Saldo</span><strong>{selectedOrder ? currency(selectedOrder.balanceDue) : '—'}</strong></div>
            <div className="detail-row"><span>Fecha promesa</span><strong>{selectedOrder?.dueDate ? dateTime(selectedOrder.dueDate) : '—'}</strong></div>
          </div>
        </div>

        <div style={{
          opacity: selectedOrder ? 1 : 0.4,
          pointerEvents: selectedOrder ? 'auto' : 'none',
          transition: 'opacity 0.2s',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 280px' }}>
              <label>
                <span>Plantilla</span>
                <select
                  className="field"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value as TemplateKey)}
                >
                  {templateOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {template === 'CUSTOM' && (
            <label>
              <span>Mensaje libre base</span>
              <textarea
                className="field"
                rows={5}
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Escribe un mensaje personalizado"
                style={{ resize: 'vertical', paddingTop: 12 }}
              />
            </label>
          )}

          <label>
            <span>Vista previa editable</span>
            <textarea
              className="field"
              rows={10}
              value={manualMessage}
              onChange={(e) => setManualMessage(e.target.value)}
              placeholder="Aquí verás el mensaje antes de enviarlo"
              style={{ resize: 'vertical', paddingTop: 12 }}
            />
          </label>

          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setTemplate('ORDER_RECEIVED');
                setCustomMessage('');
                setManualMessage('');
                setSelectedOrderId(0);
                setSearch('');
                setFormError('');
              }}
            >
              Limpiar
            </Button>
            <Button onClick={handleSend}>Enviar por WhatsApp</Button>
          </div>

          {formError && <p className="error-text">{formError}</p>}
        </div>
      </div>
    </section>
  );
};
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import { Button, PageHeader } from '@renderer/ui/components';
import type { AuditEntry } from '@shared/types';

// ─── Etiquetas legibles para cada acción ────────────────────────────────────
const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  // Autenticación
  LOGIN_SUCCESS:                    { label: 'Inicio de sesión',                   icon: '🔑', color: '#2563eb' },
  LOGIN_FAILED:                     { label: 'Intento de sesión fallido',          icon: '⚠️', color: '#dc2626' },
  ORDER_PROTECTION_PASSWORD_SUCCESS:{ label: 'Contraseña admin verificada',        icon: '🔓', color: '#6b7280' },
  ORDER_PROTECTION_PASSWORD_FAILED: { label: 'Contraseña admin incorrecta',        icon: '🔒', color: '#dc2626' },

  // Clientes
  CLIENT_CREATE:            { label: 'Cliente registrado',         icon: '👤', color: '#16a34a' },
  CLIENT_UPDATE:            { label: 'Cliente editado',            icon: '✏️', color: '#d97706' },
  CLIENT_DELETE:            { label: 'Cliente eliminado',          icon: '🗑️', color: '#dc2626' },

  // Órdenes
  ORDER_CREATE:             { label: 'Orden creada',               icon: '📋', color: '#16a34a' },
  ORDER_UPDATE:             { label: 'Orden editada',              icon: '✏️', color: '#d97706' },
  ORDER_CANCEL:             { label: 'Orden cancelada',            icon: '❌', color: '#dc2626' },
  ORDER_STATUS_UPDATE:      { label: 'Estado de orden cambiado',   icon: '🔄', color: '#7c3aed' },
  ORDER_AUTO_STATUS_UPDATE: { label: 'Estado cambiado automáticamente al pagar', icon: '⚡', color: '#7c3aed' },

  // Pagos
  PAYMENT_CREATE:           { label: 'Pago registrado',            icon: '💰', color: '#16a34a' },
  PAYMENT_BATCH_CREATE:     { label: 'Pago con varios métodos',    icon: '💳', color: '#16a34a' },
  PAYMENT_CASH_SESSION_CHECK: { label: 'Verificación de caja al pagar', icon: '🏦', color: '#9ca3af' },
  CASH_MOVEMENT_CREATE:     { label: 'Movimiento de caja registrado', icon: '💵', color: '#2563eb' },

  // Caja
  CASH_OPEN:                { label: 'Caja abierta',               icon: '🟢', color: '#16a34a' },
  CASH_CLOSE:               { label: 'Caja cerrada',               icon: '🔴', color: '#dc2626' },

  // Facturas
  INVOICE_CREATE:           { label: 'Factura generada',           icon: '🧾', color: '#2563eb' },
  INVOICE_REFRESH:          { label: 'Factura actualizada',        icon: '🔄', color: '#2563eb' },

  // Gastos
  EXPENSE_CREATE:           { label: 'Gasto registrado',           icon: '📉', color: '#dc2626' },

  // Garantías
  WARRANTY_CREATE:          { label: 'Garantía abierta',           icon: '🛡️', color: '#d97706' },
  WARRANTY_STATUS_UPDATE:   { label: 'Garantía actualizada',       icon: '🔄', color: '#d97706' },

  // Entregas
  DELIVERY_CREATE:          { label: 'Entrega registrada',         icon: '📦', color: '#16a34a' },

  // Usuarios del sistema
  USER_CREATE:              { label: 'Usuario del sistema creado', icon: '🆕', color: '#16a34a' },
  USER_UPDATE:              { label: 'Usuario del sistema editado',icon: '✏️', color: '#d97706' },
  USER_DELETE:              { label: 'Usuario del sistema eliminado', icon: '🗑️', color: '#dc2626' },
};

const getActionMeta = (action: string) =>
  ACTION_LABELS[action] ?? {
    label: action
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase()),
    icon: '📝',
    color: '#6b7280'
  };

const localDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatTime = (isoString: string) => {
  try {
    return new Date(isoString).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return isoString;
  }
};

const formatDayLabel = (dateStr: string) => {
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString('es-CO', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch {
    return dateStr;
  }
};

const isToday = (dateStr: string) => {
  const today = localDateKey();
  return dateStr === today;
};

const isYesterday = (dateStr: string) => {
  const yesterday = localDateKey(new Date(Date.now() - 86400000));
  return dateStr === yesterday;
};

const dayLabel = (dateStr: string) => {
  if (isToday(dateStr)) return 'Hoy';
  if (isYesterday(dateStr)) return 'Ayer';
  return formatDayLabel(dateStr);
};

// ─── Detalle legible de un evento ────────────────────────────────────────────
const EntryDetail = ({ entry }: { entry: AuditEntry }) => {
  const d = entry.details ?? {};
  const parts: string[] = [];

  const actor =
    entry.actorName?.trim() ||
    entry.actorUsername?.trim() ||
    d.actorName ||
    d.username ||
    null;
  if (actor) parts.push(`Usuario: ${actor}`);

  if (d.orderNumber) parts.push(`Orden: ${d.orderNumber}`);
  if (!d.orderNumber && d.orderId) parts.push(`Orden ID: ${d.orderId}`);
  if (d.invoiceNumber) parts.push(`Factura: ${d.invoiceNumber}`);
  if (!d.invoiceNumber && entry.entityType === 'invoice' && entry.entityId && entry.entityId !== '0') parts.push(`Factura interna: #${entry.entityId}`);
  if (entry.entityType === 'payment' && entry.entityId && entry.entityId !== '0') parts.push(`Pago: #${entry.entityId}`);
  if (entry.entityType === 'delivery' && entry.entityId && entry.entityId !== '0') parts.push(`Entrega: #${entry.entityId}`);
  if (entry.entityType === 'expense' && entry.entityId && entry.entityId !== '0') parts.push(`Gasto: #${entry.entityId}`);
  if (entry.entityType === 'warranty' && entry.entityId && entry.entityId !== '0') parts.push(`Garantía: #${entry.entityId}`);
  if (d.cashSessionId) parts.push(`Caja: #${d.cashSessionId}`);
  if (d.clientName) parts.push(`Cliente: ${d.clientName}`);
  if (!d.clientName && d.clientId) parts.push(`Cliente: #${d.clientId}`);
  if (d.deliveredTo) parts.push(`Entregado a: ${d.deliveredTo}`);
  if (d.openingAmount !== undefined) parts.push(`Apertura: $${Number(d.openingAmount).toLocaleString('es-CO')}`);
  if (d.declaredAmount !== undefined) parts.push(`Cierre declarado: $${Number(d.declaredAmount).toLocaleString('es-CO')}`);
  if (d.systemAmount !== undefined) parts.push(`Cierre sistema: $${Number(d.systemAmount).toLocaleString('es-CO')}`);
  if (d.differenceAmount !== undefined) parts.push(`Diferencia: $${Number(d.differenceAmount).toLocaleString('es-CO')}`);
  if (d.amount !== undefined) parts.push(`Monto: $${Number(d.amount).toLocaleString('es-CO')}`);
  if (d.total !== undefined && d.amount === undefined) parts.push(`Total: $${Number(d.total).toLocaleString('es-CO')}`);
  if (d.statusName) parts.push(`Estado: ${d.statusName}`);
  if (d.newStatus) parts.push(`Nuevo estado: ${d.newStatus}`);
  if (d.statusCode) parts.push(`Código: ${d.statusCode}`);
  if (d.paymentMethodName) parts.push(`Método: ${d.paymentMethodName}`);
  if (d.reference) parts.push(`Referencia: ${d.reference}`);
  if (d.refundedTotal !== undefined) parts.push(`Devuelto: $${Number(d.refundedTotal).toLocaleString('es-CO')}`);
  if (d.discountTotal !== undefined) parts.push(`Descuento: $${Number(d.discountTotal).toLocaleString('es-CO')}`);
  if (d.balanceDue !== undefined) parts.push(`Saldo: $${Number(d.balanceDue).toLocaleString('es-CO')}`);
  if (d.subtotal !== undefined) parts.push(`Subtotal: $${Number(d.subtotal).toLocaleString('es-CO')}`);
  if (d.lines && Array.isArray(d.lines)) {
    const lineStr = d.lines.map((l: any) => `$${Number(l.amount).toLocaleString('es-CO')}`).join(' + ');
    parts.push(`Líneas: ${lineStr}`);
  }
  if (d.totalAmount !== undefined) parts.push(`Total abonado: $${Number(d.totalAmount).toLocaleString('es-CO')}`);
  if (d.softDelete) parts.push('Registro desactivado');
  if (d.description) parts.push(String(d.description));
  if (d.reason) parts.push(`Motivo: ${d.reason}`);
  if (d.resolution) parts.push(`Resolución: ${d.resolution}`);

  if (parts.length === 0 && entry.entityId && entry.entityId !== '0') {
    parts.push(`ID: ${entry.entityId}`);
  }

  return parts.length > 0 ? (
    <span style={{ color: '#6b7280', fontSize: 12 }}>{parts.join(' · ')}</span>
  ) : null;
};

// ─── Vista de eventos de un día ──────────────────────────────────────────────
const DayView = ({ date, onBack }: { date: string; onBack: () => void }) => {
  const dayKey = String(date).slice(0, 10);
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['audit-day', dayKey],
    queryFn: () => api.auditListByDay(dayKey),
    staleTime: 30_000
  });

  return (
    <section className="stack-gap">
      <PageHeader
        title={dayLabel(dayKey)}
        subtitle={`${entries.length} evento${entries.length !== 1 ? 's' : ''} registrado${entries.length !== 1 ? 's' : ''}`}
        actions={
          <Button variant="secondary" onClick={onBack}>
            ← Todos los días
          </Button>
        }
      />

      {isLoading && <div className="card-panel">Cargando eventos...</div>}

      {!isLoading && entries.length === 0 && (
        <div className="card-panel" style={{ color: '#6b7280' }}>
          No hay eventos registrados para este día.
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <div className="card-panel" style={{ padding: 0, overflow: 'hidden' }}>
          {entries.map((entry, i) => {
            const meta = getActionMeta(entry.action);
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '10px 16px',
                  borderBottom: i < entries.length - 1 ? '1px solid #f3f4f6' : 'none',
                  background: i % 2 === 0 ? '#fff' : '#fafafa'
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
                  {meta.icon}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: meta.color }}>
                      {meta.label}
                    </span>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>
                      {formatTime(entry.createdAt)}
                    </span>
                  </div>
                  <div style={{ marginTop: 2 }}>
                    <EntryDetail entry={entry} />
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    color: '#d1d5db',
                    flexShrink: 0,
                    fontFamily: 'monospace'
                  }}
                >
                  #{entry.id}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

// ─── Vista principal: lista de días ──────────────────────────────────────────
export const AuditPage = () => {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { data: days = [], isLoading } = useQuery({
    queryKey: ['audit-days'],
    queryFn: api.auditListDays,
    staleTime: 60_000
  });

  if (selectedDay) {
    return <DayView date={selectedDay} onBack={() => setSelectedDay(null)} />;
  }

  return (
    <section className="stack-gap">
      <PageHeader
        title="Auditoría"
        subtitle="Historial de acciones críticas del sistema, agrupadas por día."
      />

      {isLoading && <div className="card-panel">Cargando historial...</div>}

      {!isLoading && days.length === 0 && (
        <div className="card-panel" style={{ color: '#6b7280' }}>
          Aún no hay eventos registrados.
        </div>
      )}

      {!isLoading && days.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12
          }}
        >
          {days.map((day) => (
            <button
              key={day.date}
              onClick={() => setSelectedDay(day.date)}
              style={{
                background: isToday(day.date) ? '#eff6ff' : '#fff',
                border: `1.5px solid ${isToday(day.date) ? '#2563eb' : '#e5e7eb'}`,
                borderRadius: 12,
                padding: '16px 18px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'box-shadow 0.15s, border-color 0.15s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)';
                e.currentTarget.style.borderColor = '#2563eb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.borderColor = isToday(day.date) ? '#2563eb' : '#e5e7eb';
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: isToday(day.date) ? '#2563eb' : '#111827' }}>
                {dayLabel(day.date)}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                {day.count} evento{day.count !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                {day.date}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

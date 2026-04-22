import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import type { ReadyQueueItem } from '@shared/types';

const currency = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

export const ReadyQueueWidget = () => {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [rescheduleId, setRescheduleId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['ready-queue-stats'],
    queryFn: api.getReadyQueueStats,
    refetchInterval: 60_000
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['ready-queue-pending'],
    queryFn: api.listReadyQueuePending,
    refetchInterval: 60_000,
    enabled: expanded
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ready-queue-pending'] });
    qc.invalidateQueries({ queryKey: ['ready-queue-stats'] });
  };

  const confirmMutation = useMutation({
    mutationFn: async (queueId: number) => {
      const result = await api.confirmAndMakeReady(queueId);
      if (result.whatsappUrl) api.openExternal(result.whatsappUrl);
    },
    onSuccess: invalidate
  });

  const skipMutation = useMutation({
    mutationFn: (queueId: number) => api.skipReadyQueue(queueId),
    onSuccess: invalidate
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ queueId, newDueDate }: { queueId: number; newDueDate: string }) =>
      api.rescheduleReadyQueue(queueId, newDueDate),
    onSuccess: () => {
      setRescheduleId(null);
      setRescheduleDate('');
      setRescheduleError(null);
      invalidate();
    },
    onError: (err: any) => setRescheduleError(err?.message ?? 'Error al reagendar')
  });

  const pendingCount = stats?.pendingCount ?? 0;

  if (pendingCount === 0 && !expanded) return null;

  return (
    <div
      className="card-panel"
      style={{ borderLeft: '4px solid var(--color-primary, #5a7cff)' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none'
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Cola de órdenes listas</h3>
          {pendingCount > 0 && (
            <span
              style={{
                background: '#ef4444',
                color: '#fff',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                lineHeight: '18px'
              }}
            >
              {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
            </span>
          )}
          {stats && stats.confirmedTodayCount > 0 && (
            <span
              style={{
                background: '#22c55e',
                color: '#fff',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                lineHeight: '18px'
              }}
            >
              {stats.confirmedTodayCount} confirmada{stats.confirmedTodayCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: 'var(--color-muted, #888)' }}>
          {expanded ? '▲ Ocultar' : '▼ Ver detalles'}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: 14 }}>
          {isLoading ? (
            <p style={{ color: 'var(--color-muted, #888)', fontSize: 13 }}>Cargando...</p>
          ) : items.length === 0 ? (
            <p style={{ color: 'var(--color-muted, #888)', fontSize: 13 }}>
              No hay órdenes pendientes en la cola de hoy.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((item) => (
                <ReadyQueueRow
                  key={item.id}
                  item={item}
                  onConfirm={() => confirmMutation.mutate(item.id)}
                  onSkip={() => skipMutation.mutate(item.id)}
                  onReschedule={() => {
                    setRescheduleId(item.id);
                    setRescheduleDate('');
                    setRescheduleError(null);
                  }}
                  isActing={confirmMutation.isPending || skipMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {rescheduleId !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setRescheduleId(null);
              setRescheduleError(null);
            }
          }}
        >
          <div
            className="card-panel"
            style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <h3 style={{ margin: 0 }}>Reagendar fecha promesa</h3>
            <div>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                Nueva fecha prometida
              </label>
              <input
                type="date"
                className="field"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            {rescheduleError && (
              <p className="error-text" style={{ margin: 0 }}>
                {rescheduleError}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button button-secondary"
                onClick={() => {
                  setRescheduleId(null);
                  setRescheduleError(null);
                }}
              >
                Cancelar
              </button>
              <button
                className="button button-primary"
                disabled={!rescheduleDate || rescheduleMutation.isPending}
                onClick={() =>
                  rescheduleMutation.mutate({ queueId: rescheduleId!, newDueDate: rescheduleDate })
                }
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type RowProps = {
  item: ReadyQueueItem;
  onConfirm: () => void;
  onSkip: () => void;
  onReschedule: () => void;
  isActing: boolean;
};

const ReadyQueueRow = ({ item, onConfirm, onSkip, onReschedule, isActing }: RowProps) => {
  const isConfirmed = item.status === 'CONFIRMED_READY';
  const whatsappUrl = item.clientPhone
    ? `https://wa.me/${item.clientPhone}?text=${encodeURIComponent(buildMessage(item))}`
    : null;

  return (
    <div
      style={{
        padding: '12px 14px',
        background: isConfirmed
          ? 'var(--color-success-bg, #f0fdf4)'
          : 'var(--color-warning-bg, #fffbeb)',
        border: `1px solid ${isConfirmed ? 'var(--color-success-border, #86efac)' : 'var(--color-warning-border, #fcd34d)'}`,
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{item.orderNumber}</span>
          {' — '}
          <span style={{ fontSize: 13 }}>{item.clientName}</span>
        </div>
        <span
          style={{
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 4,
            background: isConfirmed ? '#22c55e' : '#f59e0b',
            color: '#fff',
            fontWeight: 600
          }}
        >
          {isConfirmed ? 'Confirmada' : 'Pendiente'}
        </span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-muted, #666)', display: 'flex', gap: 16 }}>
        {item.dueDate && (
          <span>
            Vence:{' '}
            {new Date(item.dueDate + 'T12:00:00').toLocaleDateString('es-CO', {
              weekday: 'short',
              day: 'numeric',
              month: 'short'
            })}
          </span>
        )}
        <span>Saldo: {currency(item.balanceDue)}</span>
        <span>{item.itemCount} prenda{item.itemCount !== 1 ? 's' : ''}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!isConfirmed && (
          <button
            className="button button-primary"
            style={{ fontSize: 12, padding: '4px 10px' }}
            disabled={isActing}
            onClick={onConfirm}
          >
            Sí, está lista ✓ (enviar WA)
          </button>
        )}
        {isConfirmed && whatsappUrl && (
          <button
            className="button button-secondary"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => window.desktopApi.openExternal({ url: whatsappUrl })}
          >
            Reenviar WhatsApp
          </button>
        )}
        <button
          className="button button-secondary"
          style={{ fontSize: 12, padding: '4px 10px' }}
          disabled={isActing}
          onClick={onReschedule}
        >
          Reagendar
        </button>
        {!isConfirmed && (
          <button
            className="button button-secondary"
            style={{ fontSize: 12, padding: '4px 10px', color: 'var(--color-muted, #888)' }}
            disabled={isActing}
            onClick={onSkip}
          >
            Omitir
          </button>
        )}
      </div>
    </div>
  );
};

const buildMessage = (item: ReadyQueueItem): string => {
  const dateStr = item.dueDate
    ? new Date(item.dueDate + 'T12:00:00').toLocaleDateString('es-CO')
    : 'Sin definir';
  const saldo = currency(item.balanceDue);
  return (
    `Hola ${item.clientName}, tus prendas de la orden *${item.orderNumber}* ya están listas para recoger.\n\n` +
    `📆 Fecha prometida: ${dateStr}\n` +
    `💰 Saldo pendiente: ${saldo}\n\n` +
    `¡Te esperamos!`
  );
};

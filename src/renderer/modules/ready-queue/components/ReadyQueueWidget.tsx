import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import type { ReadyQueueItem } from '@shared/types';
import { IconCheck } from '@renderer/ui/components/icons';

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
    <div className="card-panel rq-panel">
      <button
        type="button"
        className="rq-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="rq-toggle-title">
          <span className="card-title">Cola de órdenes listas</span>
          {pendingCount > 0 && (
            <span className="count-pill is-danger">
              {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
            </span>
          )}
          {stats && stats.confirmedTodayCount > 0 && (
            <span className="count-pill is-success">
              {stats.confirmedTodayCount} confirmada{stats.confirmedTodayCount !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <span className="rq-toggle-hint">
          {expanded ? 'Ocultar' : 'Ver detalles'}
          <span className={`chevron${expanded ? ' is-open' : ''}`} aria-hidden="true" />
        </span>
      </button>

      {expanded && (
        <div className="rq-body">
          {isLoading ? (
            <p className="muted-text">Cargando...</p>
          ) : items.length === 0 ? (
            <p className="muted-text">
              No hay órdenes pendientes en la cola de hoy.
            </p>
          ) : (
            <div className="rq-list">
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
          className="modal-backdrop rq-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setRescheduleId(null);
              setRescheduleError(null);
            }
          }}
        >
          <div className="card-panel rq-dialog" role="dialog" aria-modal="true" aria-labelledby="rq-reschedule-title">
            <h3 id="rq-reschedule-title">Reagendar fecha promesa</h3>
            <label>
              Nueva fecha prometida
              <input
                type="date"
                className="field"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </label>
            {rescheduleError && (
              <p className="error-text">
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
    <div className={`rq-row ${isConfirmed ? 'is-confirmed' : 'is-pending'}`}>
      <div className="rq-row-top">
        <div>
          <strong>{item.orderNumber}</strong>
          {' — '}
          <span>{item.clientName}</span>
        </div>
        <span className="status-chip" data-color={isConfirmed ? 'green' : 'amber'}>
          {isConfirmed ? 'Confirmada' : 'Pendiente'}
        </span>
      </div>

      <div className="rq-row-meta">
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
        <span className={item.balanceDue > 0 ? 'amount-debt' : undefined}>Saldo: {currency(item.balanceDue)}</span>
        <span>{item.itemCount} prenda{item.itemCount !== 1 ? 's' : ''}</span>
      </div>

      <div className="rq-row-actions">
        {!isConfirmed && (
          <button
            className="button button-primary"
            disabled={isActing}
            onClick={onConfirm}
          >
            <IconCheck width={18} height={18} /> Sí, está lista (enviar WA)
          </button>
        )}
        {isConfirmed && whatsappUrl && (
          <button
            className="button button-secondary"
            onClick={() => window.desktopApi.openExternal({ url: whatsappUrl })}
          >
            Reenviar WhatsApp
          </button>
        )}
        <button
          className="button button-secondary"
          disabled={isActing}
          onClick={onReschedule}
        >
          Reagendar
        </button>
        {!isConfirmed && (
          <button
            className="button button-ghost"
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

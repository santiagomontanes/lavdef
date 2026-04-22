import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WarrantyInput, WarrantyRecord } from '@shared/types';
import { api } from '@renderer/services/api';
import { Button, DataTable, Input, Modal, PageHeader, StatusChip } from '@renderer/ui/components';
import { dateTime } from '@renderer/utils/format';

const emptyForm: WarrantyInput = {
  orderId: 0,
  reason: ''
};

export const WarrantiesPage = () => {
  const queryClient = useQueryClient();

  const { data: warranties = [] } = useQuery({
    queryKey: ['warranties'],
    queryFn: api.listWarranties
  });

  const { data: statuses = [] } = useQuery({
    queryKey: ['warranty-statuses'],
    queryFn: api.listWarrantyStatuses
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: api.listOrders
  });

  const [openCreate, setOpenCreate] = useState(false);
  const [openClose, setOpenClose] = useState(false);
  const [form, setForm] = useState<WarrantyInput>(emptyForm);
  const [filter, setFilter] = useState('');
  const [formError, setFormError] = useState('');
  const [resolution, setResolution] = useState('');
  const [selectedWarranty, setSelectedWarranty] = useState<WarrantyRecord | null>(null);

  const createMutation = useMutation({
    mutationFn: api.createWarranty,
    onSuccess: async () => {
      setOpenCreate(false);
      setForm(emptyForm);
      setFormError('');
      await queryClient.invalidateQueries({ queryKey: ['warranties'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({
      id,
      statusId,
      resolution
    }: {
      id: number;
      statusId: number;
      resolution: string | null;
    }) => api.updateWarrantyStatus(id, { statusId, resolution }),
    onSuccess: async () => {
      setOpenClose(false);
      setSelectedWarranty(null);
      setResolution('');
      setFormError('');
      await queryClient.invalidateQueries({ queryKey: ['warranties'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  });

  const filteredWarranties = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return warranties;

    return warranties.filter((item) => {
      return (
        item.orderNumber.toLowerCase().includes(term) ||
        item.clientName.toLowerCase().includes(term) ||
        item.statusName.toLowerCase().includes(term) ||
        item.reason.toLowerCase().includes(term) ||
        (item.resolution ?? '').toLowerCase().includes(term)
      );
    });
  }, [warranties, filter]);

  const availableOrders = useMemo(() => {
    const warrantyOrderIds = new Set(
      warranties
        .filter((item) => !['RESOLVED', 'CLOSED', 'CERRADA', 'RESUELTA'].includes(item.statusCode))
        .map((item) => item.orderId)
    );

    return orders.filter((order) => !warrantyOrderIds.has(order.id));
  }, [orders, warranties]);

  const handleCreate = () => {
    const payload: WarrantyInput = {
      orderId: Number(form.orderId || 0),
      reason: form.reason.trim()
    };

    if (!payload.orderId) {
      setFormError('Debes seleccionar una orden.');
      return;
    }

    if (!payload.reason || payload.reason.length < 3) {
      setFormError('Debes escribir un motivo válido.');
      return;
    }

    setFormError('');
    createMutation.mutate(payload);
  };

  const handleOpenCloseModal = (warranty: WarrantyRecord) => {
    setSelectedWarranty(warranty);
    setResolution(warranty.resolution ?? '');
    setFormError('');
    setOpenClose(true);
  };

  const handleCloseWarranty = () => {
    if (!selectedWarranty) return;

    const resolvedStatus = statuses.find((s) =>
      ['RESOLVED', 'CLOSED', 'RESUELTA', 'CERRADA'].includes(s.code)
    );

    if (!resolvedStatus) {
      setFormError('No existe un estado de cierre en warranty_statuses.');
      return;
    }

    if (!resolution.trim()) {
      setFormError('Debes escribir la resolución de la garantía.');
      return;
    }

    setFormError('');
    updateStatusMutation.mutate({
      id: selectedWarranty.id,
      statusId: resolvedStatus.id,
      resolution: resolution.trim()
    });
  };

  return (
    <section className="stack-gap">
      <PageHeader
        title="Garantías"
        subtitle="Control de garantías abiertas y resueltas."
        actions={<Button onClick={() => setOpenCreate(true)}>Nueva garantía</Button>}
      />

      <div className="card-panel stack-gap">
        <Input
          placeholder="Buscar por orden, cliente, estado o motivo"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <DataTable
          rows={filteredWarranties}
          columns={[
            {
              key: 'order',
              header: 'Orden',
              render: (row) => (
                <div style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {row.orderNumber}
                </div>
              )
            },
            {
              key: 'client',
              header: 'Cliente',
              render: (row) => (
                <div style={{ minWidth: 180 }}>
                  {row.clientName}
                </div>
              )
            },
            {
              key: 'status',
              header: 'Estado',
              render: (row) => (
                <div style={{ whiteSpace: 'nowrap' }}>
                  <StatusChip label={row.statusName} color={row.statusColor} />
                </div>
              )
            },
            {
              key: 'reason',
              header: 'Motivo',
              render: (row) => (
                <div style={{ minWidth: 240, maxWidth: 320 }}>
                  {row.reason}
                </div>
              )
            },
            {
              key: 'resolution',
              header: 'Resolución',
              render: (row) => (
                <div style={{ minWidth: 240, maxWidth: 320 }}>
                  {row.resolution || '—'}
                </div>
              )
            },
            {
              key: 'date',
              header: 'Fecha',
              render: (row) => (
                <div style={{ whiteSpace: 'nowrap' }}>
                  {dateTime(row.createdAt)}
                </div>
              )
            },
            {
              key: 'actions',
              header: 'Acciones',
              render: (row) =>
                ['RESOLVED', 'CLOSED', 'RESUELTA', 'CERRADA'].includes(row.statusCode) ? (
                  <span style={{ whiteSpace: 'nowrap', opacity: 0.7 }}>Cerrada</span>
                ) : (
                  <div style={{ whiteSpace: 'nowrap' }}>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleOpenCloseModal(row)}
                      disabled={updateStatusMutation.isPending}
                    >
                      Cerrar
                    </Button>
                  </div>
                )
            }
          ]}
        />
      </div>

      <Modal
        open={openCreate}
        title="Nueva garantía"
        onClose={() => {
          setOpenCreate(false);
          setForm(emptyForm);
          setFormError('');
        }}
      >
        <div className="stack-gap">
          <label>
            <span>Orden</span>
            <select
              className="field"
              value={form.orderId}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  orderId: Number(e.target.value)
                }))
              }
            >
              <option value={0}>Selecciona una orden</option>
              {availableOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber} · {order.clientName}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Motivo</span>
            <textarea
              className="field"
              rows={4}
              value={form.reason}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  reason: e.target.value
                }))
              }
              placeholder="Describe el motivo de la garantía"
              style={{ resize: 'vertical', paddingTop: 12 }}
            />
          </label>

          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setOpenCreate(false);
                setForm(emptyForm);
                setFormError('');
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Guardando...' : 'Crear garantía'}
            </Button>
          </div>

          {formError && <p className="error-text">{formError}</p>}
          {createMutation.isError && (
            <p className="error-text">{(createMutation.error as Error).message}</p>
          )}
        </div>
      </Modal>

      <Modal
        open={openClose}
        title="Cerrar garantía"
        onClose={() => {
          setOpenClose(false);
          setSelectedWarranty(null);
          setResolution('');
          setFormError('');
        }}
      >
        <div className="stack-gap">
          {selectedWarranty && (
            <div
              className="card-panel"
              style={{ padding: 16, background: 'rgba(0,0,0,0.02)' }}
            >
              <p style={{ margin: 0 }}>
                <strong>Orden:</strong> {selectedWarranty.orderNumber}
              </p>
              <p style={{ margin: '6px 0 0 0' }}>
                <strong>Cliente:</strong> {selectedWarranty.clientName}
              </p>
              <p style={{ margin: '6px 0 0 0' }}>
                <strong>Motivo:</strong> {selectedWarranty.reason}
              </p>
            </div>
          )}

          <label>
            <span>Resolución</span>
            <textarea
              className="field"
              rows={5}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Ejemplo: se volvió a lavar la prenda sin costo / se realizó ajuste / se hizo devolución..."
              style={{ resize: 'vertical', paddingTop: 12 }}
            />
          </label>

          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setOpenClose(false);
                setSelectedWarranty(null);
                setResolution('');
                setFormError('');
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleCloseWarranty} disabled={updateStatusMutation.isPending}>
              {updateStatusMutation.isPending ? 'Cerrando...' : 'Guardar resolución y cerrar'}
            </Button>
          </div>

          {formError && <p className="error-text">{formError}</p>}
          {updateStatusMutation.isError && (
            <p className="error-text">{(updateStatusMutation.error as Error).message}</p>
          )}
        </div>
      </Modal>
    </section>
  );
};
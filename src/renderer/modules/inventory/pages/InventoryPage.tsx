import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServiceInput } from '@shared/types';
import { api } from '@renderer/services/api';
import { Button, DataTable, Input, Modal, PageHeader } from '@renderer/ui/components';

const emptyForm: ServiceInput = {
  categoryId: null,
  name: '',
  basePrice: 0,
  isActive: true
};

export const InventoryPage = () => {
  const queryClient = useQueryClient();

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.listServices(false)
  });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState<ServiceInput>(emptyForm);
  const [priceInput, setPriceInput] = useState('0');

  const createMutation = useMutation({
    mutationFn: api.createService,
    onSuccess: async () => {
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ['services'] });
      await queryClient.invalidateQueries({ queryKey: ['order-catalogs'] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ServiceInput }) =>
      api.updateService(id, input),
    onSuccess: async () => {
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ['services'] });
      await queryClient.invalidateQueries({ queryKey: ['order-catalogs'] });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: (row: { id: number; categoryId: number | null; name: string; basePrice: number; isActive: boolean }) =>
      api.updateService(row.id, {
        categoryId: row.categoryId,
        name: row.name,
        basePrice: row.basePrice,
        isActive: !row.isActive
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['services'] });
      await queryClient.invalidateQueries({ queryKey: ['order-catalogs'] });
    }
  });

  const filteredServices = useMemo(() => {
    const search = filter.trim().toLowerCase();
    const rows = services.filter((service) => {
      if (!search) return true;
      const name = service.name.toLowerCase();
      const price = String(service.basePrice);
      const status = service.isActive ? 'activo' : 'inactivo';
      return (
        name.includes(search) ||
        price.includes(search) ||
        status.includes(search)
      );
    });
    return rows.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name, 'es');
    });
  }, [services, filter]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setPriceInput('0');
    setOpen(true);
  };

  const openEdit = (service: {
    id: number;
    categoryId: number | null;
    name: string;
    basePrice: number;
    isActive: boolean;
  }) => {
    setEditingId(service.id);
    setForm({
      categoryId: service.categoryId,
      name: service.name,
      basePrice: service.basePrice,
      isActive: service.isActive
    });
    setPriceInput(String(Math.max(0, Math.trunc(Number(service.basePrice ?? 0)))));
    setOpen(true);
  };

  const handleSubmit = () => {
    const normalizedPrice = Math.max(0, Math.trunc(Number(priceInput || 0)));
    const payload: ServiceInput = {
      categoryId: form.categoryId ?? null,
      name: form.name.trim(),
      basePrice: normalizedPrice,
      isActive: Boolean(form.isActive)
    };

    if (!payload.name) return;
    if (payload.basePrice < 0) return;

    if (editingId) {
      updateMutation.mutate({ id: editingId, input: payload });
      return;
    }

    createMutation.mutate(payload);
  };

  return (
    <section className="stack-gap">
      <PageHeader
        title="Servicios"
        subtitle="Catálogo de servicios que luego aparecen en órdenes."
        actions={<Button onClick={openCreate}>Nuevo servicio</Button>}
      />

      <div className="card-panel stack-gap">
        <Input
          placeholder="Buscar por nombre, precio o estado"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <DataTable
          rows={filteredServices}
          columns={[
            {
              key: 'name',
              header: 'Servicio',
              render: (row) => row.name
            },
            {
              key: 'price',
              header: 'Precio base',
              render: (row) =>
                new Intl.NumberFormat('es-CO', {
                  style: 'currency',
                  currency: 'COP',
                  maximumFractionDigits: 0
                }).format(row.basePrice)
            },
            {
              key: 'status',
              header: 'Estado',
              render: (row) => (row.isActive ? 'Activo' : 'Inactivo')
            },
            {
              key: 'actions',
              header: 'Acciones',
              render: (row) => (
                <div className="row-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openEdit(row)}
                  >
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant={row.isActive ? 'danger' : 'secondary'}
                    style={
                      row.isActive
                        ? { background: '#b91c1c', color: '#fff', border: 'none' }
                        : { background: '#15803d', color: '#fff', border: 'none' }
                    }
                    onClick={() => toggleMutation.mutate(row)}
                  >
                    {row.isActive ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              )
            }
          ]}
        />
      </div>

      <Modal
        open={open}
        title={editingId ? 'Editar servicio' : 'Nuevo servicio'}
        onClose={() => {
          setOpen(false);
          setEditingId(null);
          setForm(emptyForm);
          setPriceInput('0');
        }}
      >
        <div className="stack-gap">
          <label>
            <span>Nombre del servicio</span>
            <Input
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </label>

          <label>
            <span>Precio base</span>
            <Input
              inputMode="numeric"
              value={priceInput}
              onChange={(e) =>
                setPriceInput((prev) => {
                  const next = e.target.value;
                  if (next === '') return '';
                  if (/^\d+$/.test(next)) return next;
                  return prev;
                })
              }
            />
          </label>

          <label>
            <span>Estado</span>
            <select
              className="field"
              value={form.isActive ? '1' : '0'}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  isActive: e.target.value === '1'
                }))
              }
            >
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </select>
          </label>

          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setEditingId(null);
                setForm(emptyForm);
                setPriceInput('0');
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
            >
              {editingId ? 'Guardar cambios' : 'Crear servicio'}
            </Button>
          </div>

          {createMutation.isError && (
            <p className="error-text">
              {(createMutation.error as Error).message}
            </p>
          )}

          {updateMutation.isError && (
            <p className="error-text">
              {(updateMutation.error as Error).message}
            </p>
          )}

          {toggleMutation.isError && (
            <p className="error-text">
              {(toggleMutation.error as Error).message}
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
};

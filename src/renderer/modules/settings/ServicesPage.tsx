import { useEffect, useState } from 'react';
import type { Service, ServiceInput } from '@shared/types';
import { Button, Input, PriceInput } from '@renderer/ui/components';

const emptyForm: ServiceInput = {
  name: '',
  basePrice: 0,
  isActive: true,
  categoryId: null
};

export const ServicesPage = () => {
  const [services, setServices] = useState<Service[]>([]);  
  const [items, setItems] = useState<Service[]>([]);
  const [form, setForm] = useState<ServiceInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = async () => {
    const data = await window.desktopApi.listServices(false);
    setItems(data);
  };

  useEffect(() => {
    useEffect(() => {
    window.desktopApi.listServices(true).then(setServices);
    }, []);
    load();
  }, []);

  const submit = async () => {
    if (!form.name.trim()) return;

    if (editingId) {
      await window.desktopApi.updateService(editingId, form);
    } else {
      await window.desktopApi.createService(form);
    }

    setForm(emptyForm);
    setEditingId(null);
    await load();
  };

  const edit = (item: Service) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      basePrice: item.basePrice,
      isActive: item.isActive,
      categoryId: item.categoryId
    });
  };

  const remove = async (id: number) => {
    await window.desktopApi.deleteService(id);
    await load();
  };

  return (
    <div className="stack-gap">
      <div className="page-header">
        <h2>Servicios</h2>
      </div>

      <div className="card stack-gap" style={{ padding: 16 }}>
        <div className="form-grid">
          <label>
            <span>Nombre</span>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </label>

          <label>
            <span>Precio base</span>
            <PriceInput
              value={form.basePrice}
              onChange={(v) => setForm((prev) => ({ ...prev, basePrice: v }))}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="button" onClick={submit}>
            {editingId ? 'Actualizar servicio' : 'Crear servicio'}
          </Button>

          {editingId && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Precio base</th>
              <th>Activo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.basePrice.toLocaleString('es-CO')}</td>
                <td>{item.isActive ? 'Sí' : 'No'}</td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <Button type="button" variant="secondary" onClick={() => edit(item)}>
                    Editar
                  </Button>
                  <Button type="button" variant="danger" onClick={() => remove(item.id)}>
                    Desactivar
                  </Button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={4}>No hay servicios registrados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
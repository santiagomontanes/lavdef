import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '@renderer/services/api';
import type { DeliveryInput, InventoryOrder } from '@shared/types';
import { Button, DataTable, Input, Modal, PageHeader, StatusChip } from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';
import { showToast } from '@renderer/utils/toast';

const emptyForm: DeliveryInput = {
  orderId: 0,
  deliveredTo: '',
  receiverDocument: null,
  receiverPhone: null,
  relationshipToClient: null,
  receiverSignature: null,
  ticketCode: ''
};

const getOrderSequence = (orderNumber?: string | null) => {
  const raw = String(orderNumber ?? '').toUpperCase();
  const match = raw.match(/ORD-(\d+)/);
  if (!match) return '';
  return String(Number(match[1]));
};

const normalizeSearch = (value: string) => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return String(Number(raw));
  const match = raw.match(/ORD-(\d+)/);
  if (match) return String(Number(match[1]));
  return raw;
};

const normalizePhone = (raw?: string | null) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  if (digits.length > 10 && !digits.startsWith('57')) return `57${digits.slice(-10)}`;
  return digits;
};

const buildDeliveredMessage = ({
  clientName,
  orderNumber
}: {
  clientName: string;
  orderNumber: string;
}) => `Hola ${clientName} 👋

Tu orden *${orderNumber}* fue entregada correctamente.

Gracias por confiar en nosotros.`;

const normalizeDateKey = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const _now = new Date();
const todayKey = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;

export const DeliveriesPage = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAllInventoryOrders, setShowAllInventoryOrders] = useState(false);

  const { data: deliveries = [] } = useQuery({ queryKey: ['deliveries'], queryFn: api.listDeliveries });
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: api.listOrders });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: api.listClients });
  const { data: inventorySummary } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: api.listInventorySummary,
    refetchInterval: 30_000
  });
  const [inventoryFilter, setInventoryFilter] = useState<string>('ALL');
  const { data: pdfOutputDir } = useQuery({
    queryKey: ['pdf-output-dir'],
    queryFn: async () => {
      try { return await api.getPdfOutputDir(); } catch { return null; }
    }
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DeliveryInput>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [modalOrderFilter, setModalOrderFilter] = useState('');
  const [exportMode, setExportMode] = useState<'due-today' | 'ready' | 'delivered-today' | 'active-all' | null>(null);

  const requestedOrderId = Number(searchParams.get('orderId') || 0);
  const shouldOpenFromOrder = searchParams.get('open') === '1';

  const mutation = useMutation({
    mutationFn: api.createDelivery,
    onSuccess: async (_delivery, variables) => {
      const relatedOrder = orders.find((order) => order.id === variables.orderId);
      const relatedClient = clients.find((client) => client.id === relatedOrder?.clientId);
      const customerPhone = normalizePhone(relatedClient?.phone ?? variables.receiverPhone);

      setOpen(false);
      setForm(emptyForm);
      setFormError(null);
      setModalOrderFilter('');

      await queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });

      if (relatedOrder && customerPhone) {
        const url = `https://wa.me/${customerPhone}?text=${encodeURIComponent(
          buildDeliveredMessage({
            clientName: relatedOrder.clientName,
            orderNumber: relatedOrder.orderNumber
          })
        )}`;
        await api.openExternal(url);
      }
    }
  });

  const deliverableOrders = orders.filter((order) => {
    const statusCode = String(order.statusCode ?? '').toUpperCase();
    return !['DELIVERED', 'CANCELLED', 'CANCELED', 'CANCELADO'].includes(statusCode);
  });

  const getOrderClientPhone = (orderId: number) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return null;
    const client = clients.find((item) => item.id === order.clientId);
    return client?.phone ?? null;
  };

  useEffect(() => {
    if (!shouldOpenFromOrder || !requestedOrderId || !deliverableOrders.length) return;
    const selectedOrder = deliverableOrders.find((order) => order.id === requestedOrderId);
    if (!selectedOrder) return;
    setOpen(true);
    setForm((prev) => ({
      ...prev,
      orderId: selectedOrder.id,
      ticketCode: selectedOrder.orderNumber,
      deliveredTo: selectedOrder.clientName ?? '',
      receiverPhone: getOrderClientPhone(selectedOrder.id)
    }));
    setModalOrderFilter(selectedOrder.orderNumber);
    setFormError(null);
    setSearchParams({}, { replace: true });
  }, [shouldOpenFromOrder, requestedOrderId, deliverableOrders, clients, setSearchParams]);

  const filteredDeliverableOrders = useMemo(() => {
    const raw = modalOrderFilter.trim();
    if (!raw) return deliverableOrders;
    const term = normalizeSearch(raw);
    return deliverableOrders.filter((order) => {
      const orderNumber = String(order.orderNumber ?? '').toUpperCase();
      const clientName = String(order.clientName ?? '').toLowerCase();
      const sequence = getOrderSequence(order.orderNumber);
      if (/^\d+$/.test(raw)) return sequence === term;
      if (/^ORD-\d+$/i.test(raw)) return orderNumber === raw.toUpperCase();
      return orderNumber.includes(raw.toUpperCase()) || clientName.includes(raw.toLowerCase());
    });
  }, [deliverableOrders, modalOrderFilter]);

  const validateOrder = () => {
    const selected = orders.find((o) => o.id === form.orderId);
    if (!selected) return 'Debes seleccionar una orden válida.';
    const statusCode = String(selected.statusCode ?? '').toUpperCase();
    const statusName = String(selected.statusName ?? '').toUpperCase();
    if (!['READY', 'READY_FOR_DELIVERY'].includes(statusCode) && !statusName.includes('LISTO')) {
      return 'La orden no está lista para entrega. Debes cambiar el estado a "LISTO PARA ENTREGAR".';
    }
    if (Number(selected.balanceDue ?? 0) > 0) {
      return `La orden tiene saldo pendiente (${currency(selected.balanceDue)}). Debes registrar el pago antes de entregarla.`;
    }
    return null;
  };

  const deliveredTodayRows = useMemo(
    () => deliveries.filter((delivery) => normalizeDateKey(delivery.createdAt) === todayKey),
    [deliveries]
  );

  const shouldDeliverTodayRows = useMemo(() => {
    return orders.filter((order) => {
      const statusCode = String(order.statusCode ?? '').toUpperCase();
      if (['DELIVERED', 'CANCELLED', 'CANCELED', 'CANCELADO'].includes(statusCode)) return false;
      if (['READY', 'READY_FOR_DELIVERY'].includes(statusCode)) return false;
      if (String(order.statusName ?? '').toUpperCase().includes('LISTO')) return false;
      return normalizeDateKey(order.dueDate) === todayKey;
    });
  }, [orders]);

  const readyForDeliveryRows = useMemo(() => {
    return orders
      .filter((order) => {
        const statusCode = String(order.statusCode ?? '').toUpperCase();
        if (['DELIVERED', 'CANCELLED', 'CANCELED', 'CANCELADO'].includes(statusCode)) return false;
        return (
          ['READY', 'READY_FOR_DELIVERY'].includes(statusCode) ||
          String(order.statusName).toUpperCase().includes('LISTO')
        );
      })
      .sort((a, b) => {
        const aDue = normalizeDateKey(a.dueDate) ?? '9999-12-31';
        const bDue = normalizeDateKey(b.dueDate) ?? '9999-12-31';
        if (aDue !== bDue) return aDue.localeCompare(bDue);
        return String(a.orderNumber).localeCompare(String(b.orderNumber));
      });
  }, [orders]);

  const activeOrdersRows = useMemo(() => {
    return orders.filter((order) => {
      const statusCode = String(order.statusCode ?? '').toUpperCase();
      return !['DELIVERED', 'CANCELLED', 'CANCELED', 'CANCELADO'].includes(statusCode);
    });
  }, [orders]);

  const filteredInventoryRows = useMemo(
    () =>
      (inventorySummary?.orders ?? []).filter((o: InventoryOrder) =>
        inventoryFilter === 'ALL' ? true : o.statusCode === inventoryFilter
      ),
    [inventorySummary?.orders, inventoryFilter]
  );

  const visibleInventoryRows = useMemo(
    () => (showAllInventoryOrders ? filteredInventoryRows : filteredInventoryRows.slice(0, 10)),
    [filteredInventoryRows, showAllInventoryOrders]
  );

  useEffect(() => {
    const html = document.documentElement;
    if (exportMode) {
      html.classList.add('deliveries-export-print');
    } else {
      html.classList.remove('deliveries-export-print');
    }
    return () => html.classList.remove('deliveries-export-print');
  }, [exportMode]);

  const exportSectionToPdf = async (
    mode: 'due-today' | 'ready' | 'delivered-today' | 'active-all',
    fileName: string
  ) => {
    setExportMode(mode);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    try {
      const result = await api.printToPdfAuto({
        defaultFileName: fileName,
        targetDir: pdfOutputDir ?? null,
        subfolder: `Entregas/${todayKey}`,
        pageSize: 'A4',
        landscape: false
      });
      if (result.saved) {
        showToast(`PDF exportado${result.path ? `: ${result.path}` : ''}`, 'success');
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'No fue posible exportar el PDF.',
        'error'
      );
    } finally {
      setExportMode(null);
    }
  };

  const buildThermalListHtml = (
    title: string,
    companyName: string,
    generatedAt: string,
    summary: { orders: number; totalItems: number },
    rows: Array<{ orderNumber: string; clientName: string; dueDate: string | null; statusName: string; itemsCount?: number }>
  ) => {
    const body = rows.length
      ? rows.map((row, idx) => `
          <div class="item">
            <div><strong>${idx + 1}. ${row.orderNumber}</strong></div>
            <div>${row.clientName}</div>
            <div>Prendas: ${Number(row.itemsCount ?? 0)}</div>
            <div>Estado: ${row.statusName}</div>
            <div>Fecha promesa: ${row.dueDate ? new Date(row.dueDate).toLocaleDateString('es-CO') : '—'}</div>
          </div>`).join('')
      : '<div class="item">Sin órdenes.</div>';

    return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          @page { size: 80mm auto; margin: 2mm; }
          body { font-family: monospace; color: #000; margin: 0; padding: 0; width: 76mm; font-size: 11px; }
          .wrap { padding: 2mm; }
          h1 { font-size: 13px; text-align: center; margin: 0 0 6px; }
          .meta { margin: 0 0 6px; font-size: 10px; color: #333; }
          .item { border-top: 1px dashed #000; padding: 6px 0; }
          .resume { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; margin: 8px 0; }
          .resume div { display: flex; justify-content: space-between; gap: 8px; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <h1>${companyName || 'Lavandería'}</h1>
          <div class="meta">${generatedAt}</div>
          <h1>${title}</h1>
          <div class="resume">
            <div><span>Órdenes</span><strong>${summary.orders}</strong></div>
            <div><span>Total prendas</span><strong>${summary.totalItems}</strong></div>
          </div>
          ${body}
        </div>
      </body>
    </html>`;
  };

  const printThermalList = async (
    title: string,
    rows: Array<{ orderNumber: string; clientName: string; dueDate: string | null; statusName: string }>
  ) => {
    const company = await api.companySettings().catch(() => null);
    const generatedAt = new Date().toLocaleString('es-CO');
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const order = orders.find((item) => item.orderNumber === row.orderNumber);
        if (!order) return { ...row, itemsCount: 0 };
        const detail = await api.orderDetail(order.id).catch(() => null);
        const itemsCount = (detail?.items ?? []).reduce(
          (sum, item) => sum + Number(item.quantity ?? 0), 0
        );
        return { ...row, itemsCount };
      })
    );
    const summary = enriched.reduce(
      (acc, row) => { acc.orders += 1; acc.totalItems += Number(row.itemsCount ?? 0); return acc; },
      { orders: 0, totalItems: 0 }
    );
    const win = window.open('', '_blank', 'width=430,height=900');
    if (!win) return;
    win.document.open();
    win.document.write(buildThermalListHtml(title, company?.companyName ?? 'Lavandería', generatedAt, summary, enriched));
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  };

  const handleSubmit = () => {
    if (!form.orderId) { setFormError('Debes seleccionar una orden.'); return; }
    if (!form.deliveredTo.trim()) { setFormError('Debes ingresar el nombre de quien recibe.'); return; }
    const validationError = validateOrder();
    if (validationError) { setFormError(validationError); return; }
    setFormError(null);
    mutation.mutate(form);
  };

  const getOrderDisplay = (orderId: number) => {
    const relatedOrder = orders.find((order) => order.id === orderId);
    return relatedOrder?.orderNumber ?? `#${orderId}`;
  };

  const deliveredPrintableRows = useMemo(
    () =>
      deliveredTodayRows.map((row) => ({
        orderNumber: getOrderDisplay(row.orderId),
        clientName: row.deliveredTo,
        dueDate: null,
        statusName: 'Entregada'
      })),
    [deliveredTodayRows, orders]
  );

  return (
    <section className="stack-gap">
      <PageHeader
        title="Inventario"
        subtitle="Listado de prendas en proceso y confirmación de órdenes listas."
        actions={
          <div className="row-actions">
            <Button
              variant="secondary"
              onClick={() => exportSectionToPdf('active-all', `Entregas-ordenes-activas-${todayKey}.pdf`)}
            >
              Exportar activas PDF
            </Button>
            <Button
              variant="secondary"
              onClick={() => printThermalList('Órdenes activas en lavandería', activeOrdersRows)}
            >
              Imprimir activas
            </Button>
            <Button
              onClick={() => {
                setOpen(true);
                setModalOrderFilter('');
                setForm(emptyForm);
                setFormError(null);
                setSearchParams({}, { replace: true });
              }}
            >
              Entregar orden
            </Button>
          </div>
        }
      />

      {/* CONTADOR DE INVENTARIO */}
      <div className="card-panel stack-gap">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              Órdenes activas: <strong>{inventorySummary?.activeOrdersCount ?? '—'}</strong>
            </span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              Total prendas en tienda: <strong>{inventorySummary?.totalItemsCount ?? '—'}</strong>
            </span>
          </div>
          <div className="row-actions">
            {(['ALL', 'CREATED', 'IN_PROGRESS', 'READY', 'READY_FOR_DELIVERY'] as const).map((code) => {
              const labels: Record<string, string> = {
                ALL: 'Todos',
                CREATED: 'Creada',
                IN_PROGRESS: 'En proceso',
                READY: 'Lista',
                READY_FOR_DELIVERY: 'Lista para entregar'
              };
              return (
                <Button
                  key={code}
                  variant={inventoryFilter === code ? undefined : 'secondary'}
                  onClick={() => setInventoryFilter(code)}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  {labels[code]}
                </Button>
              );
            })}
          </div>
        </div>

        {(() => {
          const totalPrendas = filteredInventoryRows.reduce((sum, o) => sum + Number(o.totalItems ?? 0), 0);
          return (
            <>
              <DataTable
                rows={visibleInventoryRows}
                columns={[
                  { key: 'order', header: 'N° Orden', render: (row: InventoryOrder) => row.orderNumber },
                  { key: 'client', header: 'Cliente', render: (row: InventoryOrder) => row.clientName },
                  {
                    key: 'status',
                    header: 'Estado',
                    render: (row: InventoryOrder) => (
                      <StatusChip label={row.statusName} color={row.statusColor} />
                    )
                  },
                  {
                    key: 'items',
                    header: 'Detalle ítems',
                    render: (row: InventoryOrder) =>
                      row.items.length
                        ? row.items.map((i) => `${i.description} x${i.quantity}`).join(', ')
                        : '—'
                  },
                  {
                    key: 'total',
                    header: 'Total prendas',
                    render: (row: InventoryOrder) => row.totalItems
                  }
                ]}
              />
              {filteredInventoryRows.length > 10 ? (
                <div className="form-actions no-print" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
                  <Button type="button" variant="secondary" onClick={() => setShowAllInventoryOrders((prev) => !prev)}>
                    {showAllInventoryOrders ? 'Mostrar menos' : 'Mostrar todo'}
                  </Button>
                </div>
              ) : null}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '8px 4px 0',
                borderTop: '2px solid var(--color-border, #e2e8f0)',
                marginTop: 4
              }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  Total = <strong>{totalPrendas}</strong> prenda{totalPrendas !== 1 ? 's' : ''}
                </span>
              </div>
            </>
          );
        })()}
      </div>

      {/* 1. Prometidas para hoy (aún en proceso) */}
      <div
        className="card-panel stack-gap delivery-export-section"
        style={{ display: exportMode && exportMode !== 'due-today' ? 'none' : 'block' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div className="stack-gap" style={{ gap: 4 }}>
            <h3 style={{ margin: 0 }}>Órdenes prometidas para hoy (aún en proceso)</h3>
            <p style={{ margin: 0, color: '#64748b' }}>
              Incluye órdenes con fecha promesa de hoy que todavía no están en estado listo.
            </p>
          </div>
          <div className="row-actions no-print">
            <Button type="button" variant="secondary" onClick={() => exportSectionToPdf('due-today', `Entregas-prometidas-hoy-en-proceso-${todayKey}.pdf`)}>
              Exportar PDF
            </Button>
            <Button type="button" variant="secondary" onClick={() => printThermalList('Órdenes pendientes para hoy', shouldDeliverTodayRows)}>
              Imprimir
            </Button>
          </div>
        </div>
        <DataTable
          rows={shouldDeliverTodayRows}
          columns={[
            { key: 'order', header: 'Orden', render: (row) => row.orderNumber },
            { key: 'client', header: 'Cliente', render: (row) => row.clientName },
            { key: 'status', header: 'Estado', render: (row) => row.statusName },
            { key: 'total', header: 'Total', render: (row) => currency(row.total) },
            { key: 'paid', header: 'Abono', render: (row) => currency(row.paidTotal) },
            { key: 'balance', header: 'Saldo', render: (row) => currency(row.balanceDue) }
          ]}
        />
      </div>

      {/* 2. Listas para entregar */}
      <div
        className="card-panel stack-gap delivery-export-section"
        style={{ display: exportMode && exportMode !== 'ready' ? 'none' : 'block' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div className="stack-gap" style={{ gap: 4 }}>
            <h3 style={{ margin: 0 }}>Órdenes listas para entregar</h3>
            <p style={{ margin: 0, color: '#64748b' }}>
              Organizadas por fecha promesa para priorizar salida de prendas.
            </p>
          </div>
          <div className="row-actions no-print">
            <Button type="button" variant="secondary" onClick={() => exportSectionToPdf('ready', `Entregas-ordenes-listas-para-entregar-${todayKey}.pdf`)}>
              Exportar PDF
            </Button>
            <Button type="button" variant="secondary" onClick={() => printThermalList('Órdenes listas para entregar', readyForDeliveryRows)}>
              Imprimir
            </Button>
          </div>
        </div>
        <DataTable
          rows={readyForDeliveryRows}
          columns={[
            { key: 'order', header: 'Orden', render: (row) => row.orderNumber },
            { key: 'client', header: 'Cliente', render: (row) => row.clientName },
            { key: 'due', header: 'Fecha promesa', render: (row) => (row.dueDate ? dateTime(row.dueDate) : '—') },
            { key: 'total', header: 'Total', render: (row) => currency(row.total) },
            { key: 'balance', header: 'Saldo', render: (row) => currency(row.balanceDue) }
          ]}
        />
      </div>

      {/* 3. Entregadas hoy */}
      <div
        className="card-panel stack-gap delivery-export-section"
        style={{ display: exportMode && exportMode !== 'delivered-today' ? 'none' : 'block' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div className="stack-gap" style={{ gap: 4 }}>
            <h3 style={{ margin: 0 }}>Órdenes entregadas hoy</h3>
            <p style={{ margin: 0, color: '#64748b' }}>
              Historial de entregas del día (sección final informativa).
            </p>
          </div>
          <div className="row-actions no-print">
            <Button
              type="button"
              variant="secondary"
              onClick={() => exportSectionToPdf('delivered-today', `Entregas-ordenes-entregadas-hoy-${todayKey}.pdf`)}
            >
              Exportar PDF
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => printThermalList('Órdenes entregadas hoy', deliveredPrintableRows)}
            >
              Imprimir
            </Button>
          </div>
        </div>
        <DataTable
          rows={deliveredTodayRows}
          columns={[
            { key: 'order', header: 'Orden', render: (row) => getOrderDisplay(row.orderId) },
            { key: 'who', header: 'Recibe', render: (row) => row.deliveredTo },
            { key: 'date', header: 'Hora', render: (row) => dateTime(row.createdAt) }
          ]}
        />
      </div>

      {/* 4. Activas en lavandería — al final */}
      <div
        className="card-panel stack-gap delivery-export-section"
        style={{ display: exportMode && exportMode !== 'active-all' ? 'none' : 'block' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Órdenes activas en lavandería</h3>
          <div className="row-actions no-print">
            <Button type="button" variant="secondary" onClick={() => exportSectionToPdf('active-all', `Entregas-ordenes-activas-${todayKey}.pdf`)}>
              Exportar PDF
            </Button>
            <Button type="button" variant="secondary" onClick={() => printThermalList('Órdenes activas en lavandería', activeOrdersRows)}>
              Imprimir
            </Button>
          </div>
        </div>
        <DataTable
          rows={activeOrdersRows}
          columns={[
            { key: 'order', header: 'Orden', render: (row) => row.orderNumber },
            { key: 'client', header: 'Cliente', render: (row) => row.clientName },
            { key: 'status', header: 'Estado', render: (row) => row.statusName },
            { key: 'due', header: 'Fecha promesa', render: (row) => (row.dueDate ? dateTime(row.dueDate) : '—') },
            { key: 'total', header: 'Total', render: (row) => currency(row.total) },
            { key: 'balance', header: 'Saldo', render: (row) => currency(row.balanceDue) }
          ]}
        />
      </div>

      <Modal open={open} title="Confirmar entrega" onClose={() => setOpen(false)}>
        <div className="stack-gap">
          <label>
            <span>Buscar orden</span>
            <Input value={modalOrderFilter} onChange={(e) => setModalOrderFilter(e.target.value)} />
          </label>

          <label>
            <span>Orden *</span>
            <select
              className="field"
              value={form.orderId}
              onChange={(e) => {
                const selectedId = Number(e.target.value);
                const selectedOrder = deliverableOrders.find((o) => o.id === selectedId);
                setForm((prev) => ({
                  ...prev,
                  orderId: selectedId,
                  ticketCode: selectedOrder?.orderNumber ?? prev.ticketCode,
                  deliveredTo: selectedOrder?.clientName ?? prev.deliveredTo,
                  receiverPhone: getOrderClientPhone(selectedId)
                }));
                setModalOrderFilter(selectedOrder?.orderNumber ?? '');
              }}
            >
              <option value={0}>Selecciona</option>
              {filteredDeliverableOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber} · {order.clientName}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Nombre receptor *</span>
            <Input
              value={form.deliveredTo}
              onChange={(e) => setForm((prev) => ({ ...prev, deliveredTo: e.target.value }))}
            />
          </label>

          <label>
            <span>Teléfono (opcional)</span>
            <Input
              value={form.receiverPhone ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, receiverPhone: e.target.value || null }))}
            />
          </label>

          <div className="form-actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit}>Confirmar entrega</Button>
          </div>

          {formError && <p className="error-text">{formError}</p>}
        </div>
      </Modal>

      <style>
        {`
          @media print {
            @page {
              size: A4 portrait;
              margin: 1.2cm;
            }

            html.deliveries-export-print,
            html.deliveries-export-print body,
            html.deliveries-export-print #root {
              width: auto !important;
              height: auto !important;
              min-height: 0 !important;
              overflow: visible !important;
              background: #fff !important;
            }

            html.deliveries-export-print .app-shell {
              display: block !important;
              width: auto !important;
              height: auto !important;
              overflow: visible !important;
            }

            html.deliveries-export-print .sidebar,
            html.deliveries-export-print .topbar,
            html.deliveries-export-print .no-print,
            html.deliveries-export-print .modal-overlay {
              display: none !important;
            }

            html.deliveries-export-print .page-content {
              padding: 0 !important;
              margin: 0 !important;
              width: auto !important;
              max-width: none !important;
              height: auto !important;
              overflow: visible !important;
            }

            html.deliveries-export-print .stack-gap {
              gap: 10px !important;
            }

            html.deliveries-export-print .card-panel {
              border-radius: 10px !important;
              box-shadow: none !important;
              padding: 12px !important;
              overflow: visible !important;
            }

            html.deliveries-export-print .delivery-export-section {
              break-inside: auto !important;
              page-break-inside: auto !important;
            }

            html.deliveries-export-print h3,
            html.deliveries-export-print p,
            html.deliveries-export-print span,
            html.deliveries-export-print strong {
              word-break: normal !important;
              overflow-wrap: break-word !important;
              white-space: normal !important;
            }

            html.deliveries-export-print table {
              width: 100% !important;
              table-layout: fixed !important;
              border-collapse: collapse !important;
            }

            html.deliveries-export-print th,
            html.deliveries-export-print td {
              padding: 6px 8px !important;
              vertical-align: top !important;
              word-break: break-word !important;
              overflow-wrap: anywhere !important;
              white-space: normal !important;
            }

            html.deliveries-export-print tr {
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
          }
        `}
      </style>
    </section>
  );
};

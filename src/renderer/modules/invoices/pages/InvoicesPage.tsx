import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { DataTable, PageHeader, Button, Input } from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';
import { normalizeScan } from '@renderer/utils/normalize';

export const InvoicesPage = () => {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');

  const { data = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: api.listInvoices
  });

  const whatsappMutation = useMutation({
    mutationFn: async (invoiceId: number) => {
      const detail = await api.invoiceDetail(invoiceId);

      if (!detail.clientPhone) {
        throw new Error('El cliente no tiene teléfono registrado.');
      }

      const cleanPhone = detail.clientPhone.replace(/\D/g, '');
      const phone = cleanPhone.startsWith('57') ? cleanPhone : `57${cleanPhone}`;
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(detail.whatsappMessage)}`;

      await api.openExternal(url);
      return detail;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    }
  });

  const filteredInvoices = useMemo(() => {
    const search = normalizeScan(filter);
    if (!search) return data;

    return data.filter((invoice) => {
      const invoiceNumber = normalizeScan(invoice.invoiceNumber ?? '');
      const orderId = normalizeScan(String(invoice.orderId ?? ''));
      const clientName = normalizeScan(invoice.clientName ?? '');
      const ticketCode = normalizeScan(invoice.ticketCode ?? '');

      return (
        invoiceNumber.includes(search) ||
        orderId.includes(search) ||
        clientName.includes(search) ||
        ticketCode.includes(search)
      );
    });
  }, [data, filter]);

  return (
    <section className="stack-gap">
      <PageHeader
        title="Facturación"
        subtitle="Listado de facturas emitidas a partir de órdenes."
      />

      <div className="card-panel stack-gap">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Input
            placeholder="Filtrar por factura, orden, cliente o ticket"
            value={filter}
            onChange={(e) => setFilter(normalizeScan(e.target.value))}
          />
        </div>

        <DataTable
          rows={filteredInvoices}
          columns={[
            { key: 'invoice', header: 'Factura', render: (row) => row.invoiceNumber },
            { key: 'order', header: 'Orden', render: (row) => row.orderId },
            { key: 'client', header: 'Cliente', render: (row) => row.clientName },
            {
              key: 'dueDate',
              header: 'Fecha promesa',
              render: (row) => (row.dueDate ? dateTime(row.dueDate) : '—')
            },
            { key: 'total', header: 'Total', render: (row) => currency(row.total) },
            { key: 'paid', header: 'Abonado', render: (row) => currency(row.paidTotal) },
            { key: 'balance', header: 'Saldo', render: (row) => currency(row.balanceDue) },
            { key: 'ticket', header: 'Ticket', render: (row) => row.ticketCode },
            { key: 'date', header: 'Fecha', render: (row) => dateTime(row.createdAt) },
            {
              key: 'actions',
              header: 'Acciones',
              render: (row) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link className="button button-secondary" to={`/facturas/${row.orderId}`}>
                    Ver
                  </Link>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => whatsappMutation.mutate(row.id)}
                  >
                    WhatsApp
                  </Button>
                </div>
              )
            }
          ]}
        />
      </div>

      {whatsappMutation.isError && (
        <p className="error-text">{(whatsappMutation.error as Error).message}</p>
      )}
    </section>
  );
};

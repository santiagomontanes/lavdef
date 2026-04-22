import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import { DataTable, Input, PageHeader, Select } from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';

export const PaymentsPage = () => {
  const [methodFilter, setMethodFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.listPayments()
  });

  const { data: catalogs } = useQuery({
    queryKey: ['order-catalogs'],
    queryFn: api.orderCatalogs
  });

  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => {
      const matchesMethod =
        !methodFilter || String(payment.paymentMethodId) === methodFilter;

      const paymentDate = new Date(payment.createdAt);
      const paymentDateOnly = new Date(
        paymentDate.getFullYear(),
        paymentDate.getMonth(),
        paymentDate.getDate()
      );

      const matchesFrom =
        !dateFrom || paymentDateOnly >= new Date(`${dateFrom}T00:00:00`);

      const matchesTo =
        !dateTo || paymentDateOnly <= new Date(`${dateTo}T23:59:59`);

      return matchesMethod && matchesFrom && matchesTo;
    });
  }, [payments, methodFilter, dateFrom, dateTo]);

  return (
    <section className="stack-gap">
      <PageHeader
        title="Pagos"
        subtitle="Historial consolidado de pagos registrados sobre órdenes."
      />

      <div className="card-panel stack-gap">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
          >
            <option value="">Todos los métodos</option>
            {catalogs?.paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </Select>

          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />

          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <DataTable
          rows={filteredPayments}
          columns={[
            { key: 'order', header: 'Orden', render: (row) => row.orderId },
            { key: 'method', header: 'Método', render: (row) => row.paymentMethodName },
            { key: 'amount', header: 'Monto', render: (row) => currency(row.amount) },
            { key: 'reference', header: 'Referencia', render: (row) => row.reference || '—' },
            { key: 'date', header: 'Fecha', render: (row) => dateTime(row.createdAt) }
          ]}
        />
      </div>
    </section>
  );
};
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { DataTable, PageHeader, SummaryCard } from '@renderer/ui/components';
import { currency } from '@renderer/utils/format';
import { ReadyQueueWidget } from '@renderer/modules/ready-queue/components/ReadyQueueWidget';

export const DashboardPage = () => {
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboardSummary });
  const paymentTotalToday = (data?.paymentBreakdown ?? []).reduce(
    (sum, item) => sum + Number(item.amount ?? 0),
    0
  );

  return (
    <section className="stack-gap">
      <PageHeader title="Inicio" subtitle="Resumen comercial y operativo del día." actions={<Link className="button button-primary" to="/ordenes/nueva">Nueva orden</Link>} />
      <div className="row-actions">
        <Link className="button button-secondary" to="/ordenes">Ver órdenes</Link>
        <Link className="button button-secondary" to="/entregas">Inventario</Link>
        <Link className="button button-secondary" to="/facturacion">Facturación</Link>
        <Link className="button button-secondary" to="/caja">Caja</Link>
        <Link className="button button-secondary" to="/reportes">Reportes</Link>
      </div>
      <div className="summary-grid">
        <SummaryCard title="Clientes" value={String(data?.clients ?? 0)} accent="#5a7cff" />
        <SummaryCard title="Órdenes abiertas" value={String(data?.openOrders ?? 0)} accent="#c29c6a" />
        <SummaryCard title="Ventas del día" value={currency(data?.dailySales ?? 0)} accent="#5fae88" />
        <SummaryCard title="Gastos del día" value={currency(data?.dailyExpenses ?? 0)} accent="#c97373" />
      </div>
      <div className="summary-grid">
        <SummaryCard title="Saldo pendiente" value={currency(data?.pendingBalance ?? 0)} accent="#d89d4f" />
        <SummaryCard title="Garantías abiertas" value={String(data?.openWarranties ?? 0)} accent="#e0ab55" />
        <SummaryCard title="Pagos de hoy" value={currency(paymentTotalToday)} accent="#6786a8" />
        <SummaryCard title="Órdenes recientes" value={String(data?.recentOrders.length ?? 0)} accent="#7a8a94" />
      </div>
      <ReadyQueueWidget />
      <div className="split-grid">
        <div className="card-panel">
          <h3>Órdenes recientes</h3>
          <DataTable rows={data?.recentOrders ?? []} columns={[
            { key: 'number', header: 'Orden', render: (row) => row.orderNumber },
            { key: 'client', header: 'Cliente', render: (row) => row.clientName },
            { key: 'total', header: 'Total', render: (row) => currency(row.total) },
            { key: 'balance', header: 'Saldo', render: (row) => currency(row.balanceDue) }
          ]} />
        </div>
        <div className="card-panel">
          <h3>Resumen por método</h3>
          <DataTable rows={data?.paymentBreakdown ?? []} columns={[
            { key: 'method', header: 'Método', render: (row) => row.methodName },
            { key: 'amount', header: 'Monto', render: (row) => currency(row.amount) }
          ]} />
        </div>
      </div>
    </section>
  );
};

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { DataTable, PageHeader, SummaryCard } from '@renderer/ui/components';
import { currency } from '@renderer/utils/format';
import { ReadyQueueWidget } from '@renderer/modules/ready-queue/components/ReadyQueueWidget';
import { IconBox, IconCash, IconChart, IconClipboard, IconPlus, IconReceipt } from '@renderer/ui/components/icons';

export const DashboardPage = () => {
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboardSummary });
  const paymentTotalToday = (data?.paymentBreakdown ?? []).reduce(
    (sum, item) => sum + Number(item.amount ?? 0),
    0
  );

  return (
    <section className="stack-gap">
      <PageHeader title="Inicio" subtitle="Resumen comercial y operativo del día." actions={<Link className="button button-primary button-lg" to="/ordenes/nueva"><IconPlus width={20} height={20} /> Nueva orden</Link>} />
      <nav className="quick-actions" aria-label="Accesos rápidos">
        <Link className="quick-action" to="/ordenes"><IconClipboard /> <span>Ver órdenes</span></Link>
        <Link className="quick-action" to="/entregas"><IconBox /> <span>Inventario</span></Link>
        <Link className="quick-action" to="/facturacion"><IconReceipt /> <span>Facturación</span></Link>
        <Link className="quick-action" to="/caja"><IconCash /> <span>Caja</span></Link>
        <Link className="quick-action" to="/reportes"><IconChart /> <span>Reportes</span></Link>
      </nav>
      <div className="summary-grid">
        <SummaryCard title="Clientes" value={String(data?.clients ?? 0)} accent="var(--primary)" />
        <SummaryCard title="Órdenes abiertas" value={String(data?.openOrders ?? 0)} accent="var(--st-progress-dot)" />
        <SummaryCard title="Ventas del día" value={currency(data?.dailySales ?? 0)} accent="var(--st-ready-dot)" />
        <SummaryCard title="Gastos del día" value={currency(data?.dailyExpenses ?? 0)} accent="var(--st-debt-dot)" />
      </div>
      <div className="summary-grid">
        <SummaryCard title="Saldo pendiente" value={currency(data?.pendingBalance ?? 0)} accent="var(--warning)" />
        <SummaryCard title="Garantías abiertas" value={String(data?.openWarranties ?? 0)} accent="var(--st-progress-dot)" />
        <SummaryCard title="Pagos de hoy" value={currency(paymentTotalToday)} accent="var(--st-delivered-dot)" />
        <SummaryCard title="Órdenes recientes" value={String(data?.recentOrders.length ?? 0)} accent="var(--st-created-dot)" />
      </div>
      <ReadyQueueWidget />
      <div className="split-grid">
        <div className="card-panel">
          <h3 className="card-title">Órdenes recientes</h3>
          <DataTable rows={data?.recentOrders ?? []} columns={[
            { key: 'number', header: 'Orden', render: (row) => row.orderNumber },
            { key: 'client', header: 'Cliente', render: (row) => row.clientName },
            { key: 'total', header: 'Total', render: (row) => <strong>{currency(row.total)}</strong> },
            { key: 'balance', header: 'Saldo', render: (row) => <span className={row.balanceDue > 0 ? 'amount-debt' : 'amount-ok'}>{currency(row.balanceDue)}</span> }
          ]} />
        </div>
        <div className="card-panel">
          <h3 className="card-title">Resumen por método</h3>
          <DataTable rows={data?.paymentBreakdown ?? []} columns={[
            { key: 'method', header: 'Método', render: (row) => row.methodName },
            { key: 'amount', header: 'Monto', render: (row) => currency(row.amount) }
          ]} />
        </div>
      </div>
    </section>
  );
};

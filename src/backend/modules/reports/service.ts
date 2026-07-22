import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { InventoryGeneralReport, ReportsSummary } from '../../../shared/types.js';

const startOfDay = (value: string) => new Date(`${value}T00:00:00`);
const endOfDay = (value: string) => new Date(`${value}T23:59:59.999`);
const formatDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const activePaymentPredicate = sql<boolean>`COALESCE(p.status, 'ACTIVE') <> 'VOIDED'`;

export const createReportsService = (db: Kysely<Database>) => ({
  async summary(from?: string, to?: string): Promise<ReportsSummary> {
    const now = new Date();
    const rangeFrom = from ?? formatDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const rangeTo = to ?? formatDateKey(now);

    const orderQuery = db.selectFrom('orders as o');
    const paymentQuery = db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .where(activePaymentPredicate);
    const voidedPaymentQuery = db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .where('p.status', '=', 'VOIDED');
    const expenseQuery = db.selectFrom('expenses as e');
    const paymentOutQuery = db
      .selectFrom('cash_movements as cm')
      .where('cm.movement_type', '=', 'PAYMENT_OUT');

    const orderFiltered = orderQuery
      .where('o.created_at', '>=', startOfDay(rangeFrom))
      .where('o.created_at', '<=', endOfDay(rangeTo));

    const paymentFiltered = paymentQuery
      .where('p.created_at', '>=', startOfDay(rangeFrom))
      .where('p.created_at', '<=', endOfDay(rangeTo));
    const voidedPaymentFiltered = voidedPaymentQuery
      .where('p.voided_at', '>=', startOfDay(rangeFrom))
      .where('p.voided_at', '<=', endOfDay(rangeTo));

    const expenseFiltered = expenseQuery
      .where(sql<boolean>`e.expense_date >= STR_TO_DATE(${rangeFrom}, '%Y-%m-%d')`)
      .where(sql<boolean>`e.expense_date <= STR_TO_DATE(${rangeTo}, '%Y-%m-%d')`);

    const paymentOutFiltered = paymentOutQuery
      .where('cm.created_at', '>=', startOfDay(rangeFrom))
      .where('cm.created_at', '<=', endOfDay(rangeTo));

    const [
      totalSalesRow,
      totalPaymentsRow,
      totalExpensesRow,
      totalPaymentOutRow,
      totalVoidedPaymentsRow,
      totalOrdersRow,
      warrantiesCreatedRow,
      warrantiesClosedRow,
      openWarrantiesRow,
      paymentMethods,
      voidedPaymentMethods,
      orderStatuses,
      expensesByCategory,
      expensesByPaymentMethod,
      biggestExpenses,
      dailySalesRows,
      dailyPaymentsRows,
      dailyExpensesRows,
      dailyPaymentOutRows,
      dailyOrdersRows,
      piecesEnteredRow,
      ordersDeliveredRow,
      ordersCanceledRow,
      outstandingBalanceRow,
      manualVsDigitalRows
    ] = await Promise.all([
      orderFiltered
        .select((eb) => eb.fn.sum<number>('o.total').as('sum'))
        .executeTakeFirst(),

      paymentFiltered
        .select((eb) => eb.fn.sum<number>('p.amount').as('sum'))
        .executeTakeFirst(),

      voidedPaymentFiltered
        .select((eb) => eb.fn.sum<number>('p.amount').as('sum'))
        .executeTakeFirst(),

      expenseFiltered
        .select((eb) => eb.fn.sum<number>('e.amount').as('sum'))
        .executeTakeFirst(),

      paymentOutFiltered
        .select((eb) => eb.fn.sum<number>('cm.amount').as('sum'))
        .executeTakeFirst(),

      orderFiltered
        .select((eb) => eb.fn.count<number>('o.id').as('count'))
        .executeTakeFirst(),

      db
        .selectFrom('warranties')
        .select((eb) => eb.fn.count<number>('id').as('count'))
        .where('created_at', '>=', startOfDay(rangeFrom))
        .where('created_at', '<=', endOfDay(rangeTo))
        .executeTakeFirst(),

      db
        .selectFrom('warranty_status_logs as wsl')
        .innerJoin('warranty_statuses as ws', 'ws.id', 'wsl.status_id')
        .select((eb) => eb.fn.count<number>('wsl.id').as('count'))
        .where('ws.code', 'in', ['CLOSED', 'RESOLVED'])
        .where('wsl.created_at', '>=', startOfDay(rangeFrom))
        .where('wsl.created_at', '<=', endOfDay(rangeTo))
        .executeTakeFirst(),

      db
        .selectFrom('warranties as w')
        .innerJoin('warranty_statuses as ws', 'ws.id', 'w.status_id')
        .select((eb) => eb.fn.count<number>('w.id').as('count'))
        .where('ws.code', '=', 'OPEN')
        .executeTakeFirst(),

      paymentFiltered
        .select([
          sql<string>`pm.name`.as('method_name'),
          (eb) => eb.fn.sum<number>('p.amount').as('amount'),
          (eb) => eb.fn.count<number>('p.id').as('count')
        ])
        .groupBy('pm.name')
        .orderBy('amount', 'desc')
        .execute(),

      voidedPaymentFiltered
        .select([
          sql<string>`pm.name`.as('method_name'),
          (eb) => eb.fn.sum<number>('p.amount').as('amount'),
          (eb) => eb.fn.count<number>('p.id').as('count')
        ])
        .groupBy('pm.name')
        .orderBy('amount', 'desc')
        .execute(),

      orderFiltered
        .innerJoin('order_statuses as os', 'os.id', 'o.status_id')
        .select([
          sql<string>`os.name`.as('status_name'),
          (eb) => eb.fn.count<number>('o.id').as('count'),
          (eb) => eb.fn.sum<number>('o.total').as('total')
        ])
        .groupBy('os.name')
        .orderBy('count', 'desc')
        .execute(),

      expenseFiltered
        .innerJoin('expense_categories as ec', 'ec.id', 'e.category_id')
        .select([
          sql<string>`ec.name`.as('category_name'),
          (eb) => eb.fn.sum<number>('e.amount').as('amount'),
          (eb) => eb.fn.count<number>('e.id').as('count')
        ])
        .groupBy('ec.name')
        .orderBy('amount', 'desc')
        .execute(),

      expenseFiltered
        .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
        .select([
          sql<string>`COALESCE(pm.name, 'Sin método')`.as('method_name'),
          (eb) => eb.fn.sum<number>('e.amount').as('amount'),
          (eb) => eb.fn.count<number>('e.id').as('count')
        ])
        .groupBy(sql`COALESCE(pm.name, 'Sin método')`)
        .orderBy('amount', 'desc')
        .execute(),

      expenseFiltered
        .innerJoin('expense_categories as ec', 'ec.id', 'e.category_id')
        .select([
          'e.expense_date',
          'e.description',
          'e.amount',
          sql<string>`ec.name`.as('category_name')
        ])
        .orderBy('e.amount', 'desc')
        .limit(20)
        .execute(),

      orderFiltered
        .select([
          sql<string>`DATE_FORMAT(o.created_at, '%Y-%m-%d')`.as('day'),
          (eb) => eb.fn.sum<number>('o.total').as('amount')
        ])
        .groupBy(sql`DATE_FORMAT(o.created_at, '%Y-%m-%d')`)
        .execute(),

      paymentFiltered
        .select([
          sql<string>`DATE_FORMAT(p.created_at, '%Y-%m-%d')`.as('day'),
          (eb) => eb.fn.sum<number>('p.amount').as('amount')
        ])
        .groupBy(sql`DATE_FORMAT(p.created_at, '%Y-%m-%d')`)
        .execute(),

      expenseFiltered
        .select([
          sql<string>`DATE_FORMAT(e.expense_date, '%Y-%m-%d')`.as('day'),
          (eb) => eb.fn.sum<number>('e.amount').as('amount')
        ])
        .groupBy(sql`DATE_FORMAT(e.expense_date, '%Y-%m-%d')`)
        .execute(),

      paymentOutFiltered
        .select([
          sql<string>`DATE_FORMAT(cm.created_at, '%Y-%m-%d')`.as('day'),
          (eb) => eb.fn.sum<number>('cm.amount').as('amount')
        ])
        .groupBy(sql`DATE_FORMAT(cm.created_at, '%Y-%m-%d')`)
        .execute(),

      orderFiltered
        .select([
          sql<string>`DATE_FORMAT(o.created_at, '%Y-%m-%d')`.as('day'),
          (eb) => eb.fn.count<number>('o.id').as('count')
        ])
        .groupBy(sql`DATE_FORMAT(o.created_at, '%Y-%m-%d')`)
        .execute(),

      // Piezas ingresadas (SUM order_items.quantity para órdenes en el rango)
      db
        .selectFrom('order_items as oi')
        .innerJoin('orders as o2', 'o2.id', 'oi.order_id')
        .select((eb) => eb.fn.sum<number>('oi.quantity').as('sum'))
        .where('o2.created_at', '>=', startOfDay(rangeFrom))
        .where('o2.created_at', '<=', endOfDay(rangeTo))
        .executeTakeFirst(),

      // Órdenes entregadas (DISTINCT order_id en delivery_records dentro del rango)
      db
        .selectFrom('delivery_records as dr')
        .select((eb) => eb.fn.count<number>(sql.raw('DISTINCT dr.order_id')).as('count'))
        .where('dr.created_at', '>=', startOfDay(rangeFrom))
        .where('dr.created_at', '<=', endOfDay(rangeTo))
        .executeTakeFirst(),

      // Órdenes canceladas en el rango
      orderFiltered
        .innerJoin('order_statuses as osc', 'osc.id', 'o.status_id')
        .select((eb) => eb.fn.count<number>('o.id').as('count'))
        .where(sql<boolean>`UPPER(osc.code) IN ('CANCELLED','CANCELED','CANCELADO')`)
        .executeTakeFirst(),

      // Saldo pendiente total (suma de balance_due de órdenes creadas en el rango)
      orderFiltered
        .select((eb) => eb.fn.sum<number>('o.balance_due').as('sum'))
        .executeTakeFirst(),

      // Órdenes manual vs digital
      orderFiltered
        .select([
          'o.is_manual',
          (eb) => eb.fn.count<number>('o.id').as('count')
        ])
        .groupBy('o.is_manual')
        .execute()
    ]);

    const totalSales = Number(totalSalesRow?.sum ?? 0);
    const totalPayments = Number(totalPaymentsRow?.sum ?? 0);
    const explicitExpenses = Number(totalExpensesRow?.sum ?? 0);
    const totalPaymentOut = Number(totalPaymentOutRow?.sum ?? 0);
    const totalVoidedPayments = Number(totalVoidedPaymentsRow?.sum ?? 0);
    const totalExpenses = explicitExpenses + totalPaymentOut;

    const salesByDay = new Map(dailySalesRows.map((row) => [row.day, Number(row.amount ?? 0)]));
    const paymentsByDay = new Map(
      dailyPaymentsRows.map((row) => [row.day, Number(row.amount ?? 0)])
    );
    const expensesByDay = new Map(
      dailyExpensesRows.map((row) => [row.day, Number(row.amount ?? 0)])
    );
    const paymentOutByDay = new Map(
      dailyPaymentOutRows.map((row) => [row.day, Number(row.amount ?? 0)])
    );
    const ordersByDay = new Map(dailyOrdersRows.map((row) => [row.day, Number(row.count ?? 0)]));

    const dailySeries: ReportsSummary['dailySeries'] = [];
    let cursor = startOfDay(rangeFrom);
    const end = startOfDay(rangeTo);

    while (cursor <= end) {
      const day = formatDateKey(cursor);
      dailySeries.push({
        date: day,
        sales: salesByDay.get(day) ?? 0,
        payments: paymentsByDay.get(day) ?? 0,
        expenses: (expensesByDay.get(day) ?? 0) + (paymentOutByDay.get(day) ?? 0),
        orders: ordersByDay.get(day) ?? 0
      });
      cursor = addDays(cursor, 1);
    }

    // Día mayor / menor recaudo (basado en payments diarios) y mayor gasto.
    let topRevenueDay: { date: string; amount: number } | null = null;
    let lowestRevenueDay: { date: string; amount: number } | null = null;
    let topExpenseDay: { date: string; amount: number } | null = null;
    for (const day of dailySeries) {
      if (!topRevenueDay || day.payments > topRevenueDay.amount) {
        topRevenueDay = { date: day.date, amount: day.payments };
      }
      if (day.payments > 0) {
        if (!lowestRevenueDay || day.payments < lowestRevenueDay.amount) {
          lowestRevenueDay = { date: day.date, amount: day.payments };
        }
      }
      if (!topExpenseDay || day.expenses > topExpenseDay.amount) {
        topExpenseDay = { date: day.date, amount: day.expenses };
      }
    }
    if (lowestRevenueDay === null && topRevenueDay && topRevenueDay.amount === 0) {
      lowestRevenueDay = topRevenueDay;
    }

    // Manual vs digital
    let manualOrders = 0;
    let digitalOrders = 0;
    for (const row of manualVsDigitalRows) {
      const count = Number(row.count ?? 0);
      if (Number(row.is_manual ?? 0) === 1) manualOrders += count;
      else digitalOrders += count;
    }

    return {
      from: rangeFrom,
      to: rangeTo,
      totalSales,
      totalExpenses,
      totalPaymentOut,
      totalVoidedPayments,
      netUtility: totalPayments - totalExpenses,
      totalPayments,
      totalOrders: Number(totalOrdersRow?.count ?? 0),
      warrantiesCreated: Number(warrantiesCreatedRow?.count ?? 0),
      warrantiesClosed: Number(warrantiesClosedRow?.count ?? 0),
      openWarranties: Number(openWarrantiesRow?.count ?? 0),
      paymentMethods: paymentMethods.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0),
        count: Number(item.count ?? 0)
      })),
      voidedPaymentMethods: voidedPaymentMethods.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0),
        count: Number(item.count ?? 0)
      })),
      orderStatuses: orderStatuses.map((item) => ({
        statusName: item.status_name,
        count: Number(item.count ?? 0),
        total: Number(item.total ?? 0)
      })),
      expensesByCategory: expensesByCategory.map((item) => ({
        categoryName: item.category_name,
        amount: Number(item.amount ?? 0),
        count: Number(item.count ?? 0)
      })),
      expensesByPaymentMethod: expensesByPaymentMethod.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0),
        count: Number(item.count ?? 0)
      })),
      dailySeries,
      biggestExpenses: biggestExpenses.map((item) => ({
        date:
          item.expense_date instanceof Date
            ? formatDateKey(item.expense_date)
            : formatDateKey(new Date(item.expense_date)),
        description: item.description,
        categoryName: item.category_name,
        amount: Number(item.amount ?? 0)
      })),
      piecesEntered: Number(piecesEnteredRow?.sum ?? 0),
      ordersDelivered: Number(ordersDeliveredRow?.count ?? 0),
      ordersCanceled: Number(ordersCanceledRow?.count ?? 0),
      outstandingBalance: Number(outstandingBalanceRow?.sum ?? 0),
      manualOrders,
      digitalOrders,
      topRevenueDay,
      lowestRevenueDay,
      topExpenseDay
    };
  },

  async inventoryGeneral(from?: string, to?: string): Promise<InventoryGeneralReport> {
    const now = new Date();
    const rangeFrom = from ?? formatDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const rangeTo = to ?? formatDateKey(now);

    const rows = await db
      .selectFrom('orders as o')
      .innerJoin('clients as c', 'c.id', 'o.client_id')
      .leftJoin('order_items as oi', 'oi.order_id', 'o.id')
      .leftJoin('order_statuses as os', 'os.id', 'o.status_id')
      .select([
        'o.id as order_id',
        'o.order_number',
        'o.is_manual',
        'o.manual_order_number',
        'o.created_at',
        'o.total',
        sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
        sql<number>`COALESCE(SUM(oi.quantity), 0)`.as('pieces'),
        sql<string | null>`os.code`.as('status_code')
      ])
      .where('o.created_at', '>=', startOfDay(rangeFrom))
      .where('o.created_at', '<=', endOfDay(rangeTo))
      .groupBy([
        'o.id',
        'o.order_number',
        'o.is_manual',
        'o.manual_order_number',
        'o.created_at',
        'o.total',
        'c.first_name',
        'c.last_name',
        'os.code'
      ])
      .orderBy('o.created_at', 'asc')
      .orderBy('o.id', 'asc')
      .execute();

    const mapped = rows.map((row) => ({
      orderId: Number(row.order_id),
      orderNumber: String(row.order_number ?? ''),
      isManual: Boolean(row.is_manual),
      manualOrderNumber: row.manual_order_number ?? null,
      createdAt: new Date(row.created_at).toISOString(),
      clientName: String(row.client_name ?? ''),
      pieces: Number(row.pieces ?? 0),
      total: Number(row.total ?? 0),
      statusCode: row.status_code ?? null
    }));

    const totals = mapped.reduce(
      (acc, row) => {
        acc.totalOrders += 1;
        acc.totalPieces += Number(row.pieces ?? 0);
        acc.totalValue += Number(row.total ?? 0);
        return acc;
      },
      { totalOrders: 0, totalPieces: 0, totalValue: 0 }
    );

    return {
      from: rangeFrom,
      to: rangeTo,
      rows: mapped,
      totals
    };
  }
});

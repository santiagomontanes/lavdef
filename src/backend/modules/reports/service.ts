import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { ReportsSummary } from '../../../shared/types.js';

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

export const createReportsService = (db: Kysely<Database>) => ({
  async summary(from?: string, to?: string): Promise<ReportsSummary> {
    const now = new Date();
    const rangeFrom = from ?? formatDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const rangeTo = to ?? formatDateKey(now);

    const orderQuery = db.selectFrom('orders as o');
    const paymentQuery = db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id');
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
      totalOrdersRow,
      warrantiesCreatedRow,
      warrantiesClosedRow,
      openWarrantiesRow,
      paymentMethods,
      orderStatuses,
      expensesByCategory,
      expensesByPaymentMethod,
      biggestExpenses,
      dailySalesRows,
      dailyPaymentsRows,
      dailyExpensesRows,
      dailyPaymentOutRows,
      dailyOrdersRows
    ] = await Promise.all([
      orderFiltered
        .select((eb) => eb.fn.sum<number>('o.total').as('sum'))
        .executeTakeFirst(),

      paymentFiltered
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
        .orderBy('amount desc')
        .execute(),

      orderFiltered
        .innerJoin('order_statuses as os', 'os.id', 'o.status_id')
        .select([
          sql<string>`os.name`.as('status_name'),
          (eb) => eb.fn.count<number>('o.id').as('count'),
          (eb) => eb.fn.sum<number>('o.total').as('total')
        ])
        .groupBy('os.name')
        .orderBy('count desc')
        .execute(),

      expenseFiltered
        .innerJoin('expense_categories as ec', 'ec.id', 'e.category_id')
        .select([
          sql<string>`ec.name`.as('category_name'),
          (eb) => eb.fn.sum<number>('e.amount').as('amount'),
          (eb) => eb.fn.count<number>('e.id').as('count')
        ])
        .groupBy('ec.name')
        .orderBy('amount desc')
        .execute(),

      expenseFiltered
        .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
        .select([
          sql<string>`COALESCE(pm.name, 'Sin método')`.as('method_name'),
          (eb) => eb.fn.sum<number>('e.amount').as('amount'),
          (eb) => eb.fn.count<number>('e.id').as('count')
        ])
        .groupBy(sql`COALESCE(pm.name, 'Sin método')`)
        .orderBy('amount desc')
        .execute(),

      expenseFiltered
        .innerJoin('expense_categories as ec', 'ec.id', 'e.category_id')
        .select([
          'e.expense_date',
          'e.description',
          'e.amount',
          sql<string>`ec.name`.as('category_name')
        ])
        .orderBy('e.amount desc')
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
        .execute()
    ]);

    const totalSales = Number(totalSalesRow?.sum ?? 0);
    const totalPayments = Number(totalPaymentsRow?.sum ?? 0);
    const explicitExpenses = Number(totalExpensesRow?.sum ?? 0);
    const totalPaymentOut = Number(totalPaymentOutRow?.sum ?? 0);
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

    return {
      from: rangeFrom,
      to: rangeTo,
      totalSales,
      totalExpenses,
      totalPaymentOut,
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
      }))
    };
  }
});

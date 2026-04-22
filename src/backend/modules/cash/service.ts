import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type {
  CashCloseInput,
  CashCloseResult,
  CashClosureListItem,
  CashOpenInput,
  CashSessionSummary
} from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';

const mapClosureListItem = (row: {
  id: number;
  cash_session_id: number;
  declared_amount: number;
  system_amount: number;
  difference_amount: number;
  closed_at: Date;
}): CashClosureListItem => ({
  id: row.id,
  cashSessionId: row.cash_session_id,
  declaredAmount: Number(row.declared_amount),
  systemAmount: Number(row.system_amount),
  differenceAmount: Number(row.difference_amount),
  closedAt: new Date(row.closed_at).toISOString()
});

export const createCashService = (db: Kysely<Database>) => ({
  async open(input: CashOpenInput) {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const active = await db
      .selectFrom('cash_sessions')
      .selectAll()
      .where('status', '=', 'open')
      .orderBy('id desc')
      .executeTakeFirst();

    if (active) return active;

    const openedByName = String(input?.openedByName ?? '').trim();
    const openedByPhone = String(input?.openedByPhone ?? '').trim();

    if (!openedByName) {
      throw new Error('Debes ingresar el nombre de quien abre la caja.');
    }

    if (!openedByPhone) {
      throw new Error('Debes ingresar el celular de quien abre la caja.');
    }

    let resolvedOpeningAmount = Number(input?.openingAmount ?? 0);

    if (!input?.openingAmount || Number(input.openingAmount) <= 0) {
      const lastClosure = await db
        .selectFrom('cash_closures')
        .select(['declared_amount'])
        .orderBy('id desc')
        .executeTakeFirst();

      resolvedOpeningAmount = Number(lastClosure?.declared_amount ?? 0);
    }

    const result = await db
      .insertInto('cash_sessions')
      .values({
        opened_by: actorId,
        opened_by_name: openedByName,
        opened_by_phone: openedByPhone,
        opening_amount: resolvedOpeningAmount,
        status: 'open'
      })
      .executeTakeFirstOrThrow();

    await db
      .insertInto('audit_logs')
      .values({
        user_id: actorId,
        action: 'CASH_OPEN',
        entity_type: 'cash_session',
        entity_id: String(result.insertId),
        details_json: JSON.stringify({
          openingAmount: resolvedOpeningAmount,
          openedByName,
          openedByPhone,
          actorName
        })
      })
      .execute();

    return db
      .selectFrom('cash_sessions')
      .selectAll()
      .where('id', '=', Number(result.insertId))
      .executeTakeFirstOrThrow();
  },

  async close(input: CashCloseInput): Promise<CashCloseResult> {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const active = await db
      .selectFrom('cash_sessions')
      .selectAll()
      .where('status', '=', 'open')
      .orderBy('id desc')
      .executeTakeFirst();

    if (!active) {
      throw new Error('No hay una caja activa para cerrar.');
    }

    const declaredAmount = Number(input.declaredAmount ?? 0);
    const closureMoment = new Date();

    const company = await db
      .selectFrom('company_settings')
      .select([
        'company_name',
        'legal_name',
        'nit',
        'phone',
        'address'
      ])
      .orderBy('id')
      .executeTakeFirst();

    const cashier = await db
      .selectFrom('users')
      .select(['full_name'])
      .where('id', '=', Number(active.opened_by ?? 1))
      .executeTakeFirst();

    const totalsByMethod = await db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        sql<string>`pm.name`.as('method_name'),
        (eb) => eb.fn.sum<number>('p.amount').as('amount')
      ])
      .where('p.created_at', '>=', active.opened_at)
      .where('p.created_at', '<=', closureMoment)
      .groupBy('pm.name')
      .execute();

    const expensesByMethod = await db
      .selectFrom('expenses as e')
      .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
      .select([
        sql<string>`COALESCE(pm.name, 'Sin método')`.as('method_name'),
        (eb) => eb.fn.sum<number>('e.amount').as('amount')
      ])
      .where('e.cash_session_id', '=', active.id)
      .where('e.created_at', '>=', active.opened_at)
      .where('e.created_at', '<=', closureMoment)
      .groupBy(sql`COALESCE(pm.name, 'Sin método')`)
      .execute();

    const totalExpenses = expensesByMethod.reduce(
      (sum, row) => sum + Number(row.amount ?? 0),
      0
    );

    const movementTotals = await db
      .selectFrom('cash_movements')
      .select([
        'movement_type',
        (eb) => eb.fn.sum<number>('amount').as('amount')
      ])
      .where('cash_session_id', '=', active.id)
      .where('created_at', '>=', active.opened_at)
      .where('created_at', '<=', closureMoment)
      .groupBy('movement_type')
      .execute();

    const movementNet = movementTotals.reduce((sum, item) => {
      const amount = Number(item.amount ?? 0);
      const type = String(item.movement_type ?? '').toUpperCase();
      const isOut = type.endsWith('_OUT');
      return sum + (isOut ? -amount : amount);
    }, 0);

    const deliveredOrders = await db
      .selectFrom('delivery_records as d')
      .innerJoin('orders as o', 'o.id', 'd.order_id')
      .leftJoin('payments as p', 'p.order_id', 'o.id')
      .leftJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        'o.id as order_id',
        'o.order_number',
        'd.delivered_to',
        'o.total',
        'o.paid_total',
        sql<string>`COALESCE(GROUP_CONCAT(DISTINCT pm.name ORDER BY pm.name SEPARATOR ', '), 'Sin método')`.as(
          'payment_methods'
        ),
        sql<Date>`MAX(d.created_at)`.as('delivered_at')
      ])
      .where('d.created_at', '>=', active.opened_at)
      .where('d.created_at', '<=', closureMoment)
      .groupBy([
        'o.id',
        'o.order_number',
        'd.delivered_to',
        'o.total',
        'o.paid_total'
      ])
      .orderBy('delivered_at desc')
      .execute();

    const sessionPayments = await db
      .selectFrom('payments as p')
      .innerJoin('orders as o', 'o.id', 'p.order_id')
      .innerJoin('clients as c', 'c.id', 'o.client_id')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        'p.id',
        'o.id as order_id',
        'o.order_number',
        sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
        'p.amount',
        'p.reference',
        'p.created_at',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .where('p.created_at', '>=', active.opened_at)
      .where('p.created_at', '<=', closureMoment)
      .orderBy('p.created_at desc')
      .execute();

    const openingAmount = Number(active.opening_amount ?? 0);
    const systemAmount = openingAmount + movementNet;
    const differenceAmount = declaredAmount - systemAmount;

    const closureResult = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('cash_closures')
        .values({
          cash_session_id: active.id,
          closed_by: actorId,
          declared_amount: declaredAmount,
          system_amount: systemAmount,
          difference_amount: differenceAmount
        })
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('cash_sessions')
        .set({
          status: 'closed'
        })
        .where('id', '=', active.id)
        .execute();

      if (totalsByMethod.length > 0) {
        const paymentMethods = await trx
          .selectFrom('payment_methods')
          .select(['id', 'name'])
          .execute();

        for (const item of totalsByMethod) {
          const method = paymentMethods.find((pm) => pm.name === item.method_name);
          if (!method) continue;

          await trx
            .insertInto('cash_session_totals')
            .values({
              cash_session_id: active.id,
              payment_method_id: method.id,
              system_amount: Number(item.amount ?? 0),
              counted_amount: null
            })
            .execute();
        }
      }

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId,
          action: 'CASH_CLOSE',
          entity_type: 'cash_session',
          entity_id: String(active.id),
          details_json: JSON.stringify({
            cashSessionId: active.id,
            openingAmount,
            declaredAmount,
            systemAmount,
            differenceAmount,
            movementNet,
            openedByName: active.opened_by_name ?? null,
            openedByPhone: active.opened_by_phone ?? null,
            actorName
          })
        })
        .execute();

      return inserted;
    });

    return {
      closureId: Number(closureResult.insertId),
      cashSessionId: active.id,
      openingAmount,
      declaredAmount,
      systemAmount,
      differenceAmount,
      closedAt: closureMoment.toISOString(),
      cashierName: cashier?.full_name ?? 'Administrador',
      openedByName: active.opened_by_name ?? null,
      openedByPhone: active.opened_by_phone ?? null,
      companyName: company?.company_name ?? 'Mi Negocio',
      companyNit: company?.nit ?? null,
      companyPhone: company?.phone ?? null,
      companyAddress: company?.address ?? null,
      totalsByMethod: totalsByMethod.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0)
      })),
      totalExpenses,
      expensesByMethod: expensesByMethod.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0)
      })),
      deliveredOrders: deliveredOrders.map((item) => ({
        orderId: Number(item.order_id),
        orderNumber: item.order_number,
        deliveredTo: item.delivered_to,
        total: Number(item.total ?? 0),
        paidTotal: Number(item.paid_total ?? 0),
        paymentMethods: item.payment_methods,
        deliveredAt: item.delivered_at
          ? new Date(item.delivered_at).toISOString()
          : null
      })),
      sessionPayments: sessionPayments.map((item) => ({
        id: Number(item.id),
        orderId: Number(item.order_id),
        orderNumber: item.order_number,
        clientName: item.client_name,
        amount: Number(item.amount ?? 0),
        paymentMethodName: item.payment_method_name,
        reference: item.reference ?? null,
        createdAt: new Date(item.created_at).toISOString()
      }))
    };
  },

  async getClosureDetail(closureId: number): Promise<CashCloseResult> {
    const closure = await db
      .selectFrom('cash_closures as cc')
      .innerJoin('cash_sessions as cs', 'cs.id', 'cc.cash_session_id')
      .leftJoin('users as u', 'u.id', 'cc.closed_by')
      .select([
        'cc.id',
        'cc.cash_session_id',
        'cc.declared_amount',
        'cc.system_amount',
        'cc.difference_amount',
        'cc.closed_at',
        'cs.opening_amount',
        'cs.opened_at',
        'cs.opened_by_name',
        'cs.opened_by_phone',
        sql<string>`COALESCE(u.full_name, 'Administrador')`.as('cashier_name')
      ])
      .where('cc.id', '=', closureId)
      .executeTakeFirst();

    if (!closure) {
      throw new Error('Cierre de caja no encontrado.');
    }

    const closedAt = new Date(closure.closed_at);

    const company = await db
      .selectFrom('company_settings')
      .select([
        'company_name',
        'legal_name',
        'nit',
        'phone',
        'address'
      ])
      .orderBy('id')
      .executeTakeFirst();

    const totalsByMethod = await db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        sql<string>`pm.name`.as('method_name'),
        (eb) => eb.fn.sum<number>('p.amount').as('amount')
      ])
      .where('p.created_at', '>=', closure.opened_at)
      .where('p.created_at', '<=', closedAt)
      .groupBy('pm.name')
      .execute();

    const expensesByMethod = await db
      .selectFrom('expenses as e')
      .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
      .select([
        sql<string>`COALESCE(pm.name, 'Sin mÃ©todo')`.as('method_name'),
        (eb) => eb.fn.sum<number>('e.amount').as('amount')
      ])
      .where('e.cash_session_id', '=', closure.cash_session_id)
      .where('e.created_at', '>=', closure.opened_at)
      .where('e.created_at', '<=', closedAt)
      .groupBy(sql`COALESCE(pm.name, 'Sin mÃ©todo')`)
      .execute();

    const totalExpenses = expensesByMethod.reduce(
      (sum, row) => sum + Number(row.amount ?? 0),
      0
    );

    const deliveredOrders = await db
      .selectFrom('delivery_records as d')
      .innerJoin('orders as o', 'o.id', 'd.order_id')
      .leftJoin('payments as p', 'p.order_id', 'o.id')
      .leftJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        'o.id as order_id',
        'o.order_number',
        'd.delivered_to',
        'o.total',
        'o.paid_total',
        sql<string>`COALESCE(GROUP_CONCAT(DISTINCT pm.name ORDER BY pm.name SEPARATOR ', '), 'Sin mÃ©todo')`.as(
          'payment_methods'
        ),
        sql<Date>`MAX(d.created_at)`.as('delivered_at')
      ])
      .where('d.created_at', '>=', closure.opened_at)
      .where('d.created_at', '<=', closedAt)
      .groupBy([
        'o.id',
        'o.order_number',
        'd.delivered_to',
        'o.total',
        'o.paid_total'
      ])
      .orderBy('delivered_at desc')
      .execute();

    const sessionPayments = await db
      .selectFrom('payments as p')
      .innerJoin('orders as o', 'o.id', 'p.order_id')
      .innerJoin('clients as c', 'c.id', 'o.client_id')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        'p.id',
        'o.id as order_id',
        'o.order_number',
        sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
        'p.amount',
        'p.reference',
        'p.created_at',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .where('p.created_at', '>=', closure.opened_at)
      .where('p.created_at', '<=', closedAt)
      .orderBy('p.created_at desc')
      .execute();

    return {
      closureId: closure.id,
      cashSessionId: closure.cash_session_id,
      openingAmount: Number(closure.opening_amount ?? 0),
      declaredAmount: Number(closure.declared_amount ?? 0),
      systemAmount: Number(closure.system_amount ?? 0),
      differenceAmount: Number(closure.difference_amount ?? 0),
      closedAt: closedAt.toISOString(),
      cashierName: closure.cashier_name,
      openedByName: closure.opened_by_name ?? null,
      openedByPhone: closure.opened_by_phone ?? null,
      companyName: company?.company_name ?? 'Mi Negocio',
      companyNit: company?.nit ?? null,
      companyPhone: company?.phone ?? null,
      companyAddress: company?.address ?? null,
      totalsByMethod: totalsByMethod.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0)
      })),
      totalExpenses,
      expensesByMethod: expensesByMethod.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0)
      })),
      deliveredOrders: deliveredOrders.map((item) => ({
        orderId: Number(item.order_id),
        orderNumber: item.order_number,
        deliveredTo: item.delivered_to,
        total: Number(item.total ?? 0),
        paidTotal: Number(item.paid_total ?? 0),
        paymentMethods: item.payment_methods,
        deliveredAt: item.delivered_at
          ? new Date(item.delivered_at).toISOString()
          : null
      })),
      sessionPayments: sessionPayments.map((item) => ({
        id: Number(item.id),
        orderId: Number(item.order_id),
        orderNumber: item.order_number,
        clientName: item.client_name,
        amount: Number(item.amount ?? 0),
        paymentMethodName: item.payment_method_name,
        reference: item.reference ?? null,
        createdAt: new Date(item.created_at).toISOString()
      }))
    };
  },

  async summary(): Promise<CashSessionSummary> {
    const active = await db
      .selectFrom('cash_sessions')
      .selectAll()
      .where('status', '=', 'open')
      .orderBy('id desc')
      .executeTakeFirst();

    const lastClosure = await db
      .selectFrom('cash_closures')
      .selectAll()
      .orderBy('id desc')
      .executeTakeFirst();

    const recentClosures = (await db
      .selectFrom('cash_closures')
      .selectAll()
      .orderBy('id desc')
      .limit(5)
      .execute()).map(mapClosureListItem);

    if (!active) {
      return {
        activeSession: null,
        suggestedOpeningAmount: Number(lastClosure?.declared_amount ?? 0),
        systemAmount: 0,
        lastClosure: lastClosure
          ? {
              id: lastClosure.id,
              cashSessionId: lastClosure.cash_session_id,
              declaredAmount: Number(lastClosure.declared_amount),
              systemAmount: Number(lastClosure.system_amount),
              differenceAmount: Number(lastClosure.difference_amount),
              closedAt: new Date(lastClosure.closed_at).toISOString()
            }
          : null,
        recentClosures,
        totalsByMethod: [],
        totalExpenses: 0,
        expensesByMethod: [],
        recentMovements: []
      };
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const periodStart =
      new Date(active.opened_at).getTime() > todayStart.getTime()
        ? new Date(active.opened_at)
        : todayStart;

    const totalsByMethod = await db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        sql<string>`pm.name`.as('method_name'),
        (eb) => eb.fn.sum<number>('p.amount').as('amount')
      ])
      .where('p.created_at', '>=', periodStart)
      .groupBy('pm.name')
      .execute();

    const expensesByMethod = await db
      .selectFrom('expenses as e')
      .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
      .select([
        sql<string>`COALESCE(pm.name, 'Sin método')`.as('method_name'),
        (eb) => eb.fn.sum<number>('e.amount').as('amount')
      ])
      .where('e.cash_session_id', '=', active.id)
      .where('e.created_at', '>=', periodStart)
      .groupBy(sql`COALESCE(pm.name, 'Sin método')`)
      .execute();

    const recentMovements = await db
      .selectFrom('cash_movements')
      .selectAll()
      .where('cash_session_id', '=', active.id)
      .where('created_at', '>=', periodStart)
      .orderBy('id desc')
      .limit(10)
      .execute();

    const movementTotals = await db
      .selectFrom('cash_movements')
      .select([
        'movement_type',
        (eb) => eb.fn.sum<number>('amount').as('amount')
      ])
      .where('cash_session_id', '=', active.id)
      .where('created_at', '>=', periodStart)
      .groupBy('movement_type')
      .execute();

    const movementNet = movementTotals.reduce((sum, item) => {
      const amount = Number(item.amount ?? 0);
      const type = String(item.movement_type ?? '').toUpperCase();
      const isOut = type.endsWith('_OUT');
      return sum + (isOut ? -amount : amount);
    }, 0);

    const openingAmount = Number(active.opening_amount);
    const systemAmount = openingAmount + movementNet;
    const totalExpenses = expensesByMethod.reduce(
      (sum, row) => sum + Number(row.amount ?? 0),
      0
    );

    return {
      activeSession: {
        id: active.id,
        openingAmount,
        openedAt: new Date(active.opened_at).toISOString(),
        status: active.status,
        openedByName: active.opened_by_name ?? null,
        openedByPhone: active.opened_by_phone ?? null
      },
      suggestedOpeningAmount: Number(lastClosure?.declared_amount ?? 0),
      systemAmount,
      lastClosure: lastClosure
        ? {
            id: lastClosure.id,
            cashSessionId: lastClosure.cash_session_id,
            declaredAmount: Number(lastClosure.declared_amount),
            systemAmount: Number(lastClosure.system_amount),
            differenceAmount: Number(lastClosure.difference_amount),
            closedAt: new Date(lastClosure.closed_at).toISOString()
          }
        : null,
      recentClosures,
      totalsByMethod: totalsByMethod.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0)
      })),
      totalExpenses,
      expensesByMethod: expensesByMethod.map((item) => ({
        methodName: item.method_name,
        amount: Number(item.amount ?? 0)
      })),
      recentMovements: recentMovements.map((item) => ({
        id: item.id,
        movementType: item.movement_type,
        amount: Number(item.amount),
        notes: item.notes,
        createdAt: new Date(item.created_at).toISOString()
      }))
    };
  }
});

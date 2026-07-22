import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type {
  CashCloseInput,
  CashCloseResult,
  CashClosureFilter,
  CashClosureListItem,
  CashMovementInput,
  CashMovementListItem,
  CashOpenInput,
  CashSessionSummary
} from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';

const SIN_METODO = 'Sin método';
const activePaymentPredicate = sql<boolean>`COALESCE(status, 'ACTIVE') <> 'VOIDED'`;

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

const mapMovementListItem = (row: {
  id: number;
  cash_session_id: number;
  movement_type: string;
  amount: number;
  notes: string | null;
  created_by: number | null;
  created_at: Date;
}): CashMovementListItem => ({
  id: row.id,
  cashSessionId: row.cash_session_id,
  movementType: row.movement_type,
  amount: Number(row.amount),
  notes: row.notes,
  createdBy: row.created_by ?? null,
  createdAt: new Date(row.created_at).toISOString()
});

const resolveCashMethodId = async (db: Kysely<Database>): Promise<number | null> => {
  const byCode = await db
    .selectFrom('payment_methods')
    .select(['id'])
    .where(sql<boolean>`LOWER(code) = 'cash'`)
    .executeTakeFirst();

  if (byCode) return Number(byCode.id);

  const byName = await db
    .selectFrom('payment_methods')
    .select(['id'])
    .where(sql<boolean>`LOWER(name) IN ('efectivo', 'cash')`)
    .executeTakeFirst();

  return byName ? Number(byName.id) : null;
};

type CashOnlyBreakdown = {
  cashOnlyAmount: number;
  cashPayments: number;
  cashExpenses: number;
  manualCashIn: number;
  manualCashOut: number;
  cashRefunds: number;
};

const computeCashOnlyBreakdown = async (
  db: Kysely<Database>,
  args: {
    sessionId: number;
    openingAmount: number;
    periodStart: Date;
    periodEnd: Date;
    cashMethodId: number | null;
  }
): Promise<CashOnlyBreakdown> => {
  const { sessionId, openingAmount, periodStart, periodEnd, cashMethodId } = args;

  const cashPaymentsRow = cashMethodId
    ? await db
        .selectFrom('payments')
        .select((eb) => eb.fn.sum<number>('amount').as('sum'))
        .where('payment_method_id', '=', cashMethodId)
        .where(activePaymentPredicate)
        .where('created_at', '>=', periodStart)
        .where('created_at', '<=', periodEnd)
        .executeTakeFirst()
    : { sum: 0 };

  const cashExpensesRow = cashMethodId
    ? await db
        .selectFrom('expenses')
        .select((eb) => eb.fn.sum<number>('amount').as('sum'))
        .where('cash_session_id', '=', sessionId)
        .where('payment_method_id', '=', cashMethodId)
        .where('created_at', '>=', periodStart)
        .where('created_at', '<=', periodEnd)
        .executeTakeFirst()
    : { sum: 0 };

  const movementRows = await db
    .selectFrom('cash_movements')
    .select([
      'movement_type',
      (eb) => eb.fn.sum<number>('amount').as('sum')
    ])
    .where('cash_session_id', '=', sessionId)
    .where('movement_type', 'in', ['CASH_IN', 'CASH_OUT', 'PAYMENT_OUT'])
    .where('created_at', '>=', periodStart)
    .where('created_at', '<=', periodEnd)
    .groupBy('movement_type')
    .execute();

  const findSum = (type: string) =>
    Number(movementRows.find((row) => row.movement_type === type)?.sum ?? 0);

  const cashPayments = Number(cashPaymentsRow?.sum ?? 0);
  const cashExpenses = Number(cashExpensesRow?.sum ?? 0);
  const manualCashIn = findSum('CASH_IN');
  const manualCashOut = findSum('CASH_OUT');
  const cashRefunds = findSum('PAYMENT_OUT');

  const cashOnlyAmount =
    Number(openingAmount) +
    cashPayments -
    cashExpenses +
    manualCashIn -
    manualCashOut -
    cashRefunds;

  return {
    cashOnlyAmount,
    cashPayments,
    cashExpenses,
    manualCashIn,
    manualCashOut,
    cashRefunds
  };
};

export const createCashService = (db: Kysely<Database>) => ({
  async open(input: CashOpenInput) {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const active = await db
      .selectFrom('cash_sessions')
      .selectAll()
      .where('status', '=', 'open')
      .orderBy('id', 'desc')
      .executeTakeFirst();

    if (active) {
      const openedAtLabel = new Date(active.opened_at).toLocaleString('es-CO');
      throw new Error(
        `Ya hay una caja abierta (sesión #${active.id}, abierta el ${openedAtLabel}). Cierra esa caja antes de abrir una nueva.`
      );
    }

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
        .orderBy('id', 'desc')
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

  async addMovement(input: CashMovementInput) {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();

    const type = input?.type;
    if (type !== 'CASH_IN' && type !== 'CASH_OUT') {
      throw new Error('Tipo de movimiento inválido. Usa CASH_IN o CASH_OUT.');
    }

    const amount = Number(input?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('El monto del movimiento debe ser mayor a 0.');
    }

    const active = await db
      .selectFrom('cash_sessions')
      .selectAll()
      .where('status', '=', 'open')
      .orderBy('id', 'desc')
      .executeTakeFirst();

    if (!active) {
      throw new Error('No hay una caja abierta para registrar el movimiento.');
    }

    if (type === 'CASH_OUT') {
      const cashMethodId = await resolveCashMethodId(db);
      const breakdown = await computeCashOnlyBreakdown(db, {
        sessionId: active.id,
        openingAmount: Number(active.opening_amount ?? 0),
        periodStart: new Date(active.opened_at),
        periodEnd: new Date(),
        cashMethodId
      });

      if (amount > breakdown.cashOnlyAmount) {
        throw new Error(
          `Fondos en efectivo insuficientes. Disponible: ${breakdown.cashOnlyAmount.toLocaleString(
            'es-CO',
            { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }
          )}.`
        );
      }
    }

    const notes = input?.notes ? String(input.notes).trim() || null : null;

    const result = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('cash_movements')
        .values({
          cash_session_id: active.id,
          movement_type: type,
          amount,
          notes,
          created_by: actorId
        })
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId,
          action: type === 'CASH_IN' ? 'CASH_MOVEMENT_IN' : 'CASH_MOVEMENT_OUT',
          entity_type: 'cash_session',
          entity_id: String(active.id),
          details_json: JSON.stringify({
            cashSessionId: active.id,
            movementType: type,
            amount,
            notes,
            actorName
          })
        })
        .execute();

      return inserted;
    });

    const inserted = await db
      .selectFrom('cash_movements')
      .selectAll()
      .where('id', '=', Number(result.insertId))
      .executeTakeFirstOrThrow();

    return mapMovementListItem(inserted);
  },

  async close(input: CashCloseInput): Promise<CashCloseResult> {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const active = await db
      .selectFrom('cash_sessions')
      .selectAll()
      .where('status', '=', 'open')
      .orderBy('id', 'desc')
      .executeTakeFirst();

    if (!active) {
      throw new Error('No hay una caja activa para cerrar.');
    }

    const declaredAmount = Number(input.declaredAmount ?? 0);
    const closureMoment = new Date();
    const periodStart = new Date(active.opened_at);

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
      .where(activePaymentPredicate)
      .where('p.created_at', '>=', periodStart)
      .where('p.created_at', '<=', closureMoment)
      .groupBy('pm.name')
      .execute();

    const expensesByMethod = await db
      .selectFrom('expenses as e')
      .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
      .select([
        sql<string>`COALESCE(pm.name, ${SIN_METODO})`.as('method_name'),
        (eb) => eb.fn.sum<number>('e.amount').as('amount')
      ])
      .where('e.cash_session_id', '=', active.id)
      .where('e.created_at', '>=', periodStart)
      .where('e.created_at', '<=', closureMoment)
      .groupBy(sql`COALESCE(pm.name, ${SIN_METODO})`)
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
      .where('created_at', '>=', periodStart)
      .where('created_at', '<=', closureMoment)
      .groupBy('movement_type')
      .execute();

    const movementNet = movementTotals.reduce((sum, item) => {
      const amount = Number(item.amount ?? 0);
      const type = String(item.movement_type ?? '').toUpperCase();
      const isOut = type.endsWith('_OUT');
      return sum + (isOut ? -amount : amount);
    }, 0);

    const cashMethodId = await resolveCashMethodId(db);
    const breakdown = await computeCashOnlyBreakdown(db, {
      sessionId: active.id,
      openingAmount: Number(active.opening_amount ?? 0),
      periodStart,
      periodEnd: closureMoment,
      cashMethodId
    });

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
        sql<string>`COALESCE(GROUP_CONCAT(DISTINCT CASE WHEN COALESCE(p.status, 'ACTIVE') <> 'VOIDED' THEN pm.name END ORDER BY pm.name SEPARATOR ', '), ${SIN_METODO})`.as(
          'payment_methods'
        ),
        sql<Date>`MAX(d.created_at)`.as('delivered_at')
      ])
      .where('d.created_at', '>=', periodStart)
      .where('d.created_at', '<=', closureMoment)
      .groupBy([
        'o.id',
        'o.order_number',
        'd.delivered_to',
        'o.total',
        'o.paid_total'
      ])
      .orderBy('delivered_at', 'desc')
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
      .where(activePaymentPredicate)
      .where('p.created_at', '>=', periodStart)
      .where('p.created_at', '<=', closureMoment)
      .orderBy('p.created_at', 'desc')
      .execute();

    const voidedPayments = await db
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
        'p.void_reason',
        'p.voided_at',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .where('p.status', '=', 'VOIDED')
      .where('p.voided_at', '>=', periodStart)
      .where('p.voided_at', '<=', closureMoment)
      .orderBy('p.voided_at', 'desc')
      .execute();

    const openingAmount = Number(active.opening_amount ?? 0);
    const systemAmount = openingAmount + movementNet;
    const cashOnlyAmount = breakdown.cashOnlyAmount;
    const differenceAmount = declaredAmount - cashOnlyAmount;

    const closureResult = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('cash_closures')
        .values({
          cash_session_id: active.id,
          closed_by: actorId,
          declared_amount: declaredAmount,
          system_amount: cashOnlyAmount,
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
            cashOnlyAmount,
            differenceAmount,
            movementNet,
            cashBreakdown: breakdown,
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
      cashOnlyAmount,
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
      manualCashIn: breakdown.manualCashIn,
      manualCashOut: breakdown.manualCashOut,
      cashRefunds: breakdown.cashRefunds,
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
      })),
      voidedPayments: voidedPayments.map((item) => ({
        id: Number(item.id),
        orderId: Number(item.order_id),
        orderNumber: item.order_number,
        clientName: item.client_name,
        amount: Number(item.amount ?? 0),
        paymentMethodName: item.payment_method_name,
        reference: item.reference ?? null,
        reason: item.void_reason ?? null,
        voidedAt: item.voided_at ? new Date(item.voided_at).toISOString() : null
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
    const openedAt = new Date(closure.opened_at);

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
      .where(activePaymentPredicate)
      .where('p.created_at', '>=', openedAt)
      .where('p.created_at', '<=', closedAt)
      .groupBy('pm.name')
      .execute();

    const expensesByMethod = await db
      .selectFrom('expenses as e')
      .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
      .select([
        sql<string>`COALESCE(pm.name, ${SIN_METODO})`.as('method_name'),
        (eb) => eb.fn.sum<number>('e.amount').as('amount')
      ])
      .where('e.cash_session_id', '=', closure.cash_session_id)
      .where('e.created_at', '>=', openedAt)
      .where('e.created_at', '<=', closedAt)
      .groupBy(sql`COALESCE(pm.name, ${SIN_METODO})`)
      .execute();

    const totalExpenses = expensesByMethod.reduce(
      (sum, row) => sum + Number(row.amount ?? 0),
      0
    );

    const cashMethodId = await resolveCashMethodId(db);
    const breakdown = await computeCashOnlyBreakdown(db, {
      sessionId: closure.cash_session_id,
      openingAmount: Number(closure.opening_amount ?? 0),
      periodStart: openedAt,
      periodEnd: closedAt,
      cashMethodId
    });

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
        sql<string>`COALESCE(GROUP_CONCAT(DISTINCT CASE WHEN COALESCE(p.status, 'ACTIVE') <> 'VOIDED' THEN pm.name END ORDER BY pm.name SEPARATOR ', '), ${SIN_METODO})`.as(
          'payment_methods'
        ),
        sql<Date>`MAX(d.created_at)`.as('delivered_at')
      ])
      .where('d.created_at', '>=', openedAt)
      .where('d.created_at', '<=', closedAt)
      .groupBy([
        'o.id',
        'o.order_number',
        'd.delivered_to',
        'o.total',
        'o.paid_total'
      ])
      .orderBy('delivered_at', 'desc')
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
      .where(activePaymentPredicate)
      .where('p.created_at', '>=', openedAt)
      .where('p.created_at', '<=', closedAt)
      .orderBy('p.created_at', 'desc')
      .execute();

    const voidedPayments = await db
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
        'p.void_reason',
        'p.voided_at',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .where('p.status', '=', 'VOIDED')
      .where('p.voided_at', '>=', openedAt)
      .where('p.voided_at', '<=', closedAt)
      .orderBy('p.voided_at', 'desc')
      .execute();

    return {
      closureId: closure.id,
      cashSessionId: closure.cash_session_id,
      openingAmount: Number(closure.opening_amount ?? 0),
      declaredAmount: Number(closure.declared_amount ?? 0),
      systemAmount: Number(closure.system_amount ?? 0),
      cashOnlyAmount: breakdown.cashOnlyAmount,
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
      manualCashIn: breakdown.manualCashIn,
      manualCashOut: breakdown.manualCashOut,
      cashRefunds: breakdown.cashRefunds,
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
      })),
      voidedPayments: voidedPayments.map((item) => ({
        id: Number(item.id),
        orderId: Number(item.order_id),
        orderNumber: item.order_number,
        clientName: item.client_name,
        amount: Number(item.amount ?? 0),
        paymentMethodName: item.payment_method_name,
        reference: item.reference ?? null,
        reason: item.void_reason ?? null,
        voidedAt: item.voided_at ? new Date(item.voided_at).toISOString() : null
      }))
    };
  },

  async summary(): Promise<CashSessionSummary> {
    const active = await db
      .selectFrom('cash_sessions')
      .selectAll()
      .where('status', '=', 'open')
      .orderBy('id', 'desc')
      .executeTakeFirst();

    const lastClosure = await db
      .selectFrom('cash_closures')
      .selectAll()
      .orderBy('id', 'desc')
      .executeTakeFirst();

    const recentClosures = (
      await db
        .selectFrom('cash_closures')
        .selectAll()
        .orderBy('id', 'desc')
        .limit(5)
        .execute()
    ).map(mapClosureListItem);

    if (!active) {
      return {
        activeSession: null,
        suggestedOpeningAmount: Number(lastClosure?.declared_amount ?? 0),
        systemAmount: 0,
        cashOnlyAmount: 0,
        manualCashIn: 0,
        manualCashOut: 0,
        cashRefunds: 0,
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

    const periodStart = new Date(active.opened_at);
    const periodEnd = new Date();

    const totalsByMethod = await db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        sql<string>`pm.name`.as('method_name'),
        (eb) => eb.fn.sum<number>('p.amount').as('amount')
      ])
      .where(activePaymentPredicate)
      .where('p.created_at', '>=', periodStart)
      .where('p.created_at', '<=', periodEnd)
      .groupBy('pm.name')
      .execute();

    const voidedPayments = await db
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
        'p.void_reason',
        'p.voided_at',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .where('p.status', '=', 'VOIDED')
      .where('p.voided_at', '>=', periodStart)
      .where('p.voided_at', '<=', periodEnd)
      .orderBy('p.voided_at', 'desc')
      .limit(20)
      .execute();

    const expensesByMethod = await db
      .selectFrom('expenses as e')
      .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
      .select([
        sql<string>`COALESCE(pm.name, ${SIN_METODO})`.as('method_name'),
        (eb) => eb.fn.sum<number>('e.amount').as('amount')
      ])
      .where('e.cash_session_id', '=', active.id)
      .where('e.created_at', '>=', periodStart)
      .where('e.created_at', '<=', periodEnd)
      .groupBy(sql`COALESCE(pm.name, ${SIN_METODO})`)
      .execute();

    const recentMovements = await db
      .selectFrom('cash_movements')
      .selectAll()
      .where('cash_session_id', '=', active.id)
      .where('created_at', '>=', periodStart)
      .where('created_at', '<=', periodEnd)
      .orderBy('id', 'desc')
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
      .where('created_at', '<=', periodEnd)
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

    const cashMethodId = await resolveCashMethodId(db);
    const breakdown = await computeCashOnlyBreakdown(db, {
      sessionId: active.id,
      openingAmount,
      periodStart,
      periodEnd,
      cashMethodId
    });

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
      cashOnlyAmount: breakdown.cashOnlyAmount,
      manualCashIn: breakdown.manualCashIn,
      manualCashOut: breakdown.manualCashOut,
      cashRefunds: breakdown.cashRefunds,
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
      })),
      voidedPayments: voidedPayments.map((item) => ({
        id: Number(item.id),
        orderId: Number(item.order_id),
        orderNumber: item.order_number,
        clientName: item.client_name,
        amount: Number(item.amount ?? 0),
        paymentMethodName: item.payment_method_name,
        reference: item.reference ?? null,
        reason: item.void_reason ?? null,
        voidedAt: item.voided_at ? new Date(item.voided_at).toISOString() : null
      }))
    };
  },

  async listMovements(args?: { sessionId?: number | null; limit?: number; offset?: number }): Promise<CashMovementListItem[]> {
    let sessionId = Number(args?.sessionId ?? 0);

    if (!sessionId) {
      const active = await db
        .selectFrom('cash_sessions')
        .select(['id'])
        .where('status', '=', 'open')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      sessionId = Number(active?.id ?? 0);
    }

    if (!sessionId) return [];

    const limit = Math.min(Math.max(Number(args?.limit ?? 100), 1), 500);
    const offset = Math.max(Number(args?.offset ?? 0), 0);

    const rows = await db
      .selectFrom('cash_movements')
      .selectAll()
      .where('cash_session_id', '=', sessionId)
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map(mapMovementListItem);
  },

  async listClosures(filter?: CashClosureFilter): Promise<CashClosureListItem[]> {
    const limit = Math.min(Math.max(Number(filter?.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filter?.offset ?? 0), 0);

    let query = db
      .selectFrom('cash_closures')
      .selectAll()
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset);

    if (filter?.from) {
      const from = new Date(`${filter.from}T00:00:00`);
      if (!Number.isNaN(from.getTime())) {
        query = query.where('closed_at', '>=', from);
      }
    }

    if (filter?.to) {
      const to = new Date(`${filter.to}T23:59:59.999`);
      if (!Number.isNaN(to.getTime())) {
        query = query.where('closed_at', '<=', to);
      }
    }

    const rows = await query.execute();
    return rows.map(mapClosureListItem);
  }
});

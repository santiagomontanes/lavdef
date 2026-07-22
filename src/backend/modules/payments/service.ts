import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import bcrypt from 'bcryptjs';
import type { Database } from '../../db/schema.js';
import type {
  BatchPaymentInput,
  Payment,
  PaymentInput,
  VoidPaymentInput
} from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName,
  getCurrentSessionUserRoleId
} from '../../../main/services/session-context.js';
import { checkOrderStatus } from '../orders/security/check-order-status.js';

const schema = z.object({
  orderId: z.number().positive(),
  paymentMethodId: z.number().positive(),
  amount: z.number().positive(),
  reference: z.string().nullable(),
  notes: z.string().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(120).nullable().optional()
});

const voidSchema = z.object({
  paymentId: z.number().positive(),
  adminPassword: z.string().min(3),
  reason: z.string().trim().min(5, 'Debes indicar un motivo de anulación.')
});

const DUPLICATE_WINDOW_SECONDS = 10;
const DUPLICATE_PAYMENT_MESSAGE =
  'Este pago parece estar duplicado. Verifica antes de volver a registrar.';

const normalizeReference = (value?: string | null) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const activePaymentPredicate = sql<boolean>`COALESCE(status, 'ACTIVE') <> 'VOIDED'`;

const isDuplicateKeyError = (err: unknown) =>
  (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';

const mapPayment = (row: any): Payment => ({
  id: row.id,
  orderId: row.order_id,
  invoiceId: row.invoice_id,
  paymentMethodId: row.payment_method_id,
  paymentMethodName: row.payment_method_name,
  amount: Number(row.amount),
  reference: row.reference,
  notes: row.notes ?? null,
  status: row.status ?? 'ACTIVE',
  isVoided: String(row.status ?? 'ACTIVE').toUpperCase() === 'VOIDED',
  voidedAt: row.voided_at ? new Date(row.voided_at).toISOString() : null,
  voidedBy: row.voided_by ?? null,
  voidReason: row.void_reason ?? null,
  createdAt: new Date(row.created_at).toISOString()
});

export const createPaymentsService = (db: Kysely<Database>) => {
  const list = async (orderId?: number): Promise<Payment[]> => {
    let query = db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        'p.id',
        'p.order_id',
        'p.invoice_id',
        'p.payment_method_id',
        'p.amount',
        'p.reference',
        'p.notes',
        'p.status',
        'p.voided_at',
        'p.voided_by',
        'p.void_reason',
        'p.created_at',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .orderBy('p.id', 'desc');

    if (orderId) {
      query = query.where('p.order_id', '=', orderId);
    }

    return (await query.execute()).map(mapPayment);
  };

  const listByIdempotencyPrefix = async (prefix: string, orderId: number): Promise<Payment[]> => {
    const rows = await db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        'p.id',
        'p.order_id',
        'p.invoice_id',
        'p.payment_method_id',
        'p.amount',
        'p.reference',
        'p.notes',
        'p.status',
        'p.voided_at',
        'p.voided_by',
        'p.void_reason',
        'p.created_at',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .where('p.order_id', '=', orderId)
      .where('p.idempotency_key', 'like', `${prefix}%`)
      .orderBy('p.id', 'asc')
      .execute();

    return rows.map(mapPayment);
  };

  const assertAdminPassword = async (password: string) => {
    if (Number(getCurrentSessionUserRoleId() ?? 0) !== 1) {
      throw new Error('No tienes permisos para anular pagos.');
    }

    const actorId = getCurrentSessionUserId();
    if (!actorId) throw new Error('Debes iniciar sesión para anular pagos.');

    const user = await db
      .selectFrom('users')
      .select(['id', 'password_hash', 'is_active'])
      .where('id', '=', actorId)
      .where('role_id', '=', 1)
      .executeTakeFirst();

    if (!user || Number(user.is_active) !== 1) {
      throw new Error('No tienes permisos para anular pagos.');
    }

    const hash = String(user.password_hash ?? '');
    const valid = hash.startsWith('$2')
      ? await bcrypt.compare(password, hash)
      : hash === password;

    if (!valid) throw new Error('Contraseña administrativa incorrecta.');
  };

  const recalculateOrderTotals = async (
    trx: Kysely<Database>,
    orderId: number,
    orderTotal: number
  ) => {
    const paidRow = await trx
      .selectFrom('payments')
      .select((eb) => eb.fn.sum<number>('amount').as('sum'))
      .where('order_id', '=', orderId)
      .where(activePaymentPredicate)
      .executeTakeFirst();

    const paidTotal = Number(paidRow?.sum ?? 0);
    const balanceDue = Math.max(0, Number(orderTotal) - paidTotal);

    await trx
      .updateTable('orders')
      .set({ paid_total: paidTotal, balance_due: balanceDue })
      .where('id', '=', orderId)
      .execute();

    return { paidTotal, balanceDue };
  };

  const assertNotRecentDuplicate = async (
    trx: Kysely<Database>,
    input: {
      orderId: number;
      paymentMethodId: number;
      amount: number;
      reference: string | null;
      idempotencyKey?: string | null;
    }
  ) => {
    const duplicate = await trx
      .selectFrom('payments')
      .select(['id', 'idempotency_key'])
      .where('order_id', '=', input.orderId)
      .where('payment_method_id', '=', input.paymentMethodId)
      .where('amount', '=', input.amount)
      .where(activePaymentPredicate)
      .where(sql<boolean>`COALESCE(reference, '') = COALESCE(${input.reference}, '')`)
      .where(sql<boolean>`created_at >= NOW() - INTERVAL ${sql.lit(DUPLICATE_WINDOW_SECONDS)} SECOND`)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    if (!duplicate) return;
    if (input.idempotencyKey && duplicate.idempotency_key === input.idempotencyKey) return;
    throw new Error(DUPLICATE_PAYMENT_MESSAGE);
  };

  const create = async (input: PaymentInput): Promise<Payment> => {
    const parsed = schema.parse(input);
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const idempotencyKey = parsed.idempotencyKey ?? null;

    if (idempotencyKey) {
      const existing = await listByIdempotencyPrefix(idempotencyKey, parsed.orderId);
      if (existing.length > 0) return existing[0];
    }

    try {
      const result = await db.transaction().execute(async (trx) => {
        const cashSession = await trx
          .selectFrom('cash_sessions')
          .selectAll()
          .where('status', '=', 'open')
          .orderBy('id', 'desc')
          .executeTakeFirst();

        if (!cashSession) {
          throw new Error(
            'La caja no está abierta. Dirígete a la sección Caja y ábrela antes de registrar pagos.'
          );
        }

        const order = await trx
          .selectFrom('orders as o')
          .innerJoin('order_statuses as os', 'os.id', 'o.status_id')
          .select([
            'o.id',
            'o.order_number',
            'o.status_id',
            'o.total',
            'o.paid_total',
            'o.balance_due',
            sql<string>`os.code`.as('status_code')
          ])
          .where('o.id', '=', parsed.orderId)
          .forUpdate()
          .executeTakeFirstOrThrow();

        checkOrderStatus(order.status_code, 'registrar pago');
        await assertNotRecentDuplicate(trx, {
          orderId: parsed.orderId,
          paymentMethodId: parsed.paymentMethodId,
          amount: parsed.amount,
          reference: normalizeReference(parsed.reference),
          idempotencyKey
        });

        const previousPaidTotal = Number(order.paid_total);
        const previousBalance = Math.max(0, Number(order.total) - previousPaidTotal);
        const newPaidTotal = previousPaidTotal + parsed.amount;
        const newBalance = Math.max(0, Number(order.total) - newPaidTotal);
        const overpaymentAmount = Math.max(0, parsed.amount - previousBalance);
        const customerCreditAfter = Math.max(0, newPaidTotal - Number(order.total));

        const inserted = await trx
          .insertInto('payments')
          .values({
            order_id: parsed.orderId,
            payment_method_id: parsed.paymentMethodId,
            amount: parsed.amount,
            reference: normalizeReference(parsed.reference),
            notes: parsed.notes ?? null,
            received_by: actorId,
            status: 'ACTIVE',
            idempotency_key: idempotencyKey
          })
          .executeTakeFirstOrThrow();

        await trx
          .updateTable('orders')
          .set({ paid_total: newPaidTotal, balance_due: newBalance })
          .where('id', '=', parsed.orderId)
          .execute();

        if (overpaymentAmount > 0) {
          await trx.insertInto('audit_logs').values({
            user_id: actorId,
            action: 'PAYMENT_OVERPAYMENT',
            entity_type: 'payment',
            entity_id: String(inserted.insertId),
            details_json: JSON.stringify({
              orderId: parsed.orderId,
              orderNumber: order.order_number,
              paymentAmount: parsed.amount,
              previousBalance,
              overpaymentAmount,
              customerCreditAfter,
              actorName
            })
          }).execute();
        }

        const currentCode = String(order.status_code ?? '').toUpperCase();
        if (newBalance <= 0 && currentCode === 'READY') {
          const readyForDeliveryStatus = await trx
            .selectFrom('order_statuses')
            .selectAll()
            .where('code', '=', 'READY_FOR_DELIVERY')
            .executeTakeFirst();

          if (readyForDeliveryStatus && order.status_id !== readyForDeliveryStatus.id) {
            await trx
              .updateTable('orders')
              .set({ status_id: readyForDeliveryStatus.id, status_changed_at: sql`NOW()` as unknown as Date } as any)
              .where('id', '=', parsed.orderId)
              .execute();

            await trx.insertInto('order_status_history').values({
              order_id: parsed.orderId,
              status_id: readyForDeliveryStatus.id,
              notes: 'Estado automático: orden pagada completamente'
            }).execute();
          }
        }

        const paymentMethod = await trx
          .selectFrom('payment_methods')
          .select(['name'])
          .where('id', '=', parsed.paymentMethodId)
          .executeTakeFirst();

        await trx.insertInto('cash_movements').values({
          cash_session_id: cashSession.id,
          movement_type: 'PAYMENT_IN',
          amount: parsed.amount,
          notes: `Pago orden #${parsed.orderId} · ${paymentMethod?.name ?? 'Método desconocido'}${parsed.reference ? ` · Ref: ${parsed.reference}` : ''}`,
          created_by: actorId
        }).execute();

        await trx.insertInto('audit_logs').values({
          user_id: actorId,
          action: 'PAYMENT_CREATE',
          entity_type: 'payment',
          entity_id: String(inserted.insertId),
          details_json: JSON.stringify({ ...parsed, orderNumber: order.order_number, actorName })
        }).execute();

        return inserted;
      });

      return (await list(parsed.orderId)).find(
        (payment) => payment.id === Number(result.insertId)
      ) as Payment;
    } catch (err) {
      if (idempotencyKey && isDuplicateKeyError(err)) {
        const existing = await listByIdempotencyPrefix(idempotencyKey, parsed.orderId);
        if (existing.length > 0) return existing[0];
      }
      throw err;
    }
  };

  const createBatch = async (input: BatchPaymentInput): Promise<Payment[]> => {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const idempotencyKey = String(input.idempotencyKey ?? '').trim() || null;

    if (!input.lines || input.lines.length === 0) {
      throw new Error('Debes ingresar al menos una línea de pago.');
    }

    if (idempotencyKey) {
      const existing = await listByIdempotencyPrefix(`${idempotencyKey}:`, input.orderId);
      if (existing.length > 0) return existing;
    }

    const totalAmount = input.lines.reduce((sum, l) => sum + Number(l.amount || 0), 0);
    if (totalAmount <= 0) {
      throw new Error('El monto total del pago debe ser mayor a 0.');
    }

    const insertedIds: number[] = [];

    try {
      await db.transaction().execute(async (trx) => {
        const cashSession = await trx
          .selectFrom('cash_sessions')
          .selectAll()
          .where('status', '=', 'open')
          .orderBy('id', 'desc')
          .executeTakeFirst();

        if (!cashSession) {
          throw new Error(
            'La caja no está abierta. Dirígete a la sección Caja y ábrela antes de registrar pagos.'
          );
        }

        const order = await trx
          .selectFrom('orders as o')
          .innerJoin('order_statuses as os', 'os.id', 'o.status_id')
          .select([
            'o.id',
            'o.order_number',
            'o.status_id',
            'o.total',
            'o.paid_total',
            'o.balance_due',
            sql<string>`os.code`.as('status_code')
          ])
          .where('o.id', '=', input.orderId)
          .forUpdate()
          .executeTakeFirstOrThrow();

        checkOrderStatus(order.status_code, 'registrar pago');

        const balanceDue = Number(order.balance_due);
        const previousPaidTotal = Number(order.paid_total);
        const amountToApply = totalAmount;
        const newPaidTotal = previousPaidTotal + amountToApply;
        const newBalance = Math.max(0, Number(order.total) - newPaidTotal);
        const overpaymentAmount = Math.max(0, amountToApply - balanceDue);
        const customerCreditAfter = Math.max(0, newPaidTotal - Number(order.total));

        let remaining = amountToApply;
        for (const [index, line] of input.lines.entries()) {
          const lineAmount = Math.min(Number(line.amount || 0), remaining);
          if (lineAmount <= 0) continue;
          remaining -= lineAmount;
          const lineIdempotencyKey = idempotencyKey ? `${idempotencyKey}:${index}` : null;

          await assertNotRecentDuplicate(trx, {
            orderId: input.orderId,
            paymentMethodId: line.paymentMethodId,
            amount: lineAmount,
            reference: normalizeReference(line.reference),
            idempotencyKey: lineIdempotencyKey
          });

          const paymentMethod = await trx
            .selectFrom('payment_methods')
            .select(['name'])
            .where('id', '=', line.paymentMethodId)
            .executeTakeFirst();

          const inserted = await trx
            .insertInto('payments')
            .values({
              order_id: input.orderId,
              payment_method_id: line.paymentMethodId,
              amount: lineAmount,
              reference: normalizeReference(line.reference),
              notes: input.notes ?? null,
              received_by: actorId,
              status: 'ACTIVE',
              idempotency_key: lineIdempotencyKey
            })
            .executeTakeFirstOrThrow();

          insertedIds.push(Number(inserted.insertId));

          await trx.insertInto('cash_movements').values({
            cash_session_id: cashSession.id,
            movement_type: 'PAYMENT_IN',
            amount: lineAmount,
            notes: `Pago orden #${input.orderId} · ${paymentMethod?.name ?? 'Método desconocido'}${line.reference ? ` · Ref: ${line.reference}` : ''}`,
            created_by: actorId
          }).execute();
        }

        await trx
          .updateTable('orders')
          .set({ paid_total: newPaidTotal, balance_due: newBalance })
          .where('id', '=', input.orderId)
          .execute();

        if (newBalance <= 0 && String(order.status_code ?? '').toUpperCase() === 'READY') {
          const readyForDeliveryStatus = await trx
            .selectFrom('order_statuses')
            .selectAll()
            .where('code', '=', 'READY_FOR_DELIVERY')
            .executeTakeFirst();

          if (readyForDeliveryStatus && order.status_id !== readyForDeliveryStatus.id) {
            await trx
              .updateTable('orders')
              .set({ status_id: readyForDeliveryStatus.id, status_changed_at: sql`NOW()` as unknown as Date } as any)
              .where('id', '=', input.orderId)
              .execute();

            await trx.insertInto('order_status_history').values({
              order_id: input.orderId,
              status_id: readyForDeliveryStatus.id,
              notes: 'Estado automático: orden pagada completamente'
            }).execute();
          }
        }

        if (overpaymentAmount > 0) {
          await trx.insertInto('audit_logs').values({
            user_id: actorId,
            action: 'PAYMENT_OVERPAYMENT',
            entity_type: 'order',
            entity_id: String(input.orderId),
            details_json: JSON.stringify({
              orderId: input.orderId,
              orderNumber: order.order_number,
              totalApplied: amountToApply,
              previousBalance: balanceDue,
              overpaymentAmount,
              customerCreditAfter,
              paymentIds: insertedIds,
              actorName
            })
          }).execute();
        }

        await trx.insertInto('audit_logs').values({
          user_id: actorId,
          action: 'PAYMENT_BATCH_CREATE',
          entity_type: 'order',
          entity_id: String(input.orderId),
          details_json: JSON.stringify({
            orderId: input.orderId,
            orderNumber: order.order_number,
            totalAmount: amountToApply,
            lines: input.lines,
            overpaymentAmount,
            customerCreditAfter,
            idempotencyKey,
            actorName
          })
        }).execute();
      });
    } catch (err) {
      if (idempotencyKey && isDuplicateKeyError(err)) {
        const existing = await listByIdempotencyPrefix(`${idempotencyKey}:`, input.orderId);
        if (existing.length > 0) return existing;
      }
      throw err;
    }

    const allPayments = await list(input.orderId);
    return allPayments.filter((p) => insertedIds.includes(p.id));
  };

  const voidPayment = async (input: VoidPaymentInput): Promise<Payment> => {
    const parsed = voidSchema.parse(input);
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();

    await assertAdminPassword(parsed.adminPassword);

    await db.transaction().execute(async (trx) => {
      const payment = await trx
        .selectFrom('payments as p')
        .innerJoin('orders as o', 'o.id', 'p.order_id')
        .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
        .select([
          'p.id',
          'p.order_id',
          'p.payment_method_id',
          'p.amount',
          'p.reference',
          'p.status',
          'o.order_number',
          'o.total',
          sql<string>`pm.name`.as('payment_method_name')
        ])
        .where('p.id', '=', parsed.paymentId)
        .forUpdate()
        .executeTakeFirst();

      if (!payment) throw new Error('Pago no encontrado.');
      if (String(payment.status ?? 'ACTIVE').toUpperCase() === 'VOIDED') {
        throw new Error('Este pago ya fue anulado.');
      }

      await trx.updateTable('payments').set({
        status: 'VOIDED',
        voided_at: sql`NOW()` as unknown as Date,
        voided_by: actorId,
        void_reason: parsed.reason
      }).where('id', '=', parsed.paymentId).execute();

      const totals = await recalculateOrderTotals(trx, Number(payment.order_id), Number(payment.total));

      const activeCashSession = await trx
        .selectFrom('cash_sessions')
        .select(['id'])
        .where('status', '=', 'open')
        .orderBy('id', 'desc')
        .executeTakeFirst();

      if (activeCashSession) {
        await trx.insertInto('cash_movements').values({
          cash_session_id: activeCashSession.id,
          movement_type: 'PAYMENT_VOID_OUT',
          amount: Number(payment.amount),
          notes: `Anulación pago #${parsed.paymentId} orden #${payment.order_id} · ${payment.payment_method_name}${payment.reference ? ` · Ref: ${payment.reference}` : ''}`,
          created_by: actorId
        }).execute();
      }

      await trx.insertInto('audit_logs').values({
        user_id: actorId,
        action: 'PAYMENT_VOID',
        entity_type: 'payment',
        entity_id: String(parsed.paymentId),
        details_json: JSON.stringify({
          paymentId: parsed.paymentId,
          orderId: payment.order_id,
          orderNumber: payment.order_number,
          amount: Number(payment.amount),
          paymentMethodId: payment.payment_method_id,
          paymentMethodName: payment.payment_method_name,
          reference: payment.reference ?? null,
          reason: parsed.reason,
          paidTotalAfter: totals.paidTotal,
          balanceDueAfter: totals.balanceDue,
          actorName
        })
      }).execute();
    });

    const payment = (await list()).find((item) => item.id === parsed.paymentId);
    if (!payment) throw new Error('Pago no encontrado después de anular.');
    return payment;
  };

  return { list, create, createBatch, voidPayment };
};

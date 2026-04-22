import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { BatchPaymentInput, Payment, PaymentInput } from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';
import { checkOrderStatus } from '../orders/security/check-order-status.js';

const schema = z.object({
  orderId: z.number().positive(),
  paymentMethodId: z.number().positive(),
  amount: z.number().positive(),
  reference: z.string().nullable(),
  notes: z.string().nullable().optional()
});

const mapPayment = (row: any): Payment => ({
  id: row.id,
  orderId: row.order_id,
  invoiceId: row.invoice_id,
  paymentMethodId: row.payment_method_id,
  paymentMethodName: row.payment_method_name,
  amount: Number(row.amount),
  reference: row.reference,
  notes: row.notes ?? null,
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
        'p.created_at',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .orderBy('p.id desc');

    if (orderId) {
      query = query.where('p.order_id', '=', orderId);
    }

    return (await query.execute()).map(mapPayment);
  };

  const create = async (input: PaymentInput): Promise<Payment> => {
    const parsed = schema.parse(input);
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();

    const activeCashSession = await db
      .selectFrom('cash_sessions')
      .select('id')
      .where('status', '=', 'open')
      .executeTakeFirst();

    if (!activeCashSession) {
      throw new Error(
        'La caja no está abierta. Dirígete a la sección Caja y ábrela antes de registrar pagos.'
      );
    }

    const order = await db
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
      .executeTakeFirstOrThrow();

    checkOrderStatus(order.status_code, 'registrar pago');

    const newPaidTotal = Number(order.paid_total) + parsed.amount;
    const newBalance = Math.max(0, Number(order.total) - newPaidTotal);

    const result = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('payments')
        .values({
          order_id: parsed.orderId,
          payment_method_id: parsed.paymentMethodId,
          amount: parsed.amount,
          reference: parsed.reference,
          notes: parsed.notes ?? null
        })
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('orders')
        .set({
          paid_total: newPaidTotal,
          balance_due: newBalance
        })
        .where('id', '=', parsed.orderId)
        .execute();

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

          await trx
            .insertInto('order_status_history')
            .values({
              order_id: parsed.orderId,
              status_id: readyForDeliveryStatus.id,
              notes: 'Estado automático: orden pagada completamente'
            })
            .execute();

          await trx
            .insertInto('order_logs')
            .values({
              order_id: parsed.orderId,
              event_type: 'AUTO_STATUS_CHANGE',
              description: `Estado automático a ${readyForDeliveryStatus.name}`
            })
            .execute();

          await trx
            .insertInto('audit_logs')
            .values({
              user_id: actorId,
              action: 'ORDER_AUTO_STATUS_UPDATE',
              entity_type: 'order',
              entity_id: String(parsed.orderId),
              details_json: JSON.stringify({
                orderId: parsed.orderId,
                orderNumber: order.order_number,
                newStatus: readyForDeliveryStatus.name,
                actorName
              })
            })
            .execute();
        }
      }

      const activeCashSession = await trx
        .selectFrom('cash_sessions')
        .selectAll()
        .where('status', '=', 'open')
        .orderBy('id desc')
        .executeTakeFirst();

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId,
          action: 'PAYMENT_CASH_SESSION_CHECK',
          entity_type: 'payment',
          entity_id: String(inserted.insertId),
          details_json: JSON.stringify({
            activeCashSessionFound: Boolean(activeCashSession),
            cashSessionId: activeCashSession?.id ?? null,
            orderId: parsed.orderId,
            orderNumber: order.order_number,
            actorName
          })
        })
        .execute();

      if (activeCashSession) {
        const paymentMethod = await trx
          .selectFrom('payment_methods')
          .select(['name'])
          .where('id', '=', parsed.paymentMethodId)
          .executeTakeFirst();

        await trx
          .insertInto('cash_movements')
          .values({
            cash_session_id: activeCashSession.id,
            movement_type: 'PAYMENT_IN',
            amount: parsed.amount,
            notes: `Pago orden #${parsed.orderId} · ${paymentMethod?.name ?? 'Método desconocido'}${parsed.reference ? ` · Ref: ${parsed.reference}` : ''}`,
            created_by: actorId
          })
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('audit_logs')
          .values({
            user_id: actorId,
            action: 'CASH_MOVEMENT_CREATE',
            entity_type: 'cash_session',
            entity_id: String(activeCashSession.id),
            details_json: JSON.stringify({
              orderId: parsed.orderId,
              orderNumber: order.order_number,
              amount: parsed.amount,
              paymentMethodId: parsed.paymentMethodId,
              paymentMethodName: paymentMethod?.name ?? null,
              actorName
            })
          })
          .execute();
      }

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId,
          action: 'PAYMENT_CREATE',
          entity_type: 'payment',
          entity_id: String(inserted.insertId),
          details_json: JSON.stringify({
            ...parsed,
            orderNumber: order.order_number,
            actorName
          })
        })
        .execute();

      return inserted;
    });

    return (await list(parsed.orderId)).find(
      (payment) => payment.id === Number(result.insertId)
    ) as Payment;
  };

  const createBatch = async (input: BatchPaymentInput): Promise<Payment[]> => {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    if (!input.lines || input.lines.length === 0) {
      throw new Error('Debes ingresar al menos una línea de pago.');
    }

    const activeCashSession = await db
      .selectFrom('cash_sessions')
      .select('id')
      .where('status', '=', 'open')
      .executeTakeFirst();

    if (!activeCashSession) {
      throw new Error(
        'La caja no está abierta. Dirígete a la sección Caja y ábrela antes de registrar pagos.'
      );
    }

    const totalAmount = input.lines.reduce((sum, l) => sum + Number(l.amount || 0), 0);
    if (totalAmount <= 0) {
      throw new Error('El monto total del pago debe ser mayor a 0.');
    }

    const order = await db
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
      .executeTakeFirstOrThrow();

    checkOrderStatus(order.status_code, 'registrar pago');

    const balanceDue = Number(order.balance_due);
    const amountToApply = Math.min(totalAmount, balanceDue);
    const newPaidTotal = Number(order.paid_total) + amountToApply;
    const newBalance = Math.max(0, Number(order.total) - newPaidTotal);

    const insertedIds: number[] = [];

    await db.transaction().execute(async (trx) => {
      const cashSession = await trx
        .selectFrom('cash_sessions')
        .selectAll()
        .where('status', '=', 'open')
        .orderBy('id desc')
        .executeTakeFirstOrThrow();

      // Insert each payment line proportionally applied to the balance
      let remaining = amountToApply;
      for (const line of input.lines) {
        const lineAmount = Math.min(Number(line.amount || 0), remaining);
        if (lineAmount <= 0) continue;
        remaining -= lineAmount;

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
            reference: line.reference,
            notes: input.notes ?? null
          })
          .executeTakeFirstOrThrow();

        insertedIds.push(Number(inserted.insertId));

        await trx
          .insertInto('cash_movements')
          .values({
            cash_session_id: cashSession.id,
            movement_type: 'PAYMENT_IN',
            amount: lineAmount,
            notes: `Pago orden #${input.orderId} · ${paymentMethod?.name ?? 'Método desconocido'}${line.reference ? ` · Ref: ${line.reference}` : ''}`,
            created_by: actorId
          })
          .execute();
      }

      await trx
        .updateTable('orders')
        .set({ paid_total: newPaidTotal, balance_due: newBalance })
        .where('id', '=', input.orderId)
        .execute();

      const currentCode2 = String(order.status_code ?? '').toUpperCase();
      if (newBalance <= 0 && currentCode2 === 'READY') {
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

          await trx
            .insertInto('order_status_history')
            .values({
              order_id: input.orderId,
              status_id: readyForDeliveryStatus.id,
              notes: 'Estado automático: orden pagada completamente'
            })
            .execute();
        }
      }

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId,
          action: 'PAYMENT_BATCH_CREATE',
          entity_type: 'order',
          entity_id: String(input.orderId),
          details_json: JSON.stringify({
            orderId: input.orderId,
            orderNumber: order.order_number,
            totalAmount: amountToApply,
            lines: input.lines,
            actorName
          })
        })
        .execute();
    });

    const allPayments = await list(input.orderId);
    return allPayments.filter((p) => insertedIds.includes(p.id));
  };

  return { list, create, createBatch };
};

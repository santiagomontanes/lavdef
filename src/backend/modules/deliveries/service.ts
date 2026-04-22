import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { DeliveryInput, DeliveryRecord } from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';
import { canReceiveDelivery } from '../orders/security/check-order-status.js';

const schema = z.object({
  orderId: z.number().positive(),
  deliveredTo: z.string().trim().min(3, 'Debes ingresar el nombre de quien recibe.'),
  receiverDocument: z.string().nullable().optional(),
  receiverPhone: z.string().nullable().optional(),
  relationshipToClient: z.string().nullable().optional(),
  receiverSignature: z.string().nullable().optional(),
  ticketCode: z.string().nullable().optional()
});

const mapDelivery = (row: any): DeliveryRecord => ({
  id: row.id,
  orderId: row.order_id,
  deliveredTo: row.delivered_to,
  receiverDocument: row.receiver_document,
  receiverPhone: row.receiver_phone,
  relationshipToClient: row.relationship_to_client,
  receiverSignature: row.receiver_signature,
  outstandingBalance: Number(row.outstanding_balance),
  ticketCode: row.ticket_code,
  createdAt: new Date(row.created_at).toISOString()
});

export const createDeliveriesService = (db: Kysely<Database>) => ({
  async list(): Promise<DeliveryRecord[]> {
    return (
      await db
        .selectFrom('delivery_records')
        .selectAll()
        .orderBy('id desc')
        .execute()
    ).map(mapDelivery);
  },

  async create(input: DeliveryInput): Promise<DeliveryRecord> {
    const parsed = schema.parse(input);
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();

    const order = await db
      .selectFrom('orders as o')
      .innerJoin('order_statuses as s', 's.id', 'o.status_id')
      .select([
        'o.id',
        'o.balance_due',
        sql<string>`s.code`.as('status_code')
      ])
      .where('o.id', '=', parsed.orderId)
      .executeTakeFirstOrThrow();

    if (!canReceiveDelivery(order.status_code)) {
      throw new Error('La orden no está lista para entrega.');
    }

    if (Number(order.balance_due) > 0) {
      throw new Error('No se puede entregar una orden con saldo pendiente.');
    }

    const inserted = await db.transaction().execute(async (trx) => {
      const result = await trx
        .insertInto('delivery_records')
        .values({
          order_id: parsed.orderId,
          delivered_to: parsed.deliveredTo.trim(),
          receiver_document: parsed.receiverDocument?.trim() || null,
          receiver_phone: parsed.receiverPhone?.trim() || null,
          relationship_to_client: parsed.relationshipToClient?.trim() || null,
          receiver_signature: parsed.receiverSignature?.trim() || null,
          outstanding_balance: 0,
          ticket_code: parsed.ticketCode?.trim() || ''
        })
        .executeTakeFirstOrThrow();

      const deliveredStatus = await trx
        .selectFrom('order_statuses')
        .select('id')
        .where('code', '=', 'DELIVERED')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('orders')
        .set({ status_id: deliveredStatus.id })
        .where('id', '=', parsed.orderId)
        .execute();

      await trx
        .insertInto('order_status_history')
        .values({
          order_id: parsed.orderId,
          status_id: deliveredStatus.id,
          notes: 'Orden entregada'
        })
        .execute();

      await trx
        .insertInto('order_logs')
        .values({
          order_id: parsed.orderId,
          event_type: 'DELIVERY',
          description: 'Entrega registrada'
        })
        .execute();

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId,
          action: 'DELIVERY_CREATE',
          entity_type: 'delivery',
          entity_id: String(result.insertId),
          details_json: JSON.stringify({
            ...parsed,
            actorName,
            receiverDocument: parsed.receiverDocument?.trim() || null,
            receiverPhone: parsed.receiverPhone?.trim() || null,
            relationshipToClient: parsed.relationshipToClient?.trim() || null,
            receiverSignature: parsed.receiverSignature?.trim() || null,
            ticketCode: parsed.ticketCode?.trim() || ''
          })
        })
        .execute();

      return result;
    });

    const row = await db
      .selectFrom('delivery_records')
      .selectAll()
      .where('id', '=', Number(inserted.insertId))
      .executeTakeFirstOrThrow();

    return mapDelivery(row);
  }
});

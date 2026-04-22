import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type {
  WarrantyInput,
  WarrantyRecord,
  WarrantyStatus,
  WarrantyUpdateInput
} from '../../../shared/types.js';

const createSchema = z.object({
  orderId: z.number().positive(),
  reason: z.string().trim().min(3)
});

const updateSchema = z.object({
  statusId: z.number().positive(),
  resolution: z.string().nullable()
});

const mapWarranty = (row: any): WarrantyRecord => ({
  id: row.id,
  orderId: row.order_id,
  orderNumber: row.order_number,
  clientName: row.client_name,
  statusId: row.status_id,
  statusCode: row.status_code,
  statusName: row.status_name,
  statusColor: row.status_color,
  reason: row.reason,
  resolution: row.resolution ?? null,
  createdAt: new Date(row.created_at).toISOString()
});

export const createWarrantiesService = (db: Kysely<Database>) => {
  const findOrderStatusByCode = async (code: string) =>
    db
      .selectFrom('order_statuses')
      .select(['id', 'name', 'code'])
      .where('code', '=', code)
      .executeTakeFirst();

  const listStatuses = async (): Promise<WarrantyStatus[]> => {
    const rows = await db
      .selectFrom('warranty_statuses')
      .select(['id', 'code', 'name', 'color'])
      .orderBy('id')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      color: row.color
    }));
  };

  const list = async (): Promise<WarrantyRecord[]> => {
    const rows = await db
      .selectFrom('warranties as w')
      .innerJoin('orders as o', 'o.id', 'w.order_id')
      .innerJoin('clients as c', 'c.id', 'o.client_id')
      .innerJoin('warranty_statuses as ws', 'ws.id', 'w.status_id')
      .select([
        'w.id',
        'w.order_id',
        'w.status_id',
        'w.reason',
        'w.resolution',
        'w.created_at',
        'o.order_number',
        sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
        'ws.code as status_code',
        'ws.name as status_name',
        'ws.color as status_color'
      ])
      .orderBy('w.id desc')
      .execute();

    return rows.map(mapWarranty);
  };

  const create = async (input: WarrantyInput): Promise<WarrantyRecord> => {
    const parsed = createSchema.parse(input);

    const order = await db
      .selectFrom('orders')
      .select(['id', 'order_number'])
      .where('id', '=', parsed.orderId)
      .executeTakeFirst();

    if (!order) {
      throw new Error('Orden no encontrada.');
    }

    const openStatus = await db
      .selectFrom('warranty_statuses')
      .selectAll()
      .where('code', '=', 'OPEN')
      .executeTakeFirst();

    if (!openStatus) {
      throw new Error('No existe el estado OPEN en warranty_statuses.');
    }

    const existingOpen = await db
      .selectFrom('warranties as w')
      .innerJoin('warranty_statuses as ws', 'ws.id', 'w.status_id')
      .select(['w.id'])
      .where('w.order_id', '=', parsed.orderId)
      .where('ws.code', 'not in', ['RESOLVED', 'CLOSED', 'CERRADA', 'RESUELTA'])
      .executeTakeFirst();

    if (existingOpen) {
      throw new Error('Esa orden ya tiene una garantía abierta.');
    }

    const result = await db.transaction().execute(async (trx) => {
      const warrantyOrderStatus = await findOrderStatusByCode('WARRANTY');

      const inserted = await trx
        .insertInto('warranties')
        .values({
          order_id: parsed.orderId,
          status_id: openStatus.id,
          reason: parsed.reason,
          resolution: null
        })
        .executeTakeFirstOrThrow();

      if (warrantyOrderStatus) {
        await trx
          .updateTable('orders')
          .set({ status_id: warrantyOrderStatus.id })
          .where('id', '=', parsed.orderId)
          .execute();

        await trx
          .insertInto('order_status_history')
          .values({
            order_id: parsed.orderId,
            status_id: warrantyOrderStatus.id,
            notes: `Garantía abierta: ${parsed.reason}`
          })
          .execute();

        await trx
          .insertInto('order_logs')
          .values({
            order_id: parsed.orderId,
            event_type: 'STATUS_CHANGE',
            description: `Estado actualizado a ${warrantyOrderStatus.name}`
          })
          .execute();
      }

      await trx
        .insertInto('audit_logs')
        .values({
          action: 'WARRANTY_CREATE',
          entity_type: 'warranty',
          entity_id: String(inserted.insertId),
          details_json: JSON.stringify({
            orderId: parsed.orderId,
            reason: parsed.reason
          })
        })
        .execute();

      return inserted;
    });

    const created = await db
      .selectFrom('warranties as w')
      .innerJoin('orders as o', 'o.id', 'w.order_id')
      .innerJoin('clients as c', 'c.id', 'o.client_id')
      .innerJoin('warranty_statuses as ws', 'ws.id', 'w.status_id')
      .select([
        'w.id',
        'w.order_id',
        'w.status_id',
        'w.reason',
        'w.resolution',
        'w.created_at',
        'o.order_number',
        sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
        'ws.code as status_code',
        'ws.name as status_name',
        'ws.color as status_color'
      ])
      .where('w.id', '=', Number(result.insertId))
      .executeTakeFirstOrThrow();

    return mapWarranty(created);
  };

  const updateStatus = async (
    id: number,
    input: WarrantyUpdateInput
  ): Promise<WarrantyRecord> => {
    const parsed = updateSchema.parse(input);

    const warranty = await db
      .selectFrom('warranties')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!warranty) {
      throw new Error('Garantía no encontrada.');
    }

    const status = await db
      .selectFrom('warranty_statuses')
      .selectAll()
      .where('id', '=', parsed.statusId)
      .executeTakeFirst();

    if (!status) {
      throw new Error('Estado de garantía no encontrado.');
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('warranties')
        .set({
          status_id: parsed.statusId,
          resolution: parsed.resolution ?? null
        })
        .where('id', '=', id)
        .execute();

      await trx
        .insertInto('warranty_status_logs')
        .values({
          warranty_id: id,
          status_id: parsed.statusId,
          notes: parsed.resolution ?? null,
          created_by: null
        })
        .execute();

      const orderIdRow = await trx
        .selectFrom('warranties')
        .select('order_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      const statusCode = String(status.code ?? '').toUpperCase();

      if (statusCode === 'OPEN') {
        const warrantyOrderStatus = await findOrderStatusByCode('WARRANTY');
        if (warrantyOrderStatus) {
          await trx
            .updateTable('orders')
            .set({ status_id: warrantyOrderStatus.id })
            .where('id', '=', orderIdRow.order_id)
            .execute();

          await trx
            .insertInto('order_status_history')
            .values({
              order_id: orderIdRow.order_id,
              status_id: warrantyOrderStatus.id,
              notes: 'Garantía reabierta'
            })
            .execute();
        }
      }

      if (['RESOLVED', 'CLOSED'].includes(statusCode)) {
        const readyOrderStatus = await findOrderStatusByCode('READY_FOR_DELIVERY');
        if (readyOrderStatus) {
          await trx
            .updateTable('orders')
            .set({ status_id: readyOrderStatus.id })
            .where('id', '=', orderIdRow.order_id)
            .execute();

          await trx
            .insertInto('order_status_history')
            .values({
              order_id: orderIdRow.order_id,
              status_id: readyOrderStatus.id,
              notes: 'Garantía cerrada/resuelta'
            })
            .execute();

          await trx
            .insertInto('order_logs')
            .values({
              order_id: orderIdRow.order_id,
              event_type: 'STATUS_CHANGE',
              description: `Estado actualizado a ${readyOrderStatus.name}`
            })
            .execute();
        }
      }

      await trx
        .insertInto('audit_logs')
        .values({
          action: 'WARRANTY_STATUS_UPDATE',
          entity_type: 'warranty',
          entity_id: String(id),
          details_json: JSON.stringify({
            warrantyId: id,
            statusId: parsed.statusId,
            statusCode: status.code,
            resolution: parsed.resolution ?? null
          })
        })
        .execute();
    });

    const updated = await db
      .selectFrom('warranties as w')
      .innerJoin('orders as o', 'o.id', 'w.order_id')
      .innerJoin('clients as c', 'c.id', 'o.client_id')
      .innerJoin('warranty_statuses as ws', 'ws.id', 'w.status_id')
      .select([
        'w.id',
        'w.order_id',
        'w.status_id',
        'w.reason',
        'w.resolution',
        'w.created_at',
        'o.order_number',
        sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
        'ws.code as status_code',
        'ws.name as status_name',
        'ws.color as status_color'
      ])
      .where('w.id', '=', id)
      .executeTakeFirstOrThrow();

    return mapWarranty(updated);
  };

  return {
    list,
    listStatuses,
    create,
    updateStatus
  };
};

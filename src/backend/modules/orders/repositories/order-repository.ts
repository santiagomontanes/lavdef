import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';

const baseOrderSelection = [
  'o.id',
  'o.order_number',
  'o.client_id',
  'o.status_id',
  'o.notes',
  'o.discount_reason',
  'o.subtotal',
  'o.discount_total',
  'o.total',
  'o.paid_total',
  'o.balance_due',
  'o.due_date',
  'o.created_at',
  sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
  sql<string>`s.code`.as('status_code'),
  sql<string>`s.name`.as('status_name'),
  sql<string>`s.color`.as('status_color')
] as const;

export const createOrderRepository = (db: Kysely<Database>) => ({
  list: () => db
    .selectFrom('orders as o')
    .innerJoin('clients as c', 'c.id', 'o.client_id')
    .innerJoin('order_statuses as s', 's.id', 'o.status_id')
    .select(baseOrderSelection)
    .orderBy('o.id desc')
    .execute(),
  findById: (id: number) => db
    .selectFrom('orders as o')
    .innerJoin('clients as c', 'c.id', 'o.client_id')
    .innerJoin('order_statuses as s', 's.id', 'o.status_id')
    .select(baseOrderSelection)
    .where('o.id', '=', id)
    .executeTakeFirst(),
  findItems: (orderId: number) => db.selectFrom('order_items').selectAll().where('order_id', '=', orderId).orderBy('id').execute()
});

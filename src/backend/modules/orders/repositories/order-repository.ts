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
  'o.is_manual',
  'o.manual_order_number',
  'o.manual_order_date',
  sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
  sql<string>`s.code`.as('status_code'),
  sql<string>`s.name`.as('status_name'),
  sql<string>`s.color`.as('status_color')
] as const;

// Mismo orden de prioridad de estados que usaba el frontend
// (STATUS_SORT_PRIORITY en OrdersPage.tsx): trabajo en curso primero,
// entregadas/canceladas al final. Se replica en SQL para que la
// paginación no pierda el orden que el negocio ya conocía.
const STATUS_SORT_CASE = sql`
  CASE s.code
    WHEN 'CREATED' THEN 1
    WHEN 'IN_PROGRESS' THEN 2
    WHEN 'RECEIVED' THEN 3
    WHEN 'READY' THEN 4
    WHEN 'READY_FOR_DELIVERY' THEN 5
    WHEN 'WARRANTY' THEN 6
    WHEN 'DELIVERED' THEN 90
    WHEN 'CANCELLED' THEN 95
    WHEN 'CANCELED' THEN 95
    WHEN 'CANCELADO' THEN 95
    ELSE 50
  END
`;

export type OrdersListPageFilters = {
  status?: number | null;
  search?: string | null;
  limit: number;
  offset: number;
};

export const createOrderRepository = (db: Kysely<Database>) => ({
  list: () => db
    .selectFrom('orders as o')
    .innerJoin('clients as c', 'c.id', 'o.client_id')
    .innerJoin('order_statuses as s', 's.id', 'o.status_id')
    .select(baseOrderSelection)
    .orderBy('o.id', 'desc')
    .execute(),
  findById: (id: number) => db
    .selectFrom('orders as o')
    .innerJoin('clients as c', 'c.id', 'o.client_id')
    .innerJoin('order_statuses as s', 's.id', 'o.status_id')
    .select(baseOrderSelection)
    .where('o.id', '=', id)
    .executeTakeFirst(),
  findByIdempotencyKey: (key: string) => db
    .selectFrom('orders as o')
    .innerJoin('clients as c', 'c.id', 'o.client_id')
    .innerJoin('order_statuses as s', 's.id', 'o.status_id')
    .select(baseOrderSelection)
    .where('o.idempotency_key', '=', key)
    .executeTakeFirst(),
  findItems: (orderId: number) => db.selectFrom('order_items').selectAll().where('order_id', '=', orderId).orderBy('id').execute(),

  // Listado paginado y filtrado en SQL (LIMIT/OFFSET real, sin traer
  // las 800+ órdenes al renderer). El buscador cubre número de orden,
  // número manual, nombre de cliente, teléfono y número de factura.
  // El join a invoices es 1:1 (uk_invoices_order_id, migración 018), por
  // lo que no hace falta GROUP BY para evitar filas duplicadas.
  listPage: async ({ status, search, limit, offset }: OrdersListPageFilters) => {
    const term = String(search ?? '').trim();
    const likeTerm = `%${term}%`;

    const baseFrom = () =>
      db
        .selectFrom('orders as o')
        .innerJoin('clients as c', 'c.id', 'o.client_id')
        .innerJoin('order_statuses as s', 's.id', 'o.status_id')
        .leftJoin('invoices as i', 'i.order_id', 'o.id')
        .$if(status != null, (qb) => qb.where('o.status_id', '=', status as number))
        .$if(Boolean(term), (qb) =>
          qb.where((eb) =>
            eb.or([
              eb('o.order_number', 'like', likeTerm),
              eb('o.manual_order_number', 'like', likeTerm),
              eb('c.phone', 'like', likeTerm),
              eb('i.invoice_number', 'like', likeTerm),
              sql<boolean>`CONCAT(c.first_name, ' ', c.last_name) LIKE ${likeTerm}`
            ])
          )
        );

    const rowsQuery = baseFrom()
      .select(baseOrderSelection)
      .orderBy(STATUS_SORT_CASE)
      .orderBy('o.id', 'desc')
      .limit(limit)
      .offset(offset);

    const countQuery = baseFrom().select(sql<number>`COUNT(*)`.as('count'));

    const [rows, countRow] = await Promise.all([
      rowsQuery.execute(),
      countQuery.executeTakeFirst()
    ]);

    return {
      rows,
      total: Number(countRow?.count ?? 0)
    };
  }
});

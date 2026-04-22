import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type {
  CatalogsPayload,
  DashboardSummary,
  Order,
  OrderDetail,
  OrderInput
} from '../../../shared/types.js';
import { createOrderRepository } from './repositories/order-repository.js';
import { createPaymentsService } from '../payments/service.js';
import { createInvoicesService } from '../invoices/service.js';
import { createDeliveriesService } from '../deliveries/service.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';

const TERMINAL_STATES = new Set(['CANCELLED', 'CANCELED', 'CANCELADO']);

const orderItemSchema = z.object({
  garmentTypeId: z.number().nullable(),
  serviceId: z.number().nullable(),
  description: z.string().trim().min(3),
  quantity: z.number().int().positive(),
  color: z.string().nullable(),
  brand: z.string().nullable(),
  sizeReference: z.string().nullable(),
  material: z.string().nullable(),
  receivedCondition: z.string().nullable(),
  workDetail: z.string().nullable(),
  stains: z.string().nullable(),
  damages: z.string().nullable(),
  missingAccessories: z.string().nullable(),
  customerObservations: z.string().nullable(),
  internalObservations: z.string().nullable(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().int().nonnegative(),
  discountReason: z.string().nullable().optional(),
  surchargeAmount: z.number().int().nonnegative(),
  surchargeReason: z.string().nullable().optional(),
  subtotal: z.number().nonnegative(),
  total: z.number().nonnegative()
});

const paymentLineSchema = z.object({
  paymentMethodId: z.number().positive(),
  amount: z.number().positive(),
  reference: z.string().nullable()
});

const orderSchema = z.object({
  clientId: z.number().positive(),
  notes: z.string().nullable(),
  dueDate: z.string().nullable(),
  discountTotal: z.number().nonnegative(),
  discountReason: z.string().nullable().optional(),
  initialPaymentLines: z.array(paymentLineSchema).default([]),
  items: z.array(orderItemSchema).min(1)
});

const mapOrder = (row: any): Order => ({
  id: row.id,
  orderNumber: row.order_number,
  clientId: row.client_id,
  clientName: row.client_name,
  statusId: row.status_id,
  statusCode: row.status_code ?? '',
  statusName: row.status_name,
  statusColor: row.status_color,
  notes: row.notes,
  discountReason: row.discount_reason ?? null,
  subtotal: Number(row.subtotal),
  discountTotal: Number(row.discount_total),
  total: Number(row.total),
  paidTotal: Number(row.paid_total),
  balanceDue: Number(row.balance_due),
  dueDate: row.due_date ? new Date(row.due_date).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString()
});

export const createOrdersService = (db: Kysely<Database>) => {
  const actorId = () => getCurrentSessionUserId() ?? 1;
  const actorName = () => getCurrentSessionUserName();
  const repository = createOrderRepository(db);
  const paymentsService = createPaymentsService(db);
  const invoicesService = createInvoicesService(db);
  const deliveriesService = createDeliveriesService(db);

  const normalizeItems = async (items: z.infer<typeof orderItemSchema>[]) => {
    const serviceIds = Array.from(
      new Set(
        items
          .map((item) => item.serviceId)
          .filter((serviceId): serviceId is number => Number.isFinite(serviceId))
      )
    );

    const services = serviceIds.length
      ? await db
          .selectFrom('services')
          .select(['id', 'base_price'])
          .where('id', 'in', serviceIds)
          .execute()
      : [];

    const servicePriceMap = new Map(
      services.map((service) => [service.id, Number(service.base_price ?? 0)])
    );

    return items.map((item) => {
      const quantity = Math.max(1, Math.trunc(Number(item.quantity)));
      const unitPrice = item.serviceId
        ? Number(servicePriceMap.get(item.serviceId) ?? item.unitPrice)
        : Number(item.unitPrice);
      const discountAmount = Number(item.discountAmount || 0);
      const surchargeAmount = Number(item.surchargeAmount || 0);
      const subtotal = quantity * unitPrice;
      const total = Math.max(0, subtotal - discountAmount + surchargeAmount);

      return {
        ...item,
        quantity,
        unitPrice,
        discountAmount,
        discountReason: item.discountReason ?? null,
        surchargeAmount,
        surchargeReason: item.surchargeReason ?? null,
        subtotal,
        total
      };
    });
  };

  const detail = async (id: number): Promise<OrderDetail> => {
    const order = await repository.findById(id);
    if (!order) throw new Error('Orden no encontrada.');

    const items = await repository.findItems(id);
    const [payments, invoices, deliveries] = await Promise.all([
      paymentsService.list(id),
      (await invoicesService.list()).filter((invoice) => invoice.orderId === id),
      (await deliveriesService.list()).filter((delivery) => delivery.orderId === id)
    ]);

    return {
      ...mapOrder(order),
      items: items.map((item) => ({
        id: item.id,
        garmentTypeId: item.garment_type_id,
        serviceId: item.service_id,
        description: item.description,
        quantity: Number(item.quantity),
        color: item.color,
        brand: item.brand,
        sizeReference: item.size_reference,
        material: item.material,
        receivedCondition: item.received_condition,
        workDetail: item.work_detail,
        stains: item.stains,
        damages: item.damages,
        missingAccessories: item.missing_accessories,
        customerObservations: item.customer_observations,
        internalObservations: item.internal_observations,
        unitPrice: Number(item.unit_price),
        discountAmount: Number(item.discount_amount ?? 0),
        discountReason: item.discount_reason ?? null,
        surchargeAmount: Number(item.surcharge_amount ?? 0),
        surchargeReason: item.surcharge_reason ?? null,
        subtotal: Number(item.subtotal),
        total: Number(item.total ?? item.subtotal)
      })),
      payments,
      invoices,
      deliveries
    };
  };

  const create = async (input: OrderInput): Promise<OrderDetail> => {
    const parsed = orderSchema.parse(input);
    const normalizedItems = await normalizeItems(parsed.items);

    const subtotal = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const itemsTotal = normalizedItems.reduce((sum, item) => sum + item.total, 0);
    // discountTotal is the sum of per-item discounts already applied inside itemsTotal — don't subtract again
    const total = Math.max(0, itemsTotal);
    const initialLines = (parsed.initialPaymentLines ?? []).filter((l) => l.amount > 0);
    const paidTotal = Math.min(
      initialLines.reduce((s, l) => s + l.amount, 0),
      total
    );

    let orderId = 0;
    let orderNumber = '';

    const doInsert = async () => {
    await db.transaction().execute(async (trx) => {
      // Atomically claim the next order number inside the transaction.
      // GREATEST ensures the counter is always ahead of any migrated or manually
      // inserted rows, preventing duplicates when counters.current_value is stale.
      await sql`
        UPDATE counters
        SET current_value = GREATEST(
          current_value + 1,
          COALESCE(
            (SELECT MAX(CAST(SUBSTRING_INDEX(order_number, '-', -1) AS UNSIGNED)) FROM orders),
            0
          ) + 1
        )
        WHERE counter_key = 'orders'
      `.execute(trx);

      const counter = await trx
        .selectFrom('counters')
        .select(['current_value', 'prefix', 'padding'])
        .where('counter_key', '=', 'orders')
        .executeTakeFirstOrThrow();

      orderNumber = `${counter.prefix}-${String(counter.current_value).padStart(Number(counter.padding), '0')}`;

      const receivedStatus = await trx
        .selectFrom('order_statuses')
        .select('id')
        .where('code', 'in', ['CREATED', 'IN_PROGRESS', 'RECEIVED'])
        .orderBy(
          sql`FIELD(code, 'CREATED', 'IN_PROGRESS', 'RECEIVED')`
        )
        .orderBy('id')
        .executeTakeFirstOrThrow();

      const inserted = await trx
        .insertInto('orders')
        .values({
          order_number: orderNumber,
          client_id: parsed.clientId,
          status_id: receivedStatus.id,
          created_by: actorId(),
          notes: parsed.notes,
          discount_reason: parsed.discountReason ?? null,
          subtotal,
          discount_total: parsed.discountTotal,
          total,
          paid_total: 0,
          balance_due: total,
          due_date: parsed.dueDate ? sql`${parsed.dueDate}` as unknown as Date : null,
          status_changed_at: sql`NOW()` as unknown as Date,
          whatsapp_created_sent: 0,
          whatsapp_ready_sent: 0
        })
        .executeTakeFirstOrThrow();

      orderId = Number(inserted.insertId);

      await trx
        .insertInto('order_items')
        .values(
          normalizedItems.map((item) => ({
            order_id: orderId,
            garment_type_id: item.garmentTypeId,
            service_id: item.serviceId,
            description: item.description,
            quantity: item.quantity,
            color: item.color,
            brand: item.brand,
            size_reference: item.sizeReference,
            material: item.material,
            received_condition: item.receivedCondition,
            work_detail: item.workDetail,
            stains: item.stains,
            damages: item.damages,
            missing_accessories: item.missingAccessories,
            customer_observations: item.customerObservations,
            internal_observations: item.internalObservations,
            unit_price: item.unitPrice,
            discount_amount: item.discountAmount,
            discount_reason: item.discountReason ?? null,
            surcharge_amount: item.surchargeAmount,
            surcharge_reason: item.surchargeReason ?? null,
            subtotal: item.subtotal,
            total: item.total
          }))
        )
        .execute();

      await trx
        .insertInto('order_status_history')
        .values({
          order_id: orderId,
          status_id: receivedStatus.id,
          notes: 'Orden creada'
        })
        .execute();

      await trx
        .insertInto('order_logs')
        .values({
          order_id: orderId,
          event_type: 'CREATE',
          description: 'Orden creada en escritorio'
        })
        .execute();

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId(),
          action: 'ORDER_CREATE',
          entity_type: 'order',
          entity_id: String(orderId),
          details_json: JSON.stringify({ orderNumber, total, actorName: actorName() })
        })
        .execute();
    });
    }; // end doInsert

    // Retry up to 3 times on duplicate order_number (failsafe for edge cases)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await doInsert();
        break;
      } catch (err: any) {
        const isDuplicate =
          err?.code === 'ER_DUP_ENTRY' ||
          String(err?.message ?? '').includes('Duplicate entry') ||
          String(err?.message ?? '').includes('duplicate');
        if (isDuplicate && attempt < 3) continue;
        throw err;
      }
    }

    if (paidTotal > 0 && initialLines.length > 0) {
      await paymentsService.createBatch({
        orderId,
        lines: initialLines,
        notes: 'Abono inicial'
      });
    }

    return detail(orderId);
  };

  const update = async (orderId: number, input: OrderInput): Promise<OrderDetail> => {
    const parsed = orderSchema.parse(input);
    const normalizedItems = await normalizeItems(parsed.items);

    const existingOrder = await db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', orderId)
      .executeTakeFirst();

    if (!existingOrder) {
      throw new Error('Orden no encontrada.');
    }

    const deliveriesCount = await db
      .selectFrom('delivery_records')
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .where('order_id', '=', orderId)
      .executeTakeFirstOrThrow();

    if (Number(deliveriesCount.count ?? 0) > 0) {
      throw new Error('No puedes editar una orden que ya fue entregada.');
    }

    const subtotal = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const itemsTotal = normalizedItems.reduce((sum, item) => sum + item.total, 0);
    // discountTotal is the sum of per-item discounts already applied inside itemsTotal — don't subtract again
    const total = Math.max(0, itemsTotal);
    const paidTotal = Number(existingOrder.paid_total ?? 0);

    if (paidTotal > total) {
      throw new Error('El nuevo total no puede ser menor que lo ya abonado.');
    }

    const balanceDue = Math.max(0, total - paidTotal);

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('orders')
        .set({
          client_id: parsed.clientId,
          notes: parsed.notes,
          discount_reason: parsed.discountReason ?? null,
          subtotal,
          discount_total: parsed.discountTotal,
          total,
          balance_due: balanceDue,
          due_date: parsed.dueDate ? sql`${parsed.dueDate}` as unknown as Date : null
        })
        .where('id', '=', orderId)
        .execute();

      await trx
        .deleteFrom('order_items')
        .where('order_id', '=', orderId)
        .execute();

      await trx
        .insertInto('order_items')
        .values(
          normalizedItems.map((item) => ({
            order_id: orderId,
            garment_type_id: item.garmentTypeId,
            service_id: item.serviceId,
            description: item.description,
            quantity: item.quantity,
            color: item.color,
            brand: item.brand,
            size_reference: item.sizeReference,
            material: item.material,
            received_condition: item.receivedCondition,
            work_detail: item.workDetail,
            stains: item.stains,
            damages: item.damages,
            missing_accessories: item.missingAccessories,
            customer_observations: item.customerObservations,
            internal_observations: item.internalObservations,
            unit_price: item.unitPrice,
            discount_amount: item.discountAmount,
            discount_reason: item.discountReason ?? null,
            surcharge_amount: item.surchargeAmount,
            surcharge_reason: item.surchargeReason ?? null,
            subtotal: item.subtotal,
            total: item.total
          }))
        )
        .execute();

      await trx
        .insertInto('order_logs')
        .values({
          order_id: orderId,
          event_type: 'UPDATE',
          description: 'Orden editada en escritorio'
        })
        .execute();

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId(),
          action: 'ORDER_UPDATE',
          entity_type: 'order',
          entity_id: String(orderId),
          details_json: JSON.stringify({
            orderNumber: existingOrder.order_number,
            clientId: parsed.clientId,
            subtotal,
            discountTotal: parsed.discountTotal,
            total,
            balanceDue,
            actorName: actorName()
          })
        })
        .execute();
    });

    return detail(orderId);
  };

  const cancel = async (orderId: number): Promise<{ success: true }> => {
    const order = await db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', orderId)
      .executeTakeFirst();

    if (!order) {
      throw new Error('Orden no encontrada.');
    }

    const currentStatus = await db
      .selectFrom('order_statuses')
      .select(['code', 'name'])
      .where('id', '=', order.status_id)
      .executeTakeFirst();

    const currentCode = String(currentStatus?.code ?? '').toUpperCase();
    if (currentCode === 'CANCELLED' || currentCode === 'CANCELED' || currentCode === 'CANCELADO') {
      throw new Error('La orden ya está cancelada.');
    }

    if (currentCode === 'DELIVERED' || currentCode === 'ENTREGADO') {
      throw new Error('No puedes cancelar una orden ya entregada.');
    }

    const deliveriesCount = await db
      .selectFrom('delivery_records')
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .where('order_id', '=', orderId)
      .executeTakeFirstOrThrow();

    if (Number(deliveriesCount.count ?? 0) > 0) {
      throw new Error('No puedes cancelar una orden ya entregada.');
    }

    const cancelStatus = await db
      .selectFrom('order_statuses')
      .selectAll()
      .where('code', 'in', ['CANCELLED', 'CANCELED', 'CANCELADO'])
      .orderBy('id')
      .executeTakeFirst();

    if (!cancelStatus) {
      throw new Error('No existe un estado de cancelación configurado.');
    }

    // Get all payments to refund
    const orderPayments = await db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .select([
        'p.id',
        'p.amount',
        sql<string>`pm.name`.as('payment_method_name')
      ])
      .where('p.order_id', '=', orderId)
      .execute();

    const totalPaid = orderPayments.reduce((s, p) => s + Number(p.amount), 0);

    // Get active cash session for refund movements
    const activeCashSession = totalPaid > 0
      ? await db
          .selectFrom('cash_sessions')
          .select('id')
          .where('status', '=', 'open')
          .executeTakeFirst()
      : null;

    if (totalPaid > 0 && !activeCashSession) {
      throw new Error(
        'La orden tiene pagos registrados y la caja está cerrada. Abre caja para registrar la devolución.'
      );
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('orders')
        .set({
          status_id: cancelStatus.id,
          paid_total: 0,
          balance_due: 0
        })
        .where('id', '=', orderId)
        .execute();

      await trx
        .insertInto('order_status_history')
        .values({
          order_id: orderId,
          status_id: cancelStatus.id,
          notes: 'Orden cancelada manualmente'
        })
        .execute();

      await trx
        .insertInto('order_logs')
        .values({
          order_id: orderId,
          event_type: 'CANCEL',
          description: 'Orden cancelada en escritorio'
        })
        .execute();

      // Create PAYMENT_OUT movements for each payment refunded
      if (activeCashSession && orderPayments.length > 0) {
        for (const payment of orderPayments) {
          await trx
            .insertInto('cash_movements')
            .values({
              cash_session_id: activeCashSession.id,
              movement_type: 'PAYMENT_OUT',
              amount: Number(payment.amount),
              notes: `Devolución orden #${orderId} · ${payment.payment_method_name}`,
              created_by: actorId()
            })
            .execute();
        }
      }

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId(),
          action: 'ORDER_CANCEL',
          entity_type: 'order',
          entity_id: String(orderId),
          details_json: JSON.stringify({
            orderId,
            orderNumber: order.order_number,
            statusId: cancelStatus.id,
            statusName: cancelStatus.name,
            refundedTotal: totalPaid,
            cashSessionId: activeCashSession?.id ?? null,
            actorName: actorName()
          })
        })
        .execute();
    });

    return { success: true };
  };

  const updateStatus = async (
    orderId: number,
    statusId: number
  ): Promise<{ success: true }> => {
    const status = await db
      .selectFrom('order_statuses')
      .selectAll()
      .where('id', '=', statusId)
      .executeTakeFirst();

    if (!status) {
      throw new Error('Estado no encontrado.');
    }

    const order = await db
      .selectFrom('orders')
      .innerJoin('order_statuses as os', 'os.id', 'orders.status_id')
      .select([
        'orders.id',
        'orders.order_number',
        'os.code as current_code',
        'os.name as current_name'
      ])
      .where('orders.id', '=', orderId)
      .executeTakeFirst();

    if (!order) {
      throw new Error('Orden no encontrada.');
    }

    const currentCode = String(order.current_code ?? '').toUpperCase();
    const targetCode = String(status.code ?? '').toUpperCase();

    // No permitir cambio al mismo estado
    if (currentCode === targetCode) {
      throw new Error('La orden ya está en ese estado.');
    }

    // Una orden cancelada no puede cambiar nunca más
    if (TERMINAL_STATES.has(currentCode)) {
      throw new Error(`La orden ya está en un estado final (${order.current_name}) y no puede cambiar.`);
    }

    await db.transaction().execute(async (trx) => {
      const statusUpdate: Record<string, unknown> = {
        status_id: statusId,
        status_changed_at: sql`NOW()` as unknown as Date
      };

      if (targetCode === 'READY') {
        statusUpdate.whatsapp_ready_sent = 1;
      }

      await trx
        .updateTable('orders')
        .set(statusUpdate as any)
        .where('id', '=', orderId)
        .execute();

      await trx
        .insertInto('order_status_history')
        .values({
          order_id: orderId,
          status_id: statusId,
          notes: `Cambio manual a ${status.name}`
        })
        .execute();

      await trx
        .insertInto('order_logs')
        .values({
          order_id: orderId,
          event_type: 'STATUS_CHANGE',
          description: `Estado actualizado a ${status.name}`
        })
        .execute();

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId(),
          action: 'ORDER_STATUS_UPDATE',
          entity_type: 'order',
          entity_id: String(orderId),
          details_json: JSON.stringify({
            orderId,
            orderNumber: order.order_number,
            statusId,
            statusCode: status.code,
            statusName: status.name,
            actorName: actorName()
          })
        })
        .execute();

      if (statusId === 7) {
        const existing = await trx
          .selectFrom('warranties')
          .select(['id'])
          .where('order_id', '=', orderId)
          .executeTakeFirst();

        if (!existing) {
          let warrantyStatus = await trx
            .selectFrom('warranty_statuses')
            .select(['id'])
            .where('code', '=', 'OPEN')
            .executeTakeFirst();

          if (!warrantyStatus) {
            const inserted = await trx
              .insertInto('warranty_statuses')
              .values({
                code: 'OPEN',
                name: 'Abierta',
                color: 'amber'
              })
              .executeTakeFirstOrThrow();

            warrantyStatus = { id: Number(inserted.insertId) };
          }

          await trx
            .insertInto('warranties')
            .values({
              order_id: orderId,
              status_id: warrantyStatus.id,
              reason: `Garantía automática orden ${orderId}`,
              resolution: null
            })
            .execute();
        }
      }
    });

    return { success: true };
  };

  const inventorySummary = async () => {
    const activeStatuses = await db
      .selectFrom('order_statuses')
      .select(['id', 'code', 'name', 'color'])
      .where('code', 'in', ['CREATED', 'IN_PROGRESS', 'READY', 'READY_FOR_DELIVERY'])
      .execute();

    const activeStatusIds = activeStatuses.map((s) => Number(s.id));
    if (activeStatusIds.length === 0) {
      return { activeOrdersCount: 0, totalItemsCount: 0, orders: [] };
    }

    const rows = await db
      .selectFrom('orders as o')
      .innerJoin('clients as c', 'c.id', 'o.client_id')
      .innerJoin('order_statuses as s', 's.id', 'o.status_id')
      .select([
        'o.id',
        'o.order_number',
        sql<string>`CONCAT(c.first_name, ' ', c.last_name)`.as('client_name'),
        sql<string>`s.code`.as('status_code'),
        sql<string>`s.name`.as('status_name'),
        sql<string>`s.color`.as('status_color')
      ])
      .where('o.status_id', 'in', activeStatusIds)
      .orderBy('o.id desc')
      .execute();

    const orderIds = rows.map((r) => r.id);
    const allItems = orderIds.length > 0
      ? await db
          .selectFrom('order_items')
          .select(['order_id', 'description', 'quantity'])
          .where('order_id', 'in', orderIds)
          .execute()
      : [];

    const itemsByOrder = new Map<number, Array<{ description: string; quantity: number }>>();
    for (const item of allItems) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push({ description: item.description, quantity: Number(item.quantity) });
      itemsByOrder.set(item.order_id, list);
    }

    const orders = rows.map((row) => {
      const items = itemsByOrder.get(row.id) ?? [];
      return {
        id: row.id,
        orderNumber: row.order_number,
        clientName: String(row.client_name),
        statusCode: String(row.status_code),
        statusName: String(row.status_name),
        statusColor: String(row.status_color),
        items,
        totalItems: items.reduce((sum, i) => sum + i.quantity, 0)
      };
    });

    return {
      activeOrdersCount: orders.length,
      totalItemsCount: orders.reduce((sum, o) => sum + o.totalItems, 0),
      orders
    };
  };

  return {
    async search(term: string, limit = 8): Promise<Order[]> {
      const normalized = String(term ?? '').trim();
      if (!normalized) return [];
      const safeLimit = Math.max(1, Math.min(30, Number(limit) || 8));
      const likeTerm = `%${normalized}%`;

      const rows = await db
        .selectFrom('orders as o')
        .innerJoin('clients as c', 'c.id', 'o.client_id')
        .innerJoin('order_statuses as s', 's.id', 'o.status_id')
        .select([
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
        ])
        .where((eb) =>
          eb.or([
            eb('o.order_number', 'like', likeTerm),
            sql<boolean>`CONCAT(c.first_name, ' ', c.last_name) LIKE ${likeTerm}`
          ])
        )
        .orderBy('o.id desc')
        .limit(safeLimit)
        .execute();

      return rows.map(mapOrder);
    },

    async dashboard(): Promise<DashboardSummary> {
      const [
        clients,
        openOrders,
        dailySales,
        pendingBalance,
        openWarranties,
        dailyExpenses,
        recentOrders,
        paymentBreakdown
      ] = await Promise.all([
        db
          .selectFrom('clients')
          .select((eb) => eb.fn.count<number>('id').as('count'))
          .executeTakeFirstOrThrow(),

        db
          .selectFrom('orders')
          .select((eb) => eb.fn.count<number>('id').as('count'))
          .where('balance_due', '>', 0)
          .executeTakeFirstOrThrow(),

        db
          .selectFrom('payments')
          .select((eb) => eb.fn.sum<number>('amount').as('sum'))
          .where('created_at', '>=', new Date(new Date().toDateString()))
          .executeTakeFirst(),

        db
          .selectFrom('orders')
          .select((eb) => eb.fn.sum<number>('balance_due').as('sum'))
          .executeTakeFirst(),

        db
          .selectFrom('warranties as w')
          .innerJoin('warranty_statuses as ws', 'ws.id', 'w.status_id')
          .select((eb) => eb.fn.count<number>('w.id').as('count'))
          .where('ws.code', '=', 'OPEN')
          .executeTakeFirst(),

        db
          .selectFrom('expenses')
          .select((eb) => eb.fn.sum<number>('amount').as('sum'))
          .where('created_at', '>=', new Date(new Date().toDateString()))
          .executeTakeFirst(),

        repository.list(),

        db
          .selectFrom('payments as p')
          .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
          .select([
            sql<string>`pm.name`.as('method_name'),
            (eb) => eb.fn.sum<number>('p.amount').as('amount')
          ])
          .where('p.created_at', '>=', new Date(new Date().toDateString()))
          .groupBy('pm.name')
          .execute()
      ]);

      return {
        clients: Number(clients.count ?? 0),
        openOrders: Number(openOrders.count ?? 0),
        dailySales: Number(dailySales?.sum ?? 0),
        pendingBalance: Number(pendingBalance?.sum ?? 0),
        openWarranties: Number(openWarranties?.count ?? 0),
        dailyExpenses: Number(dailyExpenses?.sum ?? 0),
        recentOrders: recentOrders
          .sort((a, b) => Number(b.id) - Number(a.id))
          .slice(0, 5)
          .map(mapOrder),
        paymentBreakdown: paymentBreakdown.map((item) => ({
          methodName: item.method_name,
          amount: Number(item.amount ?? 0)
        }))
      };
    },

    async catalogs(): Promise<CatalogsPayload> {
      const [statuses, paymentMethods, services] = await Promise.all([
        db
          .selectFrom('order_statuses')
          .select(['id', 'code', 'name', 'color'])
          .orderBy('id')
          .execute(),

        db
          .selectFrom('payment_methods')
          .select(['id', 'code', 'name'])
          .where('is_active', '=', 1)
          .orderBy('id')
          .execute(),

        db
          .selectFrom('services')
          .select(['id', 'category_id', 'name', 'base_price', 'is_active'])
          .where('is_active', '=', 1)
          .orderBy('name')
          .execute()
      ]);

      return {
        statuses,
        paymentMethods,
        services: services.map((service) => ({
          id: service.id,
          categoryId: service.category_id ?? null,
          name: service.name,
          basePrice: Number(service.base_price ?? 0),
          isActive: Boolean(service.is_active)
        }))
      };
    },

    async list(): Promise<Order[]> {
      return (await repository.list()).map(mapOrder);
    },

    detail,
    create,
    update,
    cancel,
    updateStatus,
    inventorySummary
  };
};

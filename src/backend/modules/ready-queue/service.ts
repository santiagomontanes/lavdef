import { sql, type Kysely, type SqlBool } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { ReadyQueueItem, ReadyQueueStats, MessageQueueItem } from '../../../shared/types.js';

const AUTO_PROCESS_HOURS = 2;

const safeDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const normalizePhone = (raw?: string | null): string => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  if (digits.length > 10 && !digits.startsWith('57')) return `57${digits.slice(-10)}`;
  return digits;
};

const money = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

export const createReadyQueueService = (db: Kysely<Database>) => {
  const todayColombia = (): string =>
    new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const buildWhatsAppMessage = (params: {
    clientName: string;
    orderNumber: string;
    dueDate: string | null;
    total: number;
    balanceDue: number;
    items: Array<{ description: string; quantity: number }>;
    companyName: string;
  }): string => {
    const dateStr = params.dueDate
      ? new Date(params.dueDate + 'T12:00:00').toLocaleDateString('es-CO')
      : 'Sin definir';
    const itemsText = params.items.length
      ? params.items.map((i) => `- ${i.description} - Cant: ${i.quantity}`).join('\n')
      : '- Sin ítems';

    return (
      `👔 *${params.companyName}*\n\n` +
      `Hola ${params.clientName}, nos complace informarte que tus prendas ya están listas para recoger.\n\n` +
      `📋 *Orden:* ${params.orderNumber}\n` +
      `📆 *Fecha prometida de entrega:* ${dateStr}\n\n` +
      `🧺 *Detalle de tu orden:*\n${itemsText}\n\n` +
      `💰 *Total:* ${money(params.total)}\n` +
      `💳 *Saldo pendiente:* ${money(params.balanceDue)}\n\n` +
      `📍 Te esperamos en nuestra tienda en el horario de atención.\n\n` +
      `¡Gracias por confiar en nosotros!`
    );
  };

  return {
    async createQueueForToday(): Promise<number> {
      const today = todayColombia();

      const [statuses, companyRow] = await Promise.all([
        db.selectFrom('order_statuses').select(['id', 'code']).execute(),
        db.selectFrom('company_settings').select('company_name').executeTakeFirst()
      ]);

      const companyName = String(companyRow?.company_name ?? 'Lavandería');
      const statusMap = new Map(statuses.map((s) => [String(s.code).toUpperCase(), Number(s.id)]));
      const readyId = statusMap.get('READY');
      const readyForDeliveryId = statusMap.get('READY_FOR_DELIVERY');

      if (!readyId) return 0;

      const eligibleStatusIds = [readyId, ...(readyForDeliveryId ? [readyForDeliveryId] : [])];

      const orders = await db
        .selectFrom('orders')
        .innerJoin('clients', 'clients.id', 'orders.client_id')
        .select([
          'orders.id',
          'orders.order_number',
          'orders.due_date',
          'orders.total',
          'orders.balance_due',
          'orders.client_id',
          sql<string>`CONCAT(clients.first_name, ' ', clients.last_name)`.as('client_name'),
          'clients.phone'
        ])
        .where('orders.status_id', 'in', eligibleStatusIds)
        .where(sql<SqlBool>`DATE(COALESCE(orders.due_date, CURDATE())) <= DATE(CONVERT_TZ(NOW(), '+00:00', '-05:00'))`)
        .execute();

      let inserted = 0;
      for (const order of orders) {
        const existing = await db
          .selectFrom('ready_queue')
          .select('id')
          .where('order_id', '=', order.id)
          .where('queue_date', '=', sql`${today}` as unknown as Date)
          .executeTakeFirst();

        if (existing) continue;

        const autoProcessAfter = new Date(Date.now() - 5 * 60 * 60 * 1000);
        autoProcessAfter.setHours(autoProcessAfter.getHours() + AUTO_PROCESS_HOURS);
        const autoAfterStr = autoProcessAfter.toISOString().slice(0, 19).replace('T', ' ');

        const phone = normalizePhone(order.phone);
        const items = await db
          .selectFrom('order_items')
          .select(['description', 'quantity'])
          .where('order_id', '=', order.id)
          .execute();

        const messageText = buildWhatsAppMessage({
          clientName: String(order.client_name),
          orderNumber: order.order_number,
          dueDate: safeDate(order.due_date),
          total: Number(order.total),
          balanceDue: Number(order.balance_due),
          items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity) })),
          companyName
        });

        await db
          .insertInto('ready_queue')
          .values({
            order_id: order.id,
            queue_date: sql`${today}` as unknown as Date,
            status: 'PENDING',
            auto_process_after: sql`${autoAfterStr}` as unknown as Date
          })
          .execute();

        if (phone) {
          await db
            .insertInto('message_queue')
            .values({
              order_id: order.id,
              client_id: order.client_id,
              phone,
              message_text: messageText,
              trigger_type: 'AUTO',
              status: 'PENDING',
              scheduled_at: sql`${autoAfterStr}` as unknown as Date
            })
            .execute();
        }

        inserted++;
      }

      return inserted;
    },

    async listPending(): Promise<ReadyQueueItem[]> {
      const today = todayColombia();

      const rows = await db
        .selectFrom('ready_queue')
        .innerJoin('orders', 'orders.id', 'ready_queue.order_id')
        .innerJoin('clients', 'clients.id', 'orders.client_id')
        .innerJoin('order_statuses', 'order_statuses.id', 'orders.status_id')
        .select([
          'ready_queue.id',
          'ready_queue.order_id',
          'ready_queue.queue_date',
          'ready_queue.status',
          'ready_queue.auto_process_after',
          'ready_queue.checked_at',
          'ready_queue.notes',
          'ready_queue.created_at',
          'orders.order_number',
          'orders.due_date',
          'orders.balance_due',
          'orders.total',
          'clients.phone',
          'order_statuses.code as status_code',
          'order_statuses.name as status_name',
          'order_statuses.color as status_color',
          sql<string>`CONCAT(clients.first_name, ' ', clients.last_name)`.as('client_name'),
          sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = orders.id)`.as('item_count')
        ])
        .where('ready_queue.queue_date', '=', sql`${today}` as unknown as Date)
        .where('ready_queue.status', 'in', ['PENDING', 'CONFIRMED_READY'])
        .orderBy('ready_queue.created_at', 'asc')
        .execute();

      return rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        orderNumber: r.order_number,
        clientName: String(r.client_name),
        clientPhone: r.phone ?? null,
        queueDate: String(r.queue_date).slice(0, 10),
        status: r.status as ReadyQueueItem['status'],
        autoProcessAfter: r.auto_process_after ? String(r.auto_process_after) : null,
        checkedAt: r.checked_at ? String(r.checked_at) : null,
        notes: r.notes ?? null,
        dueDate: safeDate(r.due_date),
        balanceDue: Number(r.balance_due),
        total: Number(r.total),
        currentStatusCode: String((r as any).status_code),
        currentStatusName: String((r as any).status_name),
        currentStatusColor: String((r as any).status_color),
        itemCount: Number(r.item_count),
        createdAt: String(r.created_at)
      }));
    },

    async getStats(): Promise<ReadyQueueStats> {
      const today = todayColombia();

      const rows = await db
        .selectFrom('ready_queue')
        .select([
          'status',
          sql<number>`COUNT(*)`.as('count')
        ])
        .where('queue_date', '=', sql`${today}` as unknown as Date)
        .groupBy('status')
        .execute();

      const map = new Map(rows.map((r) => [r.status, Number(r.count)]));
      return {
        pendingCount: map.get('PENDING') ?? 0,
        confirmedTodayCount: map.get('CONFIRMED_READY') ?? 0,
        autoProcessedTodayCount: map.get('AUTO_PROCESSED') ?? 0,
        totalTodayCount: rows.reduce((s, r) => s + Number(r.count), 0)
      };
    },

    async confirmReady(queueId: number, checkedBy: number): Promise<void> {
      await db
        .updateTable('ready_queue')
        .set({
          status: 'CONFIRMED_READY',
          checked_at: sql`NOW()` as unknown as Date,
          checked_by: checkedBy
        })
        .where('id', '=', queueId)
        .execute();
    },

    async rescheduleOrder(queueId: number, newDueDate: string): Promise<void> {
      const row = await db
        .selectFrom('ready_queue')
        .select('order_id')
        .where('id', '=', queueId)
        .executeTakeFirst();

      if (!row) throw new Error('Entrada de cola no encontrada');

      await db
        .updateTable('orders')
        .set({ due_date: sql`${newDueDate}` as unknown as Date })
        .where('id', '=', row.order_id)
        .execute();

      await db
        .updateTable('ready_queue')
        .set({ status: 'RESCHEDULED' })
        .where('id', '=', queueId)
        .execute();

      await db
        .updateTable('message_queue')
        .set({ status: 'CANCELLED' })
        .where('order_id', '=', row.order_id)
        .where('status', '=', 'PENDING')
        .execute();
    },

    async skipEntry(queueId: number, notes?: string): Promise<void> {
      await db
        .updateTable('ready_queue')
        .set({
          status: 'SKIPPED',
          notes: notes ?? null
        })
        .where('id', '=', queueId)
        .execute();
    },

    async autoProcessPending(): Promise<number> {
      const today = todayColombia();
      const nowStr = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

      const due = await db
        .selectFrom('ready_queue')
        .select(['id', 'order_id'])
        .where('queue_date', '=', sql`${today}` as unknown as Date)
        .where('status', '=', 'PENDING')
        .where(sql<SqlBool>`auto_process_after IS NOT NULL AND auto_process_after <= ${nowStr}`)
        .execute();

      for (const row of due) {
        await db
          .updateTable('ready_queue')
          .set({ status: 'AUTO_PROCESSED' })
          .where('id', '=', row.id)
          .execute();

        await db
          .updateTable('message_queue')
          .set({ status: 'PENDING', trigger_type: 'AUTO' })
          .where('order_id', '=', row.order_id)
          .where('status', '=', 'PENDING')
          .execute();
      }

      return due.length;
    },

    async listMessageQueue(date?: string): Promise<MessageQueueItem[]> {
      const targetDate = date ?? todayColombia();

      const rows = await db
        .selectFrom('message_queue')
        .innerJoin('orders', 'orders.id', 'message_queue.order_id')
        .innerJoin('clients', 'clients.id', 'message_queue.client_id')
        .select([
          'message_queue.id',
          'message_queue.order_id',
          'message_queue.phone',
          'message_queue.message_text',
          'message_queue.trigger_type',
          'message_queue.status',
          'message_queue.scheduled_at',
          'message_queue.sent_at',
          'message_queue.error_message',
          'message_queue.created_at',
          'orders.order_number',
          sql<string>`CONCAT(clients.first_name, ' ', clients.last_name)`.as('client_name')
        ])
        .where(sql<SqlBool>`DATE(message_queue.created_at) = ${targetDate}`)
        .orderBy('message_queue.created_at', 'desc')
        .execute();

      return rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        orderNumber: r.order_number,
        clientName: String(r.client_name),
        phone: r.phone,
        messageText: r.message_text,
        triggerType: r.trigger_type as MessageQueueItem['triggerType'],
        status: r.status as MessageQueueItem['status'],
        scheduledAt: r.scheduled_at ? String(r.scheduled_at) : null,
        sentAt: r.sent_at ? String(r.sent_at) : null,
        errorMessage: r.error_message ?? null,
        createdAt: String(r.created_at)
      }));
    },

    async markMessageSent(messageId: number): Promise<void> {
      await db
        .updateTable('message_queue')
        .set({ status: 'SENT', sent_at: sql`NOW()` as unknown as Date })
        .where('id', '=', messageId)
        .execute();
    },

    async markMessageFailed(messageId: number, errorMessage: string): Promise<void> {
      await db
        .updateTable('message_queue')
        .set({ status: 'FAILED', error_message: errorMessage })
        .where('id', '=', messageId)
        .execute();
    },

    async confirmAndMakeReady(queueId: number, checkedBy: number): Promise<{ whatsappUrl: string | null }> {
      const [statuses, companyRow] = await Promise.all([
        db.selectFrom('order_statuses').select(['id', 'code']).execute(),
        db.selectFrom('company_settings').select('company_name').executeTakeFirst()
      ]);
      const statusMap = new Map(statuses.map((s) => [String(s.code).toUpperCase(), Number(s.id)]));
      const readyId = statusMap.get('READY');
      if (!readyId) throw new Error('Estado READY no encontrado');

      const companyName = String(companyRow?.company_name ?? 'Lavandería');

      const queueRow = await db
        .selectFrom('ready_queue')
        .select('order_id')
        .where('id', '=', queueId)
        .executeTakeFirst();
      if (!queueRow) throw new Error('Entrada de cola no encontrada');

      const order = await db
        .selectFrom('orders')
        .innerJoin('clients', 'clients.id', 'orders.client_id')
        .select([
          'orders.id',
          'orders.order_number',
          'orders.due_date',
          'orders.total',
          'orders.paid_total',
          'orders.balance_due',
          'clients.phone',
          sql<string>`CONCAT(clients.first_name, ' ', clients.last_name)`.as('client_name')
        ])
        .where('orders.id', '=', queueRow.order_id)
        .executeTakeFirst();
      if (!order) throw new Error('Orden no encontrada');

      await db
        .updateTable('orders')
        .set({ status_id: readyId, status_changed_at: sql`NOW()` as unknown as Date, whatsapp_ready_sent: 1 })
        .where('id', '=', queueRow.order_id)
        .execute();

      await db
        .updateTable('ready_queue')
        .set({ status: 'CONFIRMED_READY', checked_at: sql`NOW()` as unknown as Date, checked_by: checkedBy })
        .where('id', '=', queueId)
        .execute();

      const phone = normalizePhone(order.phone);
      if (!phone) return { whatsappUrl: null };

      const items = await db
        .selectFrom('order_items')
        .select(['description', 'quantity'])
        .where('order_id', '=', queueRow.order_id)
        .execute();

      const dueDate = safeDate(order.due_date);
      const message = buildWhatsAppMessage({
        clientName: String(order.client_name),
        orderNumber: order.order_number,
        dueDate,
        total: Number(order.total),
        balanceDue: Number(order.balance_due),
        items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity) })),
        companyName
      });

      return { whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` };
    }
  };
};

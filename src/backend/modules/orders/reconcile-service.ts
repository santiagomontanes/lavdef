import { sql, type Kysely, type SqlBool } from 'kysely';
import type { Database } from '../../db/schema.js';

const AUTO_READY_BY_DUE_DATE_KEY = 'auto_ready_by_due_date_enabled';

export type ReadyOrderForWhatsApp = {
  orderId: number;
  orderNumber: string;
  clientName: string;
  phone: string;
  dueDate: string | null;
  total: number;
  paidTotal: number;
  balanceDue: number;
  items: Array<{ description: string; quantity: number }>;
};

export type DueTomorrowOrder = {
  orderId: number;
  orderNumber: string;
  clientName: string;
  dueDate: string;
  clientPhone: string | null;
};

export type PendingReadyCheck = {
  queueId: number;
  orderId: number;
  orderNumber: string;
  clientName: string;
  dueDate: string | null;
};

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

export const buildReadyWhatsAppUrl = (order: ReadyOrderForWhatsApp, companyName: string): string => {
  const dateStr = order.dueDate
    ? new Date(order.dueDate).toLocaleDateString('es-CO')
    : 'Sin definir';

  const itemsText = order.items.length
    ? order.items.map((i) => `- ${i.description} - Cant: ${i.quantity}`).join('\n')
    : '- Sin ítems';

  const message =
    `👔 *${companyName}*\n\n` +
    `Hola ${order.clientName}, nos complace informarte que tus prendas ya están listas para recoger.\n\n` +
    `📋 *Orden:* ${order.orderNumber}\n` +
    `📆 *Fecha prometida de entrega:* ${dateStr}\n\n` +
    `🧺 *Detalle de tu orden:*\n${itemsText}\n\n` +
    `💰 *Total:* ${money(order.total)}\n` +
    `💳 *Abono realizado:* ${money(order.paidTotal)}\n` +
    `🔖 *Saldo pendiente:* ${money(order.balanceDue)}\n\n` +
    `📍 Te esperamos en nuestra tienda en el horario de atención.\n\n` +
    `¡Gracias por confiar en nosotros!`;

  return `https://wa.me/${order.phone}?text=${encodeURIComponent(message)}`;
};

export const reconcileOrderStates = async (
  db: Kysely<Database>
): Promise<{
  readyOrders: ReadyOrderForWhatsApp[];
  dueTomorrow: DueTomorrowOrder[];
  companyName: string;
  pendingReadyChecks: PendingReadyCheck[];
  autoProcessedCount: number;
}> => {
  const readyOrders: ReadyOrderForWhatsApp[] = [];
  const dueTomorrow: DueTomorrowOrder[] = [];
  const pendingReadyChecks: PendingReadyCheck[] = [];
  let autoProcessedCount = 0;

  const [statuses, companyRow, automationSetting] = await Promise.all([
    db.selectFrom('order_statuses').select(['id', 'code']).execute(),
    db.selectFrom('company_settings').select('company_name').executeTakeFirst(),
    db
      .selectFrom('app_settings')
      .select(['setting_value'])
      .where('setting_key', '=', AUTO_READY_BY_DUE_DATE_KEY)
      .orderBy('id desc')
      .executeTakeFirst()
  ]);

  const companyName = String(companyRow?.company_name ?? 'Lavandería');
  const autoReadyByDueDateEnabled =
    !automationSetting ||
    !['0', 'false'].includes(String(automationSetting.setting_value ?? '').trim().toLowerCase());
  const statusMap = new Map(statuses.map((s) => [String(s.code).toUpperCase(), Number(s.id)]));

  const createdId = statusMap.get('CREATED');
  const inProgressId = statusMap.get('IN_PROGRESS');
  const readyId = statusMap.get('READY');
  const readyForDeliveryId = statusMap.get('READY_FOR_DELIVERY');

  // CREATED → IN_PROGRESS after 10 seconds
  if (createdId && inProgressId) {
    const rows = await db
      .selectFrom('orders')
      .select('id')
      .where('status_id', '=', createdId)
      .where(sql<SqlBool>`COALESCE(status_changed_at, created_at) <= NOW() - INTERVAL 10 SECOND`)
      .execute();

    for (const row of rows) {
      await db
        .updateTable('orders')
        .set({ status_id: inProgressId, status_changed_at: sql`NOW()` as unknown as Date })
        .where('id', '=', row.id)
        .execute();
    }
  }

  // IN_PROGRESS with due_date arrived → queue for user verification (NOT auto-change to READY)
  if (inProgressId && readyId) {
    const todayStr = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const dueRows = await db
      .selectFrom('orders')
      .innerJoin('clients', 'clients.id', 'orders.client_id')
      .select([
        'orders.id',
        'orders.order_number',
        'orders.due_date',
        'orders.total',
        'orders.paid_total',
        'orders.balance_due',
        'orders.client_id',
        'orders.whatsapp_ready_sent',
        sql<string>`CONCAT(clients.first_name, ' ', clients.last_name)`.as('client_name'),
        'clients.phone'
      ])
      .where('orders.status_id', '=', inProgressId)
      .where('orders.due_date', 'is not', null)
      .where(sql<SqlBool>`DATE(orders.due_date) <= DATE(CONVERT_TZ(NOW(), '+00:00', '-05:00'))`)
      .execute();

    for (const row of dueRows) {
      const existing = await db
        .selectFrom('ready_queue')
        .select(['id', 'status'])
        .where('order_id', '=', row.id)
        .where(sql<SqlBool>`DATE(queue_date) = ${todayStr}`)
        .executeTakeFirst();

      if (!existing) {
        const insertResult = await db
          .insertInto('ready_queue')
          .values({
            order_id: row.id,
            queue_date: sql`${todayStr}` as unknown as Date,
            status: 'PENDING',
            auto_process_after: sql`NOW() + INTERVAL 30 SECOND` as unknown as Date
          })
          .executeTakeFirst();

        const queueId = Number(insertResult?.insertId ?? 0);
        pendingReadyChecks.push({
          queueId,
          orderId: row.id,
          orderNumber: row.order_number,
          clientName: String(row.client_name),
          dueDate: safeDate(row.due_date)
        });
      } else if (existing.status === 'PENDING') {
        pendingReadyChecks.push({
          queueId: existing.id,
          orderId: row.id,
          orderNumber: row.order_number,
          clientName: String(row.client_name),
          dueDate: safeDate(row.due_date)
        });
      }
    }

    // Auto-process expired PENDING entries (still IN_PROGRESS after 5 min)
    if (autoReadyByDueDateEnabled) {
      const expiredRows = await db
        .selectFrom('ready_queue')
        .innerJoin('orders', 'orders.id', 'ready_queue.order_id')
        .innerJoin('clients', 'clients.id', 'orders.client_id')
        .select([
          'ready_queue.id as queue_id',
          'orders.id',
          'orders.order_number',
          'orders.due_date',
          'orders.total',
          'orders.paid_total',
          'orders.balance_due',
          'orders.whatsapp_ready_sent',
          sql<string>`CONCAT(clients.first_name, ' ', clients.last_name)`.as('client_name'),
          'clients.phone'
        ])
        .where('ready_queue.status', '=', 'PENDING')
        .where('orders.status_id', '=', inProgressId)
        .where(sql<SqlBool>`ready_queue.auto_process_after IS NOT NULL AND ready_queue.auto_process_after <= NOW()`)
        .execute();

      for (const row of expiredRows) {
        await db
          .updateTable('orders')
          .set({ status_id: readyId, status_changed_at: sql`NOW()` as unknown as Date })
          .where('id', '=', row.id)
          .execute();

        await db
          .updateTable('ready_queue')
          .set({ status: 'AUTO_PROCESSED' })
          .where('id', '=', (row as any).queue_id)
          .execute();

        autoProcessedCount++;
      }
    }
  }

  // READY → READY_FOR_DELIVERY when balance is paid
  if (readyId && readyForDeliveryId) {
    await db
      .updateTable('orders')
      .set({ status_id: readyForDeliveryId, status_changed_at: sql`NOW()` as unknown as Date })
      .where('status_id', '=', readyId)
      .where('balance_due', '<=', 0)
      .execute();
  }

  // Day-before notifications: IN_PROGRESS orders due tomorrow
  if (inProgressId) {
    const tomorrowRows = await db
      .selectFrom('orders')
      .innerJoin('clients', 'clients.id', 'orders.client_id')
      .select([
        'orders.id',
        'orders.order_number',
        'orders.due_date',
        'clients.phone',
        sql<string>`CONCAT(clients.first_name, ' ', clients.last_name)`.as('client_name')
      ])
      .where('orders.status_id', '=', inProgressId)
      .where('orders.due_date', 'is not', null)
      .where(sql<SqlBool>`DATE(orders.due_date) = DATE(CONVERT_TZ(NOW(), '+00:00', '-05:00')) + INTERVAL 1 DAY`)
      .execute();

    for (const row of tomorrowRows) {
      dueTomorrow.push({
        orderId: row.id,
        orderNumber: row.order_number,
        clientName: String(row.client_name),
        dueDate: safeDate(row.due_date) ?? '',
        clientPhone: normalizePhone(row.phone || '') || null
      });
    }
  }

  return { readyOrders, dueTomorrow, companyName, pendingReadyChecks, autoProcessedCount };
};

import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Invoice, InvoiceDetail } from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';
import { diagnosticLogger } from '../../../main/services/diagnostic-logger.js';

const buildTicketCode = (orderNumber: string) => `TK-${orderNumber}`;
const INVOICE_SHOW_ALL_ACTIVE_ORDERS_KEY = 'invoice_show_all_active_orders';

const buildWhatsappMessage = (invoice: {
  invoiceNumber: string;
  clientName: string;
  dueDate: string | null;
  notes: string | null;
  legalText: string | null;
  companyPolicies: string | null;
  total: number;
  paidTotal: number;
  balanceDue: number;
  ticketCode: string;
  companyName: string | null;
  items: Array<any>;
  activeOrders?: Array<{
    orderNumber: string;
    dueDate: string | null;
    itemsCount: number;
  }>;
  showAllActiveOrders?: boolean;
}) => {
  const formatMoney = (value: number) =>
    `$${Number(value ?? 0).toLocaleString('es-CO')}`;

  const itemsText = invoice.items
    .map((item, index) => {
      const observations = String(item.customerObservations ?? '').trim();

      return [
        `${index + 1}. ${item.description}`,
        `   Cant: ${item.quantity} | Unit: ${formatMoney(item.unitPrice)} | Total: ${formatMoney(
          item.total
        )}`,
        observations ? `   Obs: ${observations}` : null
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const lines = [
    `Hola ${invoice.clientName},`,
    '',
    `${invoice.companyName ?? 'Nuestro negocio'} te comparte tu factura:`,
    `Factura: ${invoice.invoiceNumber}`,
    invoice.dueDate
      ? `Fecha promesa: ${new Date(invoice.dueDate).toLocaleDateString('es-CO')}`
      : null,
    '',
    '*DETALLE DE PRENDAS*',
    itemsText || 'Sin ítems registrados.',
    '',
    '*RESUMEN*',
    `Total: ${formatMoney(invoice.total)}`,
    `Abonado: ${formatMoney(invoice.paidTotal)}`,
    `Saldo: ${formatMoney(invoice.balanceDue)}`,
    `Ticket: ${invoice.ticketCode}`,
    invoice.notes ? `Notas: ${invoice.notes}` : null,
    invoice.activeOrders && invoice.activeOrders.length > 0
      ? invoice.showAllActiveOrders
        ? [
            '',
            '*ÓRDENES ACTIVAS DEL CLIENTE*',
            ...invoice.activeOrders.map(
              (order, index) =>
                `${index + 1}. ${order.orderNumber} | Fecha promesa: ${order.dueDate ? new Date(order.dueDate).toLocaleDateString('es-CO') : 'Sin definir'} | Ítems: ${order.itemsCount}`
            )
          ].join('\n')
        : [
            '',
            '*ÓRDENES ACTIVAS DEL CLIENTE*',
            `Pendientes por reclamar: ${invoice.activeOrders.length}`,
            `Prendas por recoger: ${invoice.activeOrders.reduce((sum, order) => sum + Number(order.itemsCount ?? 0), 0)}`
          ].join('\n')
      : null,
    invoice.companyPolicies ? `Políticas: ${invoice.companyPolicies}` : null
  ].filter(Boolean);

  return lines.join('\n');
};

const mapInvoice = (row: any): Invoice => ({
  id: row.id,
  invoiceNumber: row.invoice_number,
  orderId: row.order_id,
  orderNumber: row.order_number,
  clientId: row.client_id,
  clientCode: row.client_code ?? null,
  clientName: row.client_name,
  clientPhone: row.client_phone ?? null,
  clientAddress: row.client_address ?? null,
  subtotal: Number(row.subtotal),
  taxTotal: Number(row.tax_total),
  total: Number(row.total),
  legalText: row.legal_text,
  dueDate: row.due_date ? new Date(row.due_date).toISOString() : null,
  notes: row.order_notes ?? null,
  paidTotal: Number(row.paid_total ?? 0),
  balanceDue: Number(row.balance_due ?? 0),
  statusCode: row.status_code ?? null,
  statusName: row.status_name ?? null,
  isManual: Boolean(row.is_manual),
  manualOrderNumber: row.manual_order_number ?? null,
  manualOrderDate: row.manual_order_date
    ? new Date(row.manual_order_date).toISOString().slice(0, 10)
    : null,
  ticketCode: row.ticket_code,
  companyName: row.company_name ?? null,
  companyLegalName: row.company_legal_name ?? null,
  companyPhone: row.company_phone ?? null,
  companyEmail: row.company_email ?? null,
  companyAddress: row.company_address ?? null,
  companyNit: row.company_nit ?? null,
  companyLogo: row.company_logo ?? null,
  companyPolicies: row.company_policies ?? null,
  createdAt: new Date(row.created_at).toISOString()
});

export const createInvoicesService = (db: Kysely<Database>) => {
  let invoiceItemColumnsCache: Set<string> | null = null;

  const getInvoiceShowAllActiveOrdersEnabled = async () => {
    const setting = await db
      .selectFrom('app_settings')
      .select(['setting_value'])
      .where('setting_key', '=', INVOICE_SHOW_ALL_ACTIVE_ORDERS_KEY)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    if (!setting) return true;

    const normalized = String(setting.setting_value ?? '').trim().toLowerCase();
    return normalized !== '0' && normalized !== 'false';
  };

  const getInvoiceItemColumns = async () => {
    if (invoiceItemColumnsCache) return invoiceItemColumnsCache;

    const rows = await sql<{ column_name: string }>`
      SELECT COLUMN_NAME AS column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'invoice_items_snapshot'
    `.execute(db);

    invoiceItemColumnsCache = new Set(
      rows.rows.map((row) => String(row.column_name))
    );

    // Producción: si faltan las columnas críticas (customer_observations,
    // internal_observations), la migración 021 no se aplicó y las
    // observaciones nunca se guardarán al snapshot. Logueamos para que el
    // soporte pueda confirmarlo desde el log del cliente sin consultar BD.
    const missingCritical = [
      'customer_observations',
      'internal_observations'
    ].filter((col) => !invoiceItemColumnsCache!.has(col));

    if (missingCritical.length > 0) {
      diagnosticLogger.error('invoices.snapshot', 'Faltan columnas críticas en invoice_items_snapshot', {
        missing: missingCritical,
        availableColumns: Array.from(invoiceItemColumnsCache)
      });
    } else {
      diagnosticLogger.info('invoices.snapshot', 'invoice_items_snapshot tiene columnas críticas', {
        columnsCount: invoiceItemColumnsCache.size
      });
    }

    return invoiceItemColumnsCache;
  };

  const buildInvoiceItemSnapshotValues = async (
    invoiceId: number,
    orderItems: Array<any>
  ) => {
    const columns = await getInvoiceItemColumns();

    return orderItems.map((item) => {
      const fullPayload: Record<string, unknown> = {
        invoice_id: invoiceId,
        garment_type_id: item.garment_type_id,
        service_id: item.service_id,
        description: item.description,
        quantity: item.quantity,
        color: item.color,
        brand: item.brand,
        size_reference: item.size_reference,
        material: item.material,
        received_condition: item.received_condition,
        work_detail: item.work_detail,
        stains: item.stains,
        damages: item.damages,
        missing_accessories: item.missing_accessories,
        customer_observations: item.customer_observations,
        internal_observations: item.internal_observations,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount ?? 0,
        surcharge_amount: item.surcharge_amount ?? 0,
        subtotal: item.subtotal,
        total: item.total ?? item.subtotal
      };

      const filtered = Object.fromEntries(
        Object.entries(fullPayload).filter(([column]) => columns.has(column))
      );

      if (!('invoice_id' in filtered)) filtered.invoice_id = invoiceId;
      if (!('description' in filtered)) filtered.description = item.description;
      if (!('quantity' in filtered)) filtered.quantity = item.quantity;
      if (!('unit_price' in filtered)) filtered.unit_price = item.unit_price;
      if (!('subtotal' in filtered)) filtered.subtotal = item.subtotal;

      return filtered;
    });
  };

  const getClientActiveOrders = async (clientId: number, excludeOrderId: number) => {
    const rows = await db
      .selectFrom('orders as o')
      .innerJoin('order_statuses as os', 'os.id', 'o.status_id')
      .leftJoin('order_items as oi', 'oi.order_id', 'o.id')
      .select([
        'o.id',
        'o.order_number',
        'o.due_date',
        sql<number>`COALESCE(SUM(oi.quantity), 0)`.as('items_count')
      ])
      .where('o.client_id', '=', clientId)
      .where('o.id', '!=', excludeOrderId)
      .where('os.code', 'not in', ['DELIVERED', 'CANCELLED', 'CANCELED', 'CANCELADO'])
      .groupBy(['o.id', 'o.order_number', 'o.due_date'])
      .orderBy('o.id', 'desc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      dueDate: row.due_date ? new Date(row.due_date).toISOString() : null,
      itemsCount: Number(row.items_count ?? 0)
    }));
  };

  const list = async (): Promise<Invoice[]> => {
    const company = await db
      .selectFrom('company_settings')
      .selectAll()
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();

    const rows = await db
      .selectFrom('invoices as i')
      .innerJoin('clients as c', 'c.id', 'i.client_id')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .leftJoin('order_statuses as os', 'os.id', 'o.status_id')
      .select([
        'i.id',
        'i.invoice_number',
        'i.order_id',
        'i.client_id',
        'i.subtotal',
        'i.tax_total',
        'i.total',
        'i.legal_text',
        'i.created_at',
        'o.due_date',
        'o.notes as order_notes',
        'o.paid_total',
        'o.balance_due',
        'o.order_number',
        'o.is_manual',
        'o.manual_order_number',
        'o.manual_order_date',
        sql<string | null>`c.code`.as('client_code'),
        sql<string>`c.first_name`.as('first_name'),
        sql<string>`c.last_name`.as('last_name'),
        sql<string | null>`c.phone`.as('client_phone'),
        sql<string | null>`c.address`.as('client_address'),
        sql<string | null>`os.code`.as('status_code'),
        sql<string | null>`os.name`.as('status_name')
      ])
      .orderBy('i.id', 'desc')
      .execute();

    return rows.map((row) =>
      mapInvoice({
        ...row,
        client_name: `${row.first_name} ${row.last_name}`,
        ticket_code: buildTicketCode(row.order_number),
        company_name: company?.company_name ?? null,
        company_legal_name: company?.legal_name ?? null,
        company_phone: company?.phone ?? null,
        company_email: company?.email ?? null,
        company_address: company?.address ?? null,
        company_nit: company?.nit ?? null,
        company_logo: company?.logo_base64 ?? null,
        company_policies: company?.invoice_policies ?? null
      })
    );
  };

  const detail = async (id: number): Promise<InvoiceDetail> => {
    const company = await db
      .selectFrom('company_settings')
      .selectAll()
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();

    const invoice = await db
      .selectFrom('invoices as i')
      .innerJoin('clients as c', 'c.id', 'i.client_id')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .leftJoin('users as u', 'u.id', 'o.created_by')
      .leftJoin('order_statuses as os', 'os.id', 'o.status_id')
      .select([
        'i.id',
        'i.invoice_number',
        'i.order_id',
        'i.client_id',
        'i.subtotal',
        'i.tax_total',
        'i.total',
        'i.legal_text',
        'i.created_at',
        'o.order_number',
        'o.due_date',
        'o.notes as order_notes',
        'o.paid_total',
        'o.balance_due',
        'o.is_manual',
        'o.manual_order_number',
        'o.manual_order_date',
        sql<string | null>`u.full_name`.as('generated_by'),
        sql<string | null>`c.code`.as('client_code'),
        sql<string>`c.first_name`.as('first_name'),
        sql<string>`c.last_name`.as('last_name'),
        sql<string | null>`c.phone`.as('client_phone'),
        sql<string | null>`c.address`.as('client_address'),
        sql<string | null>`os.code`.as('status_code'),
        sql<string | null>`os.name`.as('status_name')
      ])
      .where('i.id', '=', id)
      .executeTakeFirstOrThrow();

    const [activeOrders, showAllActiveOrders] = await Promise.all([
      getClientActiveOrders(invoice.client_id, invoice.order_id),
      getInvoiceShowAllActiveOrdersEnabled()
    ]);

    const items = await db
      .selectFrom('invoice_items_snapshot')
      .selectAll()
      .where('invoice_id', '=', id)
      .orderBy('id')
      .execute();

    const paymentRows = await db
      .selectFrom('payments as p')
      .innerJoin('payment_methods as pm', 'pm.id', 'p.payment_method_id')
      .leftJoin('users as ru', 'ru.id', 'p.received_by')
      .select([
        'p.id',
        'p.amount',
        'p.reference',
        'p.notes',
        'p.status',
        'p.voided_at',
        'p.void_reason',
        'p.created_at',
        sql<string>`pm.name`.as('method_name'),
        sql<string | null>`ru.full_name`.as('received_by_name')
      ])
      .where('p.order_id', '=', invoice.order_id)
      .where(sql<boolean>`COALESCE(p.status, 'ACTIVE') <> 'VOIDED'`)
      .orderBy('p.id')
      .execute();

    const payments = paymentRows.map((row) => ({
      id: row.id,
      amount: Number(row.amount ?? 0),
      methodName: String(row.method_name ?? ''),
      reference: row.reference ?? null,
      notes: row.notes ?? null,
      receivedBy: row.received_by_name ?? null,
      status: row.status ?? 'ACTIVE',
      isVoided: String(row.status ?? 'ACTIVE').toUpperCase() === 'VOIDED',
      voidedAt: row.voided_at ? new Date(row.voided_at).toISOString() : null,
      voidReason: row.void_reason ?? null,
      createdAt: new Date(row.created_at).toISOString()
    }));

    const mapped = mapInvoice({
      ...invoice,
      client_name: `${invoice.first_name} ${invoice.last_name}`,
      ticket_code: buildTicketCode(invoice.order_number),
      company_name: company?.company_name ?? null,
      company_legal_name: company?.legal_name ?? null,
      company_phone: company?.phone ?? null,
      company_email: company?.email ?? null,
      company_address: company?.address ?? null,
      company_nit: company?.nit ?? null,
      company_logo: company?.logo_base64 ?? null,
      company_policies: company?.invoice_policies ?? null
    });

    return {
      ...mapped,
      items: items.map((item) => ({
        id: item.id,
        garmentTypeId: item.garment_type_id ?? null,
        serviceId: item.service_id ?? null,
        description: item.description,
        quantity: Number(item.quantity),
        color: null,
        brand: null,
        sizeReference: null,
        material: null,
        receivedCondition: null,
        workDetail: null,
        stains: null,
        damages: null,
        missingAccessories: null,
        customerObservations: item.customer_observations ?? null,
        internalObservations: (item as any).internal_observations ?? null,
        unitPrice: Number(item.unit_price),
        discountAmount: Number(item.discount_amount ?? 0),
        surchargeAmount: Number(item.surcharge_amount ?? 0),
        subtotal: Number(item.subtotal),
        total: Number(item.total ?? item.subtotal)
      })),
      activeOrders,
      payments,
      generatedBy: getCurrentSessionUserName() ?? invoice.generated_by ?? null,
      softwareName: 'LavaSuite Desktop',
      showAllActiveOrders,
      whatsappMessage: buildWhatsappMessage({
        invoiceNumber: mapped.invoiceNumber,
        clientName: mapped.clientName,
        dueDate: mapped.dueDate,
        notes: mapped.notes,
        legalText: mapped.legalText,
        companyPolicies: mapped.companyPolicies,
        total: mapped.total,
        paidTotal: mapped.paidTotal,
        balanceDue: mapped.balanceDue,
        ticketCode: mapped.ticketCode,
        companyName: mapped.companyName,
        showAllActiveOrders,
        activeOrders: activeOrders.map((order) => ({
          orderNumber: order.orderNumber,
          dueDate: order.dueDate,
          itemsCount: order.itemsCount
        })),
        items: items.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          total: Number(item.total ?? item.subtotal),
          customerObservations: item.customer_observations ?? null
        }))
      })
    };
  };

  const search = async (term: string, limit = 8): Promise<Invoice[]> => {
    const normalized = String(term ?? '').trim();
    if (!normalized) return [];
    const safeLimit = Math.max(1, Math.min(30, Number(limit) || 8));
    const likeTerm = `%${normalized}%`;

    const company = await db
      .selectFrom('company_settings')
      .selectAll()
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();

    const rows = await db
      .selectFrom('invoices as i')
      .innerJoin('clients as c', 'c.id', 'i.client_id')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .leftJoin('order_statuses as os', 'os.id', 'o.status_id')
      .select([
        'i.id',
        'i.invoice_number',
        'i.order_id',
        'i.client_id',
        'i.subtotal',
        'i.tax_total',
        'i.total',
        'i.legal_text',
        'i.created_at',
        'o.due_date',
        'o.notes as order_notes',
        'o.paid_total',
        'o.balance_due',
        'o.order_number',
        'o.is_manual',
        'o.manual_order_number',
        'o.manual_order_date',
        sql<string | null>`c.code`.as('client_code'),
        sql<string>`c.first_name`.as('first_name'),
        sql<string>`c.last_name`.as('last_name'),
        sql<string | null>`c.phone`.as('client_phone'),
        sql<string | null>`c.address`.as('client_address'),
        sql<string | null>`os.code`.as('status_code'),
        sql<string | null>`os.name`.as('status_name')
      ])
      .where((eb) =>
        eb.or([
          eb('i.invoice_number', 'like', likeTerm),
          eb('o.order_number', 'like', likeTerm),
          sql<boolean>`CONCAT(c.first_name, ' ', c.last_name) LIKE ${likeTerm}`
        ])
      )
      .orderBy('i.id', 'desc')
      .limit(safeLimit)
      .execute();

    return rows.map((row) =>
      mapInvoice({
        ...row,
        client_name: `${row.first_name} ${row.last_name}`,
        ticket_code: buildTicketCode(row.order_number),
        company_name: company?.company_name ?? null,
        company_phone: company?.phone ?? null,
        company_address: company?.address ?? null,
        company_nit: company?.nit ?? null,
        company_logo: company?.logo_base64 ?? null,
        company_policies: company?.invoice_policies ?? null
      })
    );
  };

  const findExistingInvoiceForOrder = async (orderId: number) =>
    db
      .selectFrom('invoices')
      .select(['id', 'invoice_number'])
      .where('order_id', '=', orderId)
      .orderBy('id')
      .executeTakeFirst();

  const isDuplicateOrderInvoiceError = (err: unknown) => {
    const code = (err as { code?: string } | null)?.code ?? '';
    if (code !== 'ER_DUP_ENTRY') return false;
    const message = String((err as { message?: string } | null)?.message ?? '');
    return /uk_invoices_order_id|invoices\.order_id|for key 'order_id'/i.test(message);
  };

  const isDuplicateInvoiceNumberError = (err: unknown) => {
    const code = (err as { code?: string } | null)?.code ?? '';
    if (code !== 'ER_DUP_ENTRY') return false;
    const message = String((err as { message?: string } | null)?.message ?? '');
    return /invoice_number/i.test(message);
  };

  const createFromOrder = async (orderId: number): Promise<InvoiceDetail> => {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const order = await db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', orderId)
      .executeTakeFirstOrThrow();

    const orderItems = await db
      .selectFrom('order_items')
      .selectAll()
      .where('order_id', '=', orderId)
      .orderBy('id')
      .execute();

    const company = await db
      .selectFrom('company_settings')
      .selectAll()
      .limit(1)
      .executeTakeFirst();

    // Punto idempotente: si la orden ya tiene factura, refrescamos su
    // snapshot y totales en lugar de crear una nueva. El UNIQUE
    // uk_invoices_order_id (migración 018) protege contra carreras a
    // nivel de BD; aquí lo confirmamos a nivel de aplicación.
    const existingInvoice = await findExistingInvoiceForOrder(orderId);

    let invoiceId = 0;

    if (existingInvoice) {
      invoiceId = existingInvoice.id;

      diagnosticLogger.info('invoices.createFromOrder', 'Refrescando snapshot de factura existente', {
        orderId,
        invoiceId,
        invoiceNumber: existingInvoice.invoice_number,
        orderItemsCount: orderItems.length,
        orderItemsWithCustomerObs: orderItems.filter((it: any) => String(it.customer_observations ?? '').trim()).length
      });

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('invoices')
          .set({
            client_id: order.client_id,
            subtotal: order.subtotal,
            tax_total: 0,
            total: order.total,
            legal_text: company?.company_name
              ? `Documento generado por ${company.company_name}.`
              : 'Documento generado por el sistema.'
          })
          .where('id', '=', invoiceId)
          .execute();

        await trx
          .deleteFrom('invoice_items_snapshot')
          .where('invoice_id', '=', invoiceId)
          .execute();

        await trx
          .insertInto('invoice_items_snapshot')
          .values((await buildInvoiceItemSnapshotValues(invoiceId, orderItems)) as any)
          .execute();

        await trx
          .insertInto('audit_logs')
          .values({
            user_id: actorId,
            action: 'INVOICE_REFRESH',
            entity_type: 'invoice',
            entity_id: String(invoiceId),
            details_json: JSON.stringify({
              orderId,
              orderNumber: order.order_number,
              invoiceNumber: existingInvoice.invoice_number,
              actorName
            })
          })
          .execute();
      });

      return detail(invoiceId);
    }

    let invoiceNumber = '';

    const doInsert = async () => {
      await db.transaction().execute(async (trx) => {
        await sql`
          UPDATE counters
          SET current_value = GREATEST(
            current_value + 1,
            COALESCE(
              (SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '-', -1) AS UNSIGNED)) FROM invoices),
              0
            ) + 1
          )
          WHERE counter_key = 'invoices'
        `.execute(trx);

        const counter = await trx
          .selectFrom('counters')
          .select(['current_value', 'prefix', 'padding'])
          .where('counter_key', '=', 'invoices')
          .executeTakeFirstOrThrow();

        invoiceNumber = `${counter.prefix}-${String(counter.current_value).padStart(Number(counter.padding), '0')}`;

        const inserted = await trx
          .insertInto('invoices')
          .values({
            invoice_number: invoiceNumber,
            order_id: order.id,
            client_id: order.client_id,
            subtotal: order.subtotal,
            tax_total: 0,
            total: order.total,
            legal_text: company?.company_name
              ? `Documento generado por ${company.company_name}.`
              : 'Documento generado por el sistema.'
          })
          .executeTakeFirstOrThrow();

        invoiceId = Number(inserted.insertId);

        await trx
          .insertInto('invoice_items_snapshot')
          .values((await buildInvoiceItemSnapshotValues(invoiceId, orderItems)) as any)
          .execute();

        await trx
          .insertInto('audit_logs')
          .values({
            user_id: actorId,
            action: 'INVOICE_CREATE',
            entity_type: 'invoice',
            entity_id: String(invoiceId),
            details_json: JSON.stringify({
              orderId,
              orderNumber: order.order_number,
              invoiceNumber,
              actorName
            })
          })
          .execute();
      });
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await doInsert();
        break;
      } catch (err: any) {
        // Carrera: otra petición acaba de crear la factura para esta
        // orden. Recuperamos la canónica y retornamos sin duplicar.
        if (isDuplicateOrderInvoiceError(err)) {
          const winner = await findExistingInvoiceForOrder(orderId);
          if (winner) {
            invoiceId = winner.id;
            return detail(invoiceId);
          }
        }

        if (isDuplicateInvoiceNumberError(err) && attempt < 3) {
          // Contador desfasado: el GREATEST en el siguiente intento lo
          // corrige solo. No reintentamos indefinidamente para evitar
          // un loop si la BD está realmente inconsistente.
          continue;
        }

        throw err;
      }
    }

    return detail(invoiceId);
  };

  // Update solo de las notas de la orden subyacente. Aislamos esta
  // mutation para que el guardado de "Notas" desde la pantalla de
  // factura/orden no recalcule items ni dispare validaciones pesadas
  // (esa era la causa de que los cambios "se revirtieran" al refetch).
  const updateNotes = async (orderId: number, notes: string | null) => {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const trimmed = notes && notes.trim().length > 0 ? notes : null;

    const order = await db
      .selectFrom('orders')
      .select(['id', 'order_number', 'notes'])
      .where('id', '=', orderId)
      .executeTakeFirst();

    if (!order) throw new Error('Orden no encontrada.');

    await db
      .updateTable('orders')
      .set({ notes: trimmed })
      .where('id', '=', orderId)
      .execute();

    await db.insertInto('audit_logs').values({
      user_id: actorId,
      action: 'ORDER_NOTES_UPDATE',
      entity_type: 'order',
      entity_id: String(orderId),
      details_json: JSON.stringify({
        orderNumber: order.order_number,
        previousNotes: order.notes,
        notes: trimmed,
        actorName
      })
    }).execute();

    return { id: orderId, notes: trimmed };
  };

  return { list, detail, createFromOrder, search, updateNotes };
};

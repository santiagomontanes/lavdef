import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Invoice, InvoiceDetail } from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';

const buildTicketCode = (orderNumber: string) => `TK-${orderNumber}`;

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
      ? [
          '',
          '*ÓRDENES ACTIVAS DEL CLIENTE*',
          ...invoice.activeOrders.map(
            (order, index) =>
              `${index + 1}. ${order.orderNumber} | Fecha promesa: ${order.dueDate ? new Date(order.dueDate).toLocaleDateString('es-CO') : 'Sin definir'} | Ítems: ${order.itemsCount}`
          )
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
  clientName: row.client_name,
  clientPhone: row.client_phone ?? null,
  subtotal: Number(row.subtotal),
  taxTotal: Number(row.tax_total),
  total: Number(row.total),
  legalText: row.legal_text,
  dueDate: row.due_date ? new Date(row.due_date).toISOString() : null,
  notes: row.order_notes ?? null,
  paidTotal: Number(row.paid_total ?? 0),
  balanceDue: Number(row.balance_due ?? 0),
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
      .orderBy('o.id desc')
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
        sql<string>`c.first_name`.as('first_name'),
        sql<string>`c.last_name`.as('last_name'),
        sql<string | null>`c.phone`.as('client_phone')
      ])
      .orderBy('i.id desc')
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
        sql<string | null>`u.full_name`.as('generated_by'),
        sql<string>`c.first_name`.as('first_name'),
        sql<string>`c.last_name`.as('last_name'),
        sql<string | null>`c.phone`.as('client_phone')
      ])
      .where('i.id', '=', id)
      .executeTakeFirstOrThrow();

    const activeOrders = await getClientActiveOrders(invoice.client_id, invoice.order_id);

    const items = await db
      .selectFrom('invoice_items_snapshot')
      .selectAll()
      .where('invoice_id', '=', id)
      .orderBy('id')
      .execute();

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
        internalObservations: null,
        unitPrice: Number(item.unit_price),
        discountAmount: Number(item.discount_amount ?? 0),
        surchargeAmount: Number(item.surcharge_amount ?? 0),
        subtotal: Number(item.subtotal),
        total: Number(item.total ?? item.subtotal)
      })),
      activeOrders,
      generatedBy: getCurrentSessionUserName() ?? invoice.generated_by ?? null,
      softwareName: 'LavaSuite Desktop',
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
        sql<string>`c.first_name`.as('first_name'),
        sql<string>`c.last_name`.as('last_name'),
        sql<string | null>`c.phone`.as('client_phone')
      ])
      .where((eb) =>
        eb.or([
          eb('i.invoice_number', 'like', likeTerm),
          eb('o.order_number', 'like', likeTerm),
          sql<boolean>`CONCAT(c.first_name, ' ', c.last_name) LIKE ${likeTerm}`
        ])
      )
      .orderBy('i.id desc')
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

    const existingInvoice = await db
      .selectFrom('invoices')
      .select(['id', 'invoice_number'])
      .where('order_id', '=', orderId)
      .orderBy('id desc')
      .executeTakeFirst();

    let invoiceId = 0;

    if (existingInvoice) {
      invoiceId = existingInvoice.id;

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
      try { await doInsert(); break; }
      catch (err: any) {
        const isDuplicate = err?.code === 'ER_DUP_ENTRY' || String(err?.message ?? '').includes('Duplicate entry');
        if (isDuplicate && attempt < 3) continue;
        throw err;
      }
    }

    return detail(invoiceId);
  };

  return { list, detail, createFromOrder, search };
};

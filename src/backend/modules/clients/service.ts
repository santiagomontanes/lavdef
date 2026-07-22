import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type {
  Client,
  ClientInput,
  SimilarClientMatch,
  ClientMergeResult
} from '../../../shared/types.js';
import { createClientRepository } from './repositories/client-repository.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';

const schema = z.object({
  firstName: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  phone: z.string().trim().min(7),
  email: z.string().trim().email().nullable().or(z.literal('')).transform((value) => value || null),
  address: z.string().trim().nullable().or(z.literal('')).transform((value) => value || null),
  notes: z.string().trim().nullable().or(z.literal('')).transform((value) => value || null)
});

const createInputSchema = schema.extend({
  // Cuando el usuario confirma desde el modal "Cliente similar detectado" pasamos
  // force=true para saltar la validación de duplicados por nombre. El UNIQUE de
  // teléfono y la búsqueda de similares siguen activos en cualquier caso.
  force: z.boolean().optional().default(false)
});

type ClientRowSelect = {
  id: number;
  code: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: Date;
};

const mapClient = (row: ClientRowSelect & { orders_count?: number }): Client => ({
  id: row.id,
  code: row.code,
  firstName: row.first_name,
  lastName: row.last_name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  notes: row.notes,
  ordersCount: Number((row as any).orders_count ?? 0),
  createdAt: row.created_at.toISOString()
});

const normalizePhone = (raw: string) => String(raw ?? '').replace(/\D/g, '');
const normalizeName = (raw: string) =>
  String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isDuplicateCodeError = (err: unknown) => {
  const code = (err as { code?: string } | null)?.code ?? '';
  if (code === 'ER_DUP_ENTRY') return true;
  const message = String((err as { message?: string } | null)?.message ?? '');
  return /Duplicate entry .*for key .*(uk_clients_code|clients\.code|code)/i.test(message);
};

export const createClientsService = (db: Kysely<Database>) => {
  const repository = createClientRepository(db);

  // Devuelve el siguiente código CLI calculado de forma atómica. Se invoca
  // dentro de una transacción para que GREATEST(counter+1, MAX(actual)+1)
  // siempre quede por delante de cualquier código existente.
  const claimNextClientCode = async (trx: Kysely<Database>) => {
    await sql`
      UPDATE counters
      SET current_value = GREATEST(
        current_value + 1,
        COALESCE(
          (SELECT MAX(CAST(SUBSTRING_INDEX(code, '-', -1) AS UNSIGNED))
           FROM clients
           WHERE code REGEXP '^CLI-[0-9]+$'),
          0
        ) + 1
      )
      WHERE counter_key = 'clients'
    `.execute(trx);

    const counter = await trx
      .selectFrom('counters')
      .select(['current_value', 'prefix', 'padding'])
      .where('counter_key', '=', 'clients')
      .executeTakeFirstOrThrow();

    return `${counter.prefix}-${String(counter.current_value).padStart(Number(counter.padding), '0')}`;
  };

  const findSimilar = async (input: {
    firstName: string;
    lastName: string;
    phone: string;
    excludeId?: number;
  }): Promise<SimilarClientMatch[]> => {
    const phoneDigits = normalizePhone(input.phone);
    const firstNorm = normalizeName(input.firstName);
    const lastNorm = normalizeName(input.lastName);

    if (phoneDigits.length < 4 && (firstNorm.length < 2 || lastNorm.length < 2)) {
      return [];
    }

    const rows = await db
      .selectFrom('clients')
      .select(['id', 'code', 'first_name', 'last_name', 'phone', 'email', 'address', 'notes', 'created_at'])
      .where((eb) => {
        const conditions = [] as any[];
        if (phoneDigits.length >= 4) {
          conditions.push(eb('phone', 'like', `%${phoneDigits}%`));
        }
        if (firstNorm.length >= 2 && lastNorm.length >= 2) {
          conditions.push(
            sql<boolean>`LOWER(CONCAT(first_name, ' ', last_name)) LIKE ${`%${firstNorm} ${lastNorm}%`}`
          );
        }
        return eb.or(conditions.length > 0 ? conditions : [sql<boolean>`1=0`]);
      })
      .$if(typeof input.excludeId === 'number' && input.excludeId > 0, (qb) =>
        qb.where('id', '!=', input.excludeId!)
      )
      .orderBy('id', 'desc')
      .limit(10)
      .execute();

    return rows.map((row) => {
      const samePhone = phoneDigits.length >= 4 && normalizePhone(row.phone).includes(phoneDigits);
      const sameName =
        firstNorm.length >= 2 &&
        lastNorm.length >= 2 &&
        normalizeName(`${row.first_name} ${row.last_name}`).includes(`${firstNorm} ${lastNorm}`);

      return {
        id: row.id,
        code: row.code,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone,
        matchedBy: samePhone && sameName ? 'both' : samePhone ? 'phone' : 'name'
      } satisfies SimilarClientMatch;
    });
  };

  return {
    async list(): Promise<Client[]> {
      const rows = await db
        .selectFrom('clients as c')
        .leftJoin('orders as o', 'o.client_id', 'c.id')
        .select([
          'c.id',
          'c.code',
          'c.first_name',
          'c.last_name',
          'c.phone',
          'c.email',
          'c.address',
          'c.notes',
          'c.created_at',
          (eb) => eb.fn.count<number>('o.id').as('orders_count')
        ])
        .groupBy([
          'c.id',
          'c.code',
          'c.first_name',
          'c.last_name',
          'c.phone',
          'c.email',
          'c.address',
          'c.notes',
          'c.created_at'
        ])
        .orderBy('c.id', 'desc')
        .execute();

      return rows.map(mapClient);
    },

    async searchByName(term: string, limit = 40): Promise<Client[]> {
      const normalized = String(term ?? '').trim();
      if (!normalized) return [];

      const likeTerm = `%${normalized}%`;
      const phoneDigits = normalized.replace(/\D/g, '');
      const rows = await db
        .selectFrom('clients')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb('first_name', 'like', likeTerm),
            eb('last_name', 'like', likeTerm),
            sql<boolean>`CONCAT(first_name, ' ', last_name) LIKE ${likeTerm}`,
            ...(phoneDigits.length >= 4
              ? [eb('phone', 'like', `%${phoneDigits}%`) as any]
              : [])
          ])
        )
        .orderBy('first_name')
        .orderBy('last_name')
        .limit(Math.max(1, Math.min(100, Number(limit) || 40)))
        .execute();

      return rows.map(mapClient);
    },

    findSimilar,

    async create(input: ClientInput & { force?: boolean }): Promise<Client> {
      const actorId = getCurrentSessionUserId() ?? 1;
      const actorName = getCurrentSessionUserName();
      const parsed = createInputSchema.parse(input);

      const existingByPhone = await db
        .selectFrom('clients')
        .select(['id', 'code', 'first_name', 'last_name'])
        .where('phone', '=', parsed.phone)
        .executeTakeFirst();

      if (existingByPhone) {
        // El teléfono es UNIQUE de facto. Aunque la BD no lo imponga, el
        // negocio depende de él para WhatsApp y por eso lo bloqueamos
        // siempre — sin importar el flag force.
        throw new Error('El número de teléfono ya está registrado en otro cliente. Revisa el teléfono ingresado.');
      }

      if (!parsed.force) {
        const similar = await findSimilar({
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          phone: parsed.phone
        });
        if (similar.length > 0) {
          const matchesBlob = JSON.stringify(similar);
          const error = new Error(
            `Ya existe un cliente similar. Revísalo antes de crear uno nuevo. SIMILAR_MATCHES=${matchesBlob}`
          );
          (error as Error & { matches?: SimilarClientMatch[] }).matches = similar;
          throw error;
        }
      }

      let clientId = 0;
      let code = '';

      // Reintenta hasta 3 veces si dos transacciones intentan tomar el
      // mismo CLI-xxxxx. El GREATEST garantiza que el contador avance
      // siempre, pero un duplicate-key residual se resuelve reintentando.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await db.transaction().execute(async (trx) => {
            code = await claimNextClientCode(trx);

            const result = await trx.insertInto('clients').values({
              code,
              first_name: parsed.firstName,
              last_name: parsed.lastName,
              phone: parsed.phone,
              email: parsed.email,
              address: parsed.address,
              notes: parsed.notes
            }).executeTakeFirstOrThrow();

            clientId = Number(result.insertId);
          });
          break;
        } catch (err) {
          if (isDuplicateCodeError(err) && attempt < 3) continue;
          throw err;
        }
      }

      const row = await repository.findById(clientId);
      await db.insertInto('audit_logs').values({
        user_id: actorId,
        action: 'CLIENT_CREATE',
        entity_type: 'client',
        entity_id: String(clientId),
        details_json: JSON.stringify({ ...parsed, actorName })
      }).execute();
      if (!row) throw new Error('No fue posible recuperar el cliente creado.');
      return mapClient(row);
    },

    async update(id: number, input: ClientInput): Promise<Client> {
      const actorId = getCurrentSessionUserId() ?? 1;
      const actorName = getCurrentSessionUserName();
      const parsed = schema.parse(input);

      const existing = await db
        .selectFrom('clients')
        .select('id')
        .where('phone', '=', parsed.phone)
        .where('id', '!=', id)
        .executeTakeFirst();

      if (existing) {
        throw new Error('El número de teléfono ya está registrado en otro cliente. Revisa el teléfono ingresado.');
      }

      await repository.update(id, {
        first_name: parsed.firstName,
        last_name: parsed.lastName,
        phone: parsed.phone,
        email: parsed.email,
        address: parsed.address,
        notes: parsed.notes
      });
      const row = await repository.findById(id);
      await db.insertInto('audit_logs').values({
        user_id: actorId,
        action: 'CLIENT_UPDATE',
        entity_type: 'client',
        entity_id: String(id),
        details_json: JSON.stringify({ ...parsed, actorName })
      }).execute();
      if (!row) throw new Error('Cliente no encontrado.');
      return mapClient(row);
    },

    async remove(id: number) {
      const actorId = getCurrentSessionUserId() ?? 1;
      const actorName = getCurrentSessionUserName();

      // Bloquea el delete si existe historial financiero o operativo.
      // El usuario debe usar "Fusionar duplicado" en su lugar.
      const [ordersCount, invoicesCount, paymentsCount, deliveriesCount] = await Promise.all([
        db
          .selectFrom('orders')
          .select((eb) => eb.fn.count<number>('id').as('count'))
          .where('client_id', '=', id)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('invoices')
          .select((eb) => eb.fn.count<number>('id').as('count'))
          .where('client_id', '=', id)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('payments as p')
          .innerJoin('orders as o', 'o.id', 'p.order_id')
          .select((eb) => eb.fn.count<number>('p.id').as('count'))
          .where('o.client_id', '=', id)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('delivery_records as d')
          .innerJoin('orders as o', 'o.id', 'd.order_id')
          .select((eb) => eb.fn.count<number>('d.id').as('count'))
          .where('o.client_id', '=', id)
          .executeTakeFirstOrThrow()
      ]);

      const linked = {
        orders: Number(ordersCount.count ?? 0),
        invoices: Number(invoicesCount.count ?? 0),
        payments: Number(paymentsCount.count ?? 0),
        deliveries: Number(deliveriesCount.count ?? 0)
      };

      const hasHistory =
        linked.orders > 0 || linked.invoices > 0 || linked.payments > 0 || linked.deliveries > 0;

      if (hasHistory) {
        const parts = [] as string[];
        if (linked.orders > 0) parts.push(`${linked.orders} orden(es)`);
        if (linked.invoices > 0) parts.push(`${linked.invoices} factura(s)`);
        if (linked.payments > 0) parts.push(`${linked.payments} pago(s)`);
        if (linked.deliveries > 0) parts.push(`${linked.deliveries} entrega(s)`);
        throw new Error(
          `No se puede eliminar este cliente porque tiene historial: ${parts.join(', ')}. ` +
            `Si es un duplicado, usa "Fusionar duplicado" para mover su historial al cliente correcto.`
        );
      }

      await repository.delete(id);
      await db.insertInto('audit_logs').values({
        user_id: actorId,
        action: 'CLIENT_DELETE',
        entity_type: 'client',
        entity_id: String(id),
        details_json: JSON.stringify({ actorName })
      }).execute();
      return { id };
    },

    // Fusión segura de un cliente duplicado en uno principal. Mueve todas
    // las relaciones FK conocidas y borra el duplicado al final. Si surge
    // un error en cualquier paso, la transacción revierte todo.
    async merge(primaryId: number, duplicateId: number): Promise<ClientMergeResult> {
      const actorId = getCurrentSessionUserId() ?? 1;
      const actorName = getCurrentSessionUserName();

      if (!Number.isFinite(primaryId) || !Number.isFinite(duplicateId)) {
        throw new Error('IDs de cliente inválidos.');
      }
      if (primaryId === duplicateId) {
        throw new Error('El cliente principal y el duplicado no pueden ser el mismo.');
      }

      const [primary, duplicate] = await Promise.all([
        repository.findById(primaryId),
        repository.findById(duplicateId)
      ]);

      if (!primary) throw new Error('No se encontró el cliente principal.');
      if (!duplicate) throw new Error('No se encontró el cliente duplicado.');

      const moved = {
        orders: 0,
        invoices: 0,
        payments: 0,
        deliveries: 0,
        measurements: 0,
        notifications: 0
      };

      await db.transaction().execute(async (trx) => {
        const ordersResult = await trx
          .updateTable('orders')
          .set({ client_id: primaryId })
          .where('client_id', '=', duplicateId)
          .executeTakeFirst();
        moved.orders = Number(ordersResult.numUpdatedRows ?? 0);

        const invoicesResult = await trx
          .updateTable('invoices')
          .set({ client_id: primaryId })
          .where('client_id', '=', duplicateId)
          .executeTakeFirst();
        moved.invoices = Number(invoicesResult.numUpdatedRows ?? 0);

        // Pagos y entregas se mueven indirectamente vía orders.client_id
        // (sus FKs apuntan a la orden, no al cliente). Los contamos para
        // mostrarlo en el resumen al usuario.
        const paymentsAffected = await trx
          .selectFrom('payments as p')
          .innerJoin('orders as o', 'o.id', 'p.order_id')
          .select((eb) => eb.fn.count<number>('p.id').as('count'))
          .where('o.client_id', '=', primaryId)
          .executeTakeFirstOrThrow();
        moved.payments = Number(paymentsAffected.count ?? 0);

        const deliveriesAffected = await trx
          .selectFrom('delivery_records as d')
          .innerJoin('orders as o', 'o.id', 'd.order_id')
          .select((eb) => eb.fn.count<number>('d.id').as('count'))
          .where('o.client_id', '=', primaryId)
          .executeTakeFirstOrThrow();
        moved.deliveries = Number(deliveriesAffected.count ?? 0);

        const measurementsResult = await trx
          .updateTable('customer_measurements')
          .set({ client_id: primaryId })
          .where('client_id', '=', duplicateId)
          .executeTakeFirst();
        moved.measurements = Number(measurementsResult.numUpdatedRows ?? 0);

        const notificationsResult = await trx
          .updateTable('notifications_whatsapp')
          .set({ client_id: primaryId })
          .where('client_id', '=', duplicateId)
          .executeTakeFirst();
        moved.notifications = Number(notificationsResult.numUpdatedRows ?? 0);

        await trx
          .updateTable('message_queue')
          .set({ client_id: primaryId })
          .where('client_id', '=', duplicateId)
          .execute();

        // Re-apunta auditorías históricas del duplicado al cliente
        // principal para que la pestaña de auditoría del cliente fusionado
        // siga mostrándolas. Mantenemos los detalles_json intactos: la
        // referencia al ID histórico queda en el nuevo log CLIENT_MERGE
        // que se inserta abajo.
        await trx
          .updateTable('audit_logs')
          .set({ entity_id: String(primaryId) })
          .where('entity_type', '=', 'client')
          .where('entity_id', '=', String(duplicateId))
          .execute();

        await trx.deleteFrom('clients').where('id', '=', duplicateId).execute();

        await trx.insertInto('audit_logs').values({
          user_id: actorId,
          action: 'CLIENT_MERGE',
          entity_type: 'client',
          entity_id: String(primaryId),
          details_json: JSON.stringify({
            primaryId,
            duplicateId,
            duplicateCode: duplicate.code,
            duplicateName: `${duplicate.first_name} ${duplicate.last_name}`,
            moved,
            actorName
          })
        }).execute();
      });

      const updated = await repository.findById(primaryId);
      if (!updated) throw new Error('No fue posible recuperar el cliente principal tras la fusión.');

      return {
        primary: mapClient(updated),
        movedCounts: moved,
        removedClient: {
          id: duplicateId,
          code: duplicate.code,
          name: `${duplicate.first_name} ${duplicate.last_name}`.trim()
        }
      };
    }
  };
};

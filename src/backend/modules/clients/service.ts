import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Client, ClientInput } from '../../../shared/types.js';
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

const mapClient = (row: { id: number; code: string; first_name: string; last_name: string; phone: string; email: string | null; address: string | null; notes: string | null; created_at: Date; }): Client => ({
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

export const createClientsService = (db: Kysely<Database>) => {
  const repository = createClientRepository(db);

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
        .orderBy('c.id desc')
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

    async create(input: ClientInput): Promise<Client> {
      const actorId = getCurrentSessionUserId() ?? 1;
      const actorName = getCurrentSessionUserName();
      const parsed = schema.parse(input);

      const existing = await db
        .selectFrom('clients')
        .select('id')
        .where('phone', '=', parsed.phone)
        .executeTakeFirst();

      if (existing) {
        throw new Error('El número de teléfono ya está registrado en otro cliente. Revisa el teléfono ingresado.');
      }

      const count = await repository.count();
      const code = `CLI-${String(Number(count.count) + 1).padStart(5, '0')}`;
      const result = await db.insertInto('clients').values({
        code,
        first_name: parsed.firstName,
        last_name: parsed.lastName,
        phone: parsed.phone,
        email: parsed.email,
        address: parsed.address,
        notes: parsed.notes
      }).executeTakeFirstOrThrow();
      const row = await repository.findById(Number(result.insertId));
      await db.insertInto('audit_logs').values({
        user_id: actorId,
        action: 'CLIENT_CREATE',
        entity_type: 'client',
        entity_id: String(result.insertId),
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
      const ordersCount = await db
        .selectFrom('orders')
        .select((eb) => eb.fn.count<number>('id').as('count'))
        .where('client_id', '=', id)
        .executeTakeFirstOrThrow();

      const linkedOrders = Number(ordersCount.count ?? 0);
      if (linkedOrders > 0) {
        throw new Error(
          `No se puede eliminar el cliente porque tiene ${linkedOrders} orden(es) creada(s).`
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
    }
  };
};

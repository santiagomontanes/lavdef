import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type {
  SellerUser,
  SellerUserCreateInput,
  SellerUserUpdateInput
} from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';

const updateSchema = z.object({
  fullName: z.string().trim().min(3),
  username: z.string().trim().min(3),
  password: z.string().trim().min(3).nullable().optional()
});

const createSchema = z.object({
  fullName: z.string().trim().min(3),
  username: z.string().trim().min(3),
  password: z.string().trim().min(3)
});

const mapSeller = (row: any): SellerUser => ({
  id: row.id,
  fullName: String(row.full_name ?? ''),
  username: String(row.username ?? ''),
  password: ''
});

export const createUsersService = (db: Kysely<Database>) => ({
  async listSellers(): Promise<SellerUser[]> {
    const rows = await db
      .selectFrom('users as u')
      .innerJoin('roles as r', 'r.id', 'u.role_id')
      .select(['u.id', 'u.full_name', 'u.username'])
      .where('u.is_active', '=', 1)
      .where('u.role_id', '!=', 1)
      .orderBy('u.full_name')
      .execute();

    return rows.map(mapSeller);
  },

  async updateSeller(id: number, input: SellerUserUpdateInput): Promise<SellerUser> {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const parsed = updateSchema.parse(input);

    const target = await db
      .selectFrom('users')
      .select(['id', 'role_id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!target) {
      throw new Error('Usuario no encontrado.');
    }

    if (Number(target.role_id) === 1) {
      throw new Error('No se puede editar este usuario desde este módulo.');
    }

    const existingUsername = await db
      .selectFrom('users')
      .select('id')
      .where('username', '=', parsed.username)
      .where('id', '!=', id)
      .executeTakeFirst();

    if (existingUsername) {
      throw new Error('Ese nombre de usuario ya está en uso.');
    }

    const nextPassword = String(parsed.password ?? '').trim();
    const values: Record<string, unknown> = {
      full_name: parsed.fullName,
      username: parsed.username
    };

    if (nextPassword) {
      values.password_hash = await bcrypt.hash(nextPassword, 10);
    }

    await db
      .updateTable('users')
      .set(values as any)
      .where('id', '=', id)
      .execute();

    await db
      .insertInto('audit_logs')
      .values({
        user_id: actorId,
        action: 'USER_UPDATE',
        entity_type: 'user',
        entity_id: String(id),
        details_json: JSON.stringify({
          actorName,
          updatedByModule: 'users',
          fullName: parsed.fullName,
          username: parsed.username,
          passwordChanged: Boolean(nextPassword)
        })
      })
      .execute();

    const updated = await db
      .selectFrom('users')
      .select(['id', 'full_name', 'username'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    return mapSeller(updated);
  },

  async createSeller(input: SellerUserCreateInput): Promise<SellerUser> {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const parsed = createSchema.parse(input);

    const existingUsername = await db
      .selectFrom('users')
      .select('id')
      .where('username', '=', parsed.username)
      .executeTakeFirst();

    if (existingUsername) {
      throw new Error('Ese nombre de usuario ya está en uso.');
    }

    const sellerRole = await db
      .selectFrom('roles')
      .select(['id', 'name'])
      .where('name', 'in', ['Vendedor', 'vendedor', 'Seller'])
      .orderBy('id')
      .executeTakeFirst();

    const roleId = Number(sellerRole?.id ?? 2);

    const inserted = await db
      .insertInto('users')
      .values({
        branch_id: null,
        role_id: roleId,
        username: parsed.username,
        password_hash: await bcrypt.hash(parsed.password, 10),
        full_name: parsed.fullName,
        is_active: 1
      })
      .executeTakeFirstOrThrow();

    await db
      .insertInto('audit_logs')
      .values({
        user_id: actorId,
        action: 'USER_CREATE',
        entity_type: 'user',
        entity_id: String(inserted.insertId),
        details_json: JSON.stringify({
          actorName,
          fullName: parsed.fullName,
          username: parsed.username,
          roleId
        })
      })
      .execute();

    const created = await db
      .selectFrom('users')
      .select(['id', 'full_name', 'username'])
      .where('id', '=', Number(inserted.insertId))
      .executeTakeFirstOrThrow();

    return mapSeller(created);
  },

  async removeSeller(id: number): Promise<{ success: true }> {
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();
    const target = await db
      .selectFrom('users')
      .select(['id', 'role_id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!target) {
      throw new Error('Usuario no encontrado.');
    }

    if (Number(target.role_id) === 1) {
      throw new Error('No se puede eliminar un administrador desde este módulo.');
    }

    await db
      .updateTable('users')
      .set({ is_active: 0 })
      .where('id', '=', id)
      .execute();

    await db
      .insertInto('audit_logs')
      .values({
        user_id: actorId,
        action: 'USER_DELETE',
        entity_type: 'user',
        entity_id: String(id),
        details_json: JSON.stringify({ softDelete: true, actorName })
      })
      .execute();

    return { success: true };
  }
});

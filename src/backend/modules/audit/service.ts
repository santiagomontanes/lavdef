import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { AuditDay, AuditEntry } from '../../../shared/types.js';

export const createAuditService = (db: Kysely<Database>) => {
  const normalizeDateKey = (value: string) => {
    const raw = String(value ?? '').trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Fecha inválida para auditoría.');
    }
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const buildDayBounds = (dateKey: string) => {
    const from = new Date(`${dateKey}T00:00:00`);
    const to = new Date(`${dateKey}T23:59:59.999`);
    return { from, to };
  };

  const listDays = async (): Promise<AuditDay[]> => {
    const rows = await db
      .selectFrom('audit_logs')
      .select([
        sql<string>`DATE_FORMAT(created_at, '%Y-%m-%d')`.as('date'),
        sql<number>`COUNT(*)`.as('count')
      ])
      .groupBy(sql`DATE_FORMAT(created_at, '%Y-%m-%d')`)
      .orderBy(sql`DATE_FORMAT(created_at, '%Y-%m-%d')`, 'desc')
      .limit(90)
      .execute();

    return rows.map((row) => ({
      date: String(row.date),
      count: Number(row.count)
    }));
  };

  const listByDay = async (date: string): Promise<AuditEntry[]> => {
    const dateKey = normalizeDateKey(date);
    const bounds = buildDayBounds(dateKey);

    const rows = await db
      .selectFrom('audit_logs as a')
      .leftJoin('users as u', 'u.id', 'a.user_id')
      .select([
        'a.id',
        'a.action',
        'a.entity_type',
        'a.entity_id',
        'a.details_json',
        'a.created_at',
        'a.user_id',
        sql<string | null>`u.full_name`.as('actor_name'),
        sql<string | null>`u.username`.as('actor_username')
      ])
      .where('a.created_at', '>=', bounds.from)
      .where('a.created_at', '<=', bounds.to)
      .orderBy('a.id', 'desc')
      .limit(500)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      action: String(row.action ?? ''),
      entityType: String(row.entity_type ?? ''),
      entityId: String(row.entity_id ?? ''),
      details: row.details_json ? (() => {
        try { return JSON.parse(String(row.details_json)); } catch { return null; }
      })() : null,
      userId: row.user_id ?? null,
      actorName: row.actor_name ?? null,
      actorUsername: row.actor_username ?? null,
      createdAt: new Date(row.created_at).toISOString()
    }));
  };

  return { listDays, listByDay };
};

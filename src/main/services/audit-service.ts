import type { Kysely } from 'kysely';
import type { Database } from '../../backend/db/schema.js';

export const createAuditService = (db: Kysely<Database>) => ({
  async log(action: string, entityType: string, entityId: string, details?: unknown, userId?: number | null) {
    await db
      .insertInto('audit_logs')
      .values({
        action,
        entity_type: entityType,
        entity_id: entityId,
        details_json: details ? JSON.stringify(details) : null,
        user_id: userId ?? null
      })
      .execute();
  }
});

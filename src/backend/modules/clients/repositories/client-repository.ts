import type { Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';

export const createClientRepository = (db: Kysely<Database>) => ({
  list: () => db.selectFrom('clients').selectAll().orderBy('id desc').execute(),
  findById: (id: number) => db.selectFrom('clients').selectAll().where('id', '=', id).executeTakeFirst(),
  count: () => db.selectFrom('clients').select((eb) => eb.fn.count<number>('id').as('count')).executeTakeFirstOrThrow(),
  update: (id: number, values: Record<string, unknown>) => db.updateTable('clients').set(values as never).where('id', '=', id).executeTakeFirstOrThrow(),
  delete: (id: number) => db.deleteFrom('clients').where('id', '=', id).executeTakeFirstOrThrow()
});

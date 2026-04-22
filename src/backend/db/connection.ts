import { Kysely, MysqlDialect } from 'kysely';
import mysql from 'mysql2';
import type { Database } from './schema.js';
import type { DbConnectionConfig } from '../../shared/types.js';

export const createDb = (config: DbConnectionConfig) => new Kysely<Database>({
  dialect: new MysqlDialect({
    pool: mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? {} : undefined,
      decimalNumbers: true,
      connectionLimit: 10,
      timezone: '-05:00'
    })
  })
});

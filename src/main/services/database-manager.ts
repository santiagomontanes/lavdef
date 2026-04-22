import mysql from 'mysql2/promise';
import type { Kysely } from 'kysely';
import { createDb } from '../../backend/db/connection.js';
import { runMigrations } from '../../backend/db/migrator.js';
import type { Database } from '../../backend/db/schema.js';
import type { DbConnectionConfig, HealthStatus } from '../../shared/types.js';

const ElectronStore = require('electron-store').default;
const store = new ElectronStore({
  name: 'lavanderia-settings'
}) as any;

class DatabaseManager {
  private db: Kysely<Database> | null = null;

  getConfig() {
    return store.get('dbConfig');
  }

  async saveConfig(config: DbConnectionConfig) {
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? {} : undefined
    });
    await connection.ping();
    await connection.end();
    store.set('dbConfig', config);
    this.db = null;
  }

  async getDb() {
    if (this.db) return this.db;
    const config = this.getConfig();
    if (!config) throw new Error('La base de datos no está configurada.');
    this.db = createDb(config);
    return this.db;
  }

  async migrate() {
    const db = await this.getDb();
    await runMigrations(db);
  }

  async healthCheck(): Promise<HealthStatus> {
    const config = this.getConfig();
    if (!config) {
      return { configured: false, connected: false, migrated: false, message: 'Configura la conexión MySQL para iniciar.' };
    }

    try {
      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl ? {} : undefined
      });
      await connection.ping();
      await connection.end();
    } catch (error) {
      return {
        configured: true,
        connected: false,
        migrated: false,
        message: error instanceof Error ? error.message : 'No fue posible conectar.'
      };
    }

    try {
      await this.migrate();
      return { configured: true, connected: true, migrated: true, message: 'Conexión y migraciones listas.' };
    } catch (error) {
      return {
        configured: true,
        connected: false,
        migrated: false,
        message: 'La conexión MySQL existe, pero no se pudo preparar el esquema de la aplicación.'
      };
    }
  }
}

export const databaseManager = new DatabaseManager();

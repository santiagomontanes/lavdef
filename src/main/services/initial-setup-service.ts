import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createDb } from '../../backend/db/connection.js';
import { databaseManager } from './database-manager.js';

import type {
  DbConnectionConfig,
  SetupCreateDatabaseResult,
  SetupFinalizeInput,
  SetupFinalizeResult,
  SetupInitializeProgress,
  SetupInitializeSchemaResult,
  SetupRootConnectionInput
} from '../../shared/types.js';

const SCHEMA_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

class InitialSetupService {
  private splitStatements(sqlContent: string) {
    return sqlContent
      .split(/;\s*\n/g)
      .map((statement) => statement.trim())
      .filter(Boolean);
  }

  private normalizeRootConfig(input: SetupRootConnectionInput) {
    return {
      host: input.host.trim(),
      port: Number(input.port),
      user: input.user.trim(),
      password: input.password,
      databaseName: input.databaseName.trim(),
      ssl: Boolean(input.ssl)
    };
  }

  private validateIdentifier(value: string, label: string) {
    const trimmed = value.trim();

    if (!trimmed) {
      throw new Error(`Debes indicar ${label}.`);
    }

    if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
      throw new Error(
        `${label} solo puede contener letras, números y guion bajo.`
      );
    }

    return trimmed;
  }

  private escapeIdentifier(value: string) {
    return `\`${value.replace(/`/g, '``')}\``;
  }

  private getMigrationsDir() {
    const packagedPath = path.join(process.resourcesPath, 'sql', 'migrations');
    const devPath = path.join(app.getAppPath(), 'src', 'backend', 'db', 'migrations');

    if (app.isPackaged && fs.existsSync(packagedPath)) {
      return packagedPath;
    }

    if (fs.existsSync(devPath)) {
      return devPath;
    }

    if (fs.existsSync(packagedPath)) {
      return packagedPath;
    }

    throw new Error('No se encontró la carpeta de scripts SQL de inicialización.');
  }

  private getMigrationFiles() {
    return fs
      .readdirSync(this.getMigrationsDir())
      .filter((name) => name.endsWith('.sql'))
      .sort();
  }

  private async columnExists(
    connection: mysql.Connection,
    databaseName: string,
    tableName: string,
    columnName: string
  ) {
    const [rows] = await connection.query(
      `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name = ?
          AND column_name = ?
        LIMIT 1
      `,
      [databaseName, tableName, columnName]
    );

    return Array.isArray(rows) && rows.length > 0;
  }

  private async executeStatement(
    connection: mysql.Connection,
    databaseName: string,
    statement: string
  ) {
    const trimmed = statement.trim();

    if (!trimmed) {
      return;
    }

    const alterTableMatch = trimmed.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+/i);

    if (alterTableMatch && /ADD COLUMN IF NOT EXISTS/i.test(trimmed)) {
      const tableName = alterTableMatch[1];
      const prefix = alterTableMatch[0];
      const body = trimmed.slice(prefix.length);
      const columnClauses = body.split(/,\s*(?=ADD COLUMN IF NOT EXISTS\s+)/i);

      for (const clause of columnClauses) {
        const columnClause = clause.trim();
        const definition = columnClause.replace(/^ADD COLUMN IF NOT EXISTS\s+/i, '');
        const columnMatch = definition.match(/^`?([A-Za-z0-9_]+)`?\s+/);

        if (!columnMatch) {
          throw new Error(`No se pudo interpretar la definición de columna: ${columnClause}`);
        }

        const columnName = columnMatch[1];
        const exists = await this.columnExists(connection, databaseName, tableName, columnName);

        if (exists) {
          continue;
        }

        await connection.query(
          `${prefix}ADD COLUMN ${definition}`
        );
      }

      return;
    }

    await connection.query(trimmed);
  }

  private async createRootConnection(input: SetupRootConnectionInput) {
    const root = this.normalizeRootConfig(input);

    return mysql.createConnection({
      host: root.host,
      port: root.port,
      user: root.user,
      password: root.password,
      ssl: root.ssl ? {} : undefined,
      multipleStatements: true
    });
  }

  private async getPreferredCollation(connection: mysql.Connection) {
    const [rows] = await connection.query('SELECT VERSION() AS version');
    const version = Array.isArray(rows) ? String((rows[0] as any)?.version ?? '') : '';

    return version.includes('MariaDB')
      ? 'utf8mb4_unicode_ci'
      : 'utf8mb4_0900_ai_ci';
  }

  private async createDatabaseConnection(input: SetupRootConnectionInput) {
    const root = this.normalizeRootConfig(input);

    return mysql.createConnection({
      host: root.host,
      port: root.port,
      user: root.user,
      password: root.password,
      database: root.databaseName,
      ssl: root.ssl ? {} : undefined,
      multipleStatements: true
    });
  }

  async createDatabase(input: SetupRootConnectionInput): Promise<SetupCreateDatabaseResult> {
    const root = this.normalizeRootConfig(input);
    const databaseName = this.validateIdentifier(root.databaseName, 'el nombre de la base de datos');

    const connection = await this.createRootConnection({
      ...root,
      databaseName
    });

    try {
      await connection.ping();
      const collation = await this.getPreferredCollation(connection);
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS ${this.escapeIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE ${collation}`
      );

      return {
        success: true,
        databaseName,
        message: `Base de datos ${databaseName} lista para inicialización.`
      };
    } finally {
      await connection.end();
    }
  }

  async initializeSchema(
    input: SetupRootConnectionInput,
    onProgress?: (progress: SetupInitializeProgress) => void
  ): Promise<SetupInitializeSchemaResult> {
    const root = this.normalizeRootConfig(input);
    const databaseName = this.validateIdentifier(root.databaseName, 'el nombre de la base de datos');
    const connection = await this.createDatabaseConnection({
      ...root,
      databaseName
    });
    const migrationFiles = this.getMigrationFiles();
    const migrationsDir = this.getMigrationsDir();
    const executedFiles: string[] = [];

    try {
      await connection.query(SCHEMA_MIGRATIONS_TABLE_SQL);

      const [rows] = await connection.query(
        'SELECT name FROM schema_migrations ORDER BY name'
      );
      const applied = new Set(
        Array.isArray(rows)
          ? rows.map((row: any) => String(row.name))
          : []
      );

      for (const file of migrationFiles) {
        const current = executedFiles.length + 1;
        const progressBase = {
          current,
          total: migrationFiles.length,
          percent: Math.round((current / migrationFiles.length) * 100),
          file
        };

        onProgress?.({
          ...progressBase,
          status: 'running',
          message: `Ejecutando ${file}...`
        });

        if (applied.has(file)) {
          executedFiles.push(file);
          onProgress?.({
            ...progressBase,
            status: 'completed',
            message: `${file} ya estaba aplicado.`
          });
          continue;
        }

        const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const statements = this.splitStatements(sqlContent);

        for (const statement of statements) {
          await this.executeStatement(connection, databaseName, statement);
        }

        await connection.query(
          'INSERT IGNORE INTO schema_migrations (name) VALUES (?)',
          [file]
        );
        executedFiles.push(file);
        onProgress?.({
          ...progressBase,
          status: 'completed',
          message: `${file} ejecutado correctamente.`
        });
      }

      return {
        success: true,
        databaseName,
        executedFiles,
        message: 'Esquema inicial ejecutado correctamente.'
      };
    } finally {
      await connection.end();
    }
  }

  async finalizeSetup(input: SetupFinalizeInput): Promise<SetupFinalizeResult> {
    const root = this.normalizeRootConfig(input.root);
    const databaseName = this.validateIdentifier(root.databaseName, 'el nombre de la base de datos');
    const mysqlAppUsername = this.validateIdentifier(
      input.appUser.username,
      'el usuario MySQL de la aplicación'
    );

    if (!input.appUser.password.trim()) {
      throw new Error('Debes indicar la contraseña del usuario MySQL de la aplicación.');
    }

    const validateAppUser = (
      user: { username: string; password: string; fullName: string },
      label: string
    ) => {
      if (!user.username.trim()) throw new Error(`Debes indicar el username del ${label}.`);
      if (!user.password.trim()) throw new Error(`Debes indicar la contraseña del ${label}.`);
      if (!user.fullName.trim()) throw new Error(`Debes indicar el nombre completo del ${label}.`);
    };

    validateAppUser(input.adminUser, 'Administrador');
    validateAppUser(input.sellerUser, 'Vendedor');

    const rootConnection = await this.createDatabaseConnection({
      ...root,
      databaseName
    });

    const appConfig: DbConnectionConfig = {
      host: root.host,
      port: root.port,
      database: databaseName,
      user: mysqlAppUsername,
      password: input.appUser.password,
      ssl: root.ssl
    };

    try {
      await rootConnection.query(
        `CREATE USER IF NOT EXISTS '${mysqlAppUsername}'@'%' IDENTIFIED BY ?`,
        [input.appUser.password]
      );
      await rootConnection.query(
        `ALTER USER '${mysqlAppUsername}'@'%' IDENTIFIED BY ?`,
        [input.appUser.password]
      );
      await rootConnection.query(
        `GRANT ALL PRIVILEGES ON ${this.escapeIdentifier(databaseName)}.* TO '${mysqlAppUsername}'@'%'`
      );
      await rootConnection.query('FLUSH PRIVILEGES');
    } finally {
      await rootConnection.end();
    }

    await databaseManager.saveConfig(appConfig);

    const appDb = createDb(appConfig);

    try {
      const adminHash = await bcrypt.hash(input.adminUser.password, 10);
      const sellerHash = await bcrypt.hash(input.sellerUser.password, 10);

      await appDb
        .insertInto('users')
        .values({
          role_id: 1,
          username: input.adminUser.username.trim(),
          password_hash: adminHash,
          full_name: input.adminUser.fullName.trim(),
          is_active: 1,
          branch_id: null
        })
        .onDuplicateKeyUpdate({
          role_id: 1,
          password_hash: adminHash,
          full_name: input.adminUser.fullName.trim(),
          is_active: 1
        })
        .execute();

      await appDb
        .insertInto('users')
        .values({
          role_id: 2,
          username: input.sellerUser.username.trim(),
          password_hash: sellerHash,
          full_name: input.sellerUser.fullName.trim(),
          is_active: 1,
          branch_id: null
        })
        .onDuplicateKeyUpdate({
          role_id: 2,
          password_hash: sellerHash,
          full_name: input.sellerUser.fullName.trim(),
          is_active: 1
        })
        .execute();
    } finally {
      await appDb.destroy();
    }

    return {
      success: true,
      message: 'Configuración inicial completada. Ya puedes iniciar sesión.',
      connection: appConfig
    };
  }
}

export const initialSetupService = new InitialSetupService();

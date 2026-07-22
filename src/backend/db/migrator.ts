import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { sql, type Kysely } from 'kysely';
import type { Database } from './schema.js';
import { diagnosticLogger } from '../../main/services/diagnostic-logger.js';

const getMigrationsDir = () => {
  const packagedPath = path.join(process.resourcesPath, 'sql', 'migrations');
  const distPath = path.join(__dirname, 'migrations');
  const appRootPath = app.getAppPath();
  const devPath = path.join(appRootPath, 'src', 'backend', 'db', 'migrations');

  if (app.isPackaged && fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  if (fs.existsSync(devPath)) {
    return devPath;
  }

  if (fs.existsSync(distPath)) {
    return distPath;
  }

  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  throw new Error('No se encontró la carpeta de migraciones SQL.');
};

const splitStatements = (content: string) =>
  content
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);

const statementIsSafeIfExists = (statement: string) =>
  SAFE_IF_EXISTS_MARKER.test(statement);

const extractDatabaseName = async (db: Kysely<Database>) => {
  const result = await sql<{ databaseName: string }>`
    SELECT DATABASE() AS databaseName
  `.execute(db);

  return String(result.rows[0]?.databaseName ?? '');
};

const columnExists = async (
  db: Kysely<Database>,
  databaseName: string,
  tableName: string,
  columnName: string
) => {
  const result = await sql<{ found: number }>`
    SELECT 1 AS found
    FROM information_schema.columns
    WHERE table_schema = ${databaseName}
      AND table_name = ${tableName}
      AND column_name = ${columnName}
    LIMIT 1
  `.execute(db);

  return result.rows.length > 0;
};

// MySQL "already exists" errors we tolerate as no-ops when re-running an
// idempotent DDL statement. The migrator deliberately swallows them so a
// migration file can declare CREATE INDEX / ADD UNIQUE without ad-hoc
// information_schema gymnastics; if the object is already there we just
// move on. This is only enabled for statements explicitly tagged with the
// `-- @safe-if-exists` comment marker on the line directly above, to avoid
// hiding genuine mistakes in unrelated migrations.
const SAFE_IF_EXISTS_MARKER = /--\s*@safe-if-exists/i;
const SAFE_ALREADY_EXISTS_CODES = new Set([
  'ER_DUP_KEYNAME',     // Duplicate key name (index already exists)
  'ER_DUP_ENTRY',       // Duplicate entry (when adding UNIQUE on existing data covered separately)
  'ER_TABLE_EXISTS_ERROR',
  'ER_MULTIPLE_PRI_KEY'
]);

const isAlreadyExistsError = (err: unknown) => {
  const code = (err as { code?: string } | null)?.code ?? '';
  if (SAFE_ALREADY_EXISTS_CODES.has(code)) return true;
  const message = String((err as { message?: string } | null)?.message ?? '').toLowerCase();
  return (
    message.includes('duplicate key name') ||
    message.includes('already exists') ||
    message.includes('multiple primary key')
  );
};

const executeStatement = async (
  db: Kysely<Database>,
  databaseName: string,
  statement: string,
  safeIfExists = false
) => {
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
      const exists = await columnExists(db, databaseName, tableName, columnName);

      if (exists) {
        continue;
      }

      await sql.raw(`${prefix}ADD COLUMN ${definition}`).execute(db);
    }

    return;
  }

  try {
    await sql.raw(trimmed).execute(db);
  } catch (err) {
    if (safeIfExists && isAlreadyExistsError(err)) {
      return;
    }
    throw err;
  }
};

export const runMigrations = async (db: Kysely<Database>) => {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  const applied = await db.selectFrom('schema_migrations').select('name').execute();
  const appliedSet = new Set(applied.map((item) => item.name));
  const migrationsDir = getMigrationsDir();
  const files = (await fsPromises.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const databaseName = await extractDatabaseName(db);

  const pendingFiles = files.filter((file) => !appliedSet.has(file));

  diagnosticLogger.info('migrator', 'Iniciando ciclo de migraciones', {
    migrationsDir,
    totalFiles: files.length,
    appliedCount: appliedSet.size,
    pendingFiles
  });

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    diagnosticLogger.info('migrator', `Aplicando migración ${file}`);

    const content = await fsPromises.readFile(path.join(migrationsDir, file), 'utf8');
    const statements = splitStatements(content);

    try {
      for (const statement of statements) {
        await executeStatement(
          db,
          databaseName,
          statement,
          statementIsSafeIfExists(statement)
        );
      }

      await db.insertInto('schema_migrations').values({ name: file }).execute();
      diagnosticLogger.info('migrator', `Migración ${file} aplicada correctamente`);
    } catch (err) {
      diagnosticLogger.error('migrator', `Falló la migración ${file}`, {
        message: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  diagnosticLogger.info('migrator', 'Ciclo de migraciones finalizado');
};

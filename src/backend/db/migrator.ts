import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { sql, type Kysely } from 'kysely';
import type { Database } from './schema.js';

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

const executeStatement = async (
  db: Kysely<Database>,
  databaseName: string,
  statement: string
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

  await sql.raw(trimmed).execute(db);
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

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const content = await fsPromises.readFile(path.join(migrationsDir, file), 'utf8');
    const statements = splitStatements(content);

    for (const statement of statements) {
      await executeStatement(db, databaseName, statement);
    }

    await db.insertInto('schema_migrations').values({ name: file }).execute();
  }
};

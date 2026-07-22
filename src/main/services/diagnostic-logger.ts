import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Logger ligero de diagnóstico para producción. Escribe a un archivo
// rotado por día en %APPDATA%/<productName>/logs/. Pensado para que el
// cliente nos comparta el log cuando algo falla en el EXE empaquetado
// (en desarrollo ya tenemos la consola). NUNCA debe interrumpir el
// flujo normal: cualquier error de E/S se traga y opcionalmente se
// imprime a stderr.

const LOG_DIR_NAME = 'logs';

let cachedLogDir: string | null = null;
let warnedMissingDir = false;

const resolveLogDir = (): string | null => {
  if (cachedLogDir) return cachedLogDir;

  try {
    const userData = app.getPath('userData');
    const dir = path.join(userData, LOG_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    cachedLogDir = dir;
    return dir;
  } catch (err) {
    if (!warnedMissingDir) {
      warnedMissingDir = true;
      // No usamos el logger acá para evitar recursión.
      // eslint-disable-next-line no-console
      console.warn('diagnostic-logger: no fue posible crear el directorio de logs', err);
    }
    return null;
  }
};

const todaysFileName = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `app-${y}-${m}-${d}.log`;
};

const formatLine = (level: string, scope: string, message: string, meta?: unknown) => {
  const ts = new Date().toISOString();
  const metaStr = meta === undefined
    ? ''
    : ` ${typeof meta === 'string' ? meta : safeStringify(meta)}`;
  return `[${ts}] [${level}] [${scope}] ${message}${metaStr}\n`;
};

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const write = (level: string, scope: string, message: string, meta?: unknown) => {
  const dir = resolveLogDir();
  if (!dir) return;

  try {
    fs.appendFileSync(path.join(dir, todaysFileName()), formatLine(level, scope, message, meta), 'utf8');
  } catch {
    // E/S del log nunca rompe el flujo.
  }
};

export const diagnosticLogger = {
  info: (scope: string, message: string, meta?: unknown) => write('INFO', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => write('WARN', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => write('ERROR', scope, message, meta),
  getLogDir: () => resolveLogDir(),
  getCurrentLogPath: () => {
    const dir = resolveLogDir();
    return dir ? path.join(dir, todaysFileName()) : null;
  }
};

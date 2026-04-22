import fs from 'node:fs';
import { app } from 'electron';
import type { RuntimeCheck, RuntimeDiagnostics } from '../../shared/types.js';
import {
  firstExistingPath,
  resolvePackagedResourcePath,
  resolveProjectPath
} from '../utils/runtime-paths.js';

const resolvePrinterModulePath = () => {
  try {
    return require.resolve('@alexssmusica/node-printer');
  } catch {
    return null;
  }
};

const checkMysqldump = (): RuntimeCheck => {
  const resolvedPath = firstExistingPath([
    resolvePackagedResourcePath('bin', 'mysqldump.exe'),
    resolveProjectPath('resources', 'bin', 'mysqldump.exe'),
    resolvePackagedResourcePath('bin', 'mysqldump'),
    resolveProjectPath('resources', 'bin', 'mysqldump')
  ]);

  if (resolvedPath) {
    return {
      key: 'mysqldump',
      status: 'ok',
      message: 'mysqldump disponible para backups SQL.',
      resolvedPath,
      required: true
    };
  }

  return {
    key: 'mysqldump',
    status: 'error',
    message: 'mysqldump no está disponible. El backup SQL fallará.',
    resolvedPath: null,
    required: true
  };
};

const checkGoogleOauth = (): RuntimeCheck => {
  const resolvedPath = firstExistingPath([
    resolvePackagedResourcePath('runtime', 'google-oauth.json'),
    resolvePackagedResourcePath('google-oauth.json'),
    resolveProjectPath('resources', 'runtime', 'google-oauth.json'),
    resolveProjectPath('google-oauth.json')
  ]);

  if (!resolvedPath) {
    return {
      key: 'google_oauth',
      status: 'warning',
      message: 'google-oauth.json no existe. Google Drive backup quedará deshabilitado.',
      resolvedPath: null,
      required: false
    };
  }

  try {
    JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    return {
      key: 'google_oauth',
      status: 'ok',
      message: 'google-oauth.json disponible.',
      resolvedPath,
      required: false
    };
  } catch {
    return {
      key: 'google_oauth',
      status: 'error',
      message: 'google-oauth.json existe pero no es JSON válido.',
      resolvedPath,
      required: false
    };
  }
};

const checkPrinterModule = (): RuntimeCheck => {
  const resolvedPath = resolvePrinterModulePath();

  if (process.platform !== 'win32') {
    return {
      key: 'node_printer',
      status: 'warning',
      message: 'node-printer se usa solo en Windows.',
      resolvedPath,
      required: false
    };
  }

  if (!resolvedPath) {
    return {
      key: 'node_printer',
      status: 'error',
      message: 'No se encontró @alexssmusica/node-printer para impresión/cajón.',
      resolvedPath: null,
      required: true
    };
  }

  return {
    key: 'node_printer',
    status: 'ok',
    message: 'Módulo nativo de impresión detectado.',
    resolvedPath,
    required: true
  };
};

export const getRuntimeDiagnostics = (): RuntimeDiagnostics => ({
  platform: process.platform,
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
  checks: [checkMysqldump(), checkGoogleOauth(), checkPrinterModule()]
});

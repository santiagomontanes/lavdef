import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { shell } from 'electron';
import { google } from 'googleapis';
import { databaseManager } from './database-manager.js';
import {
  firstExistingPath,
  resolveDevPath,
  resolvePackagedResourcePath
} from '../utils/runtime-paths.js';

const execAsync = promisify(exec);

const GOOGLE_REDIRECT_URI = 'http://127.0.0.1:3017/oauth2callback';
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const isAuthError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (msg.includes('invalid_grant') || msg.includes('token has been expired') || msg.includes('token_expired')) return true;
  const anyErr = error as any;
  const status = anyErr?.status ?? anyErr?.code ?? anyErr?.response?.status;
  if (status === 401 || status === '401') return true;
  const responseError = anyErr?.response?.data?.error;
  if (responseError === 'invalid_grant') return true;
  return false;
};

class BackupService {
  private async resolveCommand(command: string) {
    const lookupCommand =
      process.platform === 'win32' ? `where ${command}` : `command -v ${command}`;

    try {
      const { stdout } = await execAsync(lookupCommand);
      const firstPath = stdout
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .find(Boolean);

      return firstPath ?? null;
    } catch {
      return null;
    }
  }

  private getGoogleCredentialsPath() {
    const targetPath = firstExistingPath([
      resolvePackagedResourcePath('runtime', 'google-oauth.json'),
      resolvePackagedResourcePath('google-oauth.json'),
      resolveDevPath('resources', 'runtime', 'google-oauth.json'),
      resolveDevPath('google-oauth.json')
    ]);

    if (targetPath) return targetPath;

    throw new Error(
      'No existe google-oauth.json. Debe estar en resources/runtime/google-oauth.json, en la raíz del proyecto o empaquetado en resources/runtime.'
    );
  }

  private getOAuthClient() {
    const credentialsPath = this.getGoogleCredentialsPath();
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    const installed = credentials.installed || credentials.web;

    if (!installed?.client_id || !installed?.client_secret) {
      throw new Error('El archivo google-oauth.json no es válido.');
    }

    return new google.auth.OAuth2(
      installed.client_id,
      installed.client_secret,
      GOOGLE_REDIRECT_URI
    );
  }

  private async getMysqldumpPath() {
    const bundledPath = firstExistingPath([
      resolvePackagedResourcePath('bin', 'mysqldump.exe'),
      resolveDevPath('resources', 'bin', 'mysqldump.exe'),
      resolvePackagedResourcePath('bin', 'mysqldump'),
      resolveDevPath('resources', 'bin', 'mysqldump')
    ]);

    if (bundledPath) return bundledPath;

    const systemPath = await this.resolveCommand('mysqldump');

    if (systemPath) {
      return systemPath;
    }

    throw new Error(
      'No se encontró mysqldump. En Windows puedes empaquetarlo en resources/bin/mysqldump.exe y en macOS debes tener mysqldump instalado o disponible en PATH.'
    );
  }

  private async getTokenRow(userId?: number) {
    const db = await databaseManager.getDb();

    if (typeof userId === 'number') {
      return db
        .selectFrom('google_drive_tokens')
        .selectAll()
        .where('user_id', '=', userId)
        .orderBy('id desc')
        .executeTakeFirst();
    }

    return db
      .selectFrom('google_drive_tokens')
      .selectAll()
      .where('user_id', 'is', null)
      .orderBy('id desc')
      .executeTakeFirst();
  }

  private async getExistingTokenId(userId?: number) {
    const db = await databaseManager.getDb();

    if (typeof userId === 'number') {
      return db
        .selectFrom('google_drive_tokens')
        .select(['id'])
        .where('user_id', '=', userId)
        .executeTakeFirst();
    }

    return db
      .selectFrom('google_drive_tokens')
      .select(['id'])
      .where('user_id', 'is', null)
      .executeTakeFirst();
  }

  private async tryRefreshToken(
    oAuth2Client: ReturnType<BackupService['getOAuthClient']>,
    userId?: number
  ): Promise<boolean> {
    try {
      const { credentials } = await oAuth2Client.refreshAccessToken();
      oAuth2Client.setCredentials(credentials);

      const db = await databaseManager.getDb();
      const updates: Record<string, unknown> = {
        access_token: credentials.access_token ?? null,
        expiry_date: credentials.expiry_date ?? null
      };
      if (credentials.refresh_token) updates.refresh_token = credentials.refresh_token;

      if (typeof userId === 'number') {
        await db.updateTable('google_drive_tokens').set(updates as any).where('user_id', '=', userId).execute();
      } else {
        await db.updateTable('google_drive_tokens').set(updates as any).where('user_id', 'is', null).execute();
      }
      return true;
    } catch {
      return false;
    }
  }

  private async clearAllTokens(): Promise<void> {
    const db = await databaseManager.getDb();
    await db.deleteFrom('google_drive_tokens').execute();
  }

  private async withTokenRetry<T>(
    userId: number | undefined,
    operation: (auth: ReturnType<BackupService['getOAuthClient']>) => Promise<T>,
    onProgress?: (status: 'refreshing') => void
  ): Promise<T> {
    const auth = await this.getAuthorizedClient(userId);
    try {
      return await operation(auth);
    } catch (firstError) {
      if (!isAuthError(firstError)) throw firstError;

      onProgress?.('refreshing');

      const refreshed = await this.tryRefreshToken(auth, userId);
      if (!refreshed) {
        await this.clearAllTokens();
        throw new Error(
          'REAUTH_REQUIRED: Tu conexión con Google Drive expiró. Por favor haz clic en "Conectar Google Drive" para reconectar.'
        );
      }

      return await operation(auth);
    }
  }

  async connectDrive(userId?: number) {
    const db = await databaseManager.getDb();
    const oAuth2Client = this.getOAuthClient();

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES
    });

    const tokens = await new Promise<any>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || '', GOOGLE_REDIRECT_URI);

          if (reqUrl.pathname !== '/oauth2callback') {
            res.statusCode = 404;
            res.end('Ruta no encontrada');
            return;
          }

          const code = reqUrl.searchParams.get('code');

          if (!code) {
            res.statusCode = 400;
            res.end('No se recibió código de autorización.');
            return;
          }

          const tokenResponse = await oAuth2Client.getToken(code);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end('<h2>Google Drive conectado correctamente. Puedes cerrar esta ventana.</h2>');

          server.close();
          resolve(tokenResponse.tokens);
        } catch (error) {
          server.close();
          reject(error);
        }
      });

      server.listen(3017, '127.0.0.1', async () => {
        await shell.openExternal(authUrl);
      });
    });

    const existing = await this.getExistingTokenId(userId);

    if (existing) {
      await db
        .updateTable('google_drive_tokens')
        .set({
          access_token: tokens.access_token ?? null,
          refresh_token: tokens.refresh_token ?? null,
          scope: tokens.scope ?? null,
          token_type: tokens.token_type ?? null,
          expiry_date: tokens.expiry_date ?? null
        })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db
        .insertInto('google_drive_tokens')
        .values({
          user_id: typeof userId === 'number' ? userId : null,
          access_token: tokens.access_token ?? null,
          refresh_token: tokens.refresh_token ?? null,
          scope: tokens.scope ?? null,
          token_type: tokens.token_type ?? null,
          expiry_date: tokens.expiry_date ?? null
        })
        .execute();
    }

    return {
      success: true,
      message: 'Google Drive conectado correctamente.'
    };
  }

  private async getAuthorizedClient(userId?: number) {
    const token = await this.getTokenRow(userId);

    if (!token?.refresh_token && !token?.access_token) {
      throw new Error('Primero debes conectar Google Drive.');
    }

    const oAuth2Client = this.getOAuthClient();

    oAuth2Client.setCredentials({
      access_token: token.access_token ?? undefined,
      refresh_token: token.refresh_token ?? undefined,
      scope: token.scope ?? undefined,
      token_type: token.token_type ?? undefined,
      expiry_date: token.expiry_date ?? undefined
    });

    return oAuth2Client;
  }

  async createSqlBackup() {
    const config = databaseManager.getConfig();

    if (!config) {
      throw new Error('La base de datos no está configurada.');
    }

    const mysqldumpPath = await this.getMysqldumpPath();

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(
      now.getMinutes()
    ).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

    const fileName = `backup_${config.database}_${stamp}.sql`;
    const filePath = path.join(os.tmpdir(), fileName);

    await new Promise<void>((resolve, reject) => {
      const dumpProcess = spawn(
        mysqldumpPath,
        [
          '-h',
          config.host,
          '-P',
          String(config.port),
          '-u',
          config.user,
          `-p${config.password}`,
          config.database
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );

      const output = fs.createWriteStream(filePath);
      let stderr = '';

      dumpProcess.stdout.pipe(output);
      dumpProcess.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      dumpProcess.on('error', (error) => {
        output.destroy();
        reject(error);
      });

      dumpProcess.on('close', (code) => {
        output.end();

        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr.trim() || 'No se pudo ejecutar mysqldump.'));
      });
    });

    if (!fs.existsSync(filePath)) {
      throw new Error('No se pudo generar el archivo de backup.');
    }

    return { fileName, filePath };
  }

  async uploadBackupToDrive(
    userId?: number,
    onProgress?: (status: 'refreshing') => void
  ) {
    const db = await databaseManager.getDb();
    const { fileName, filePath } = await this.createSqlBackup();

    const createdBackup = await db
      .insertInto('backups')
      .values({
        file_name: fileName,
        status: 'UPLOADING',
        message: 'Subiendo backup a Google Drive'
      })
      .executeTakeFirstOrThrow();

    try {
      const response = await this.withTokenRetry(
        userId,
        async (auth) => {
          const drive = google.drive({ version: 'v3', auth });
          return drive.files.create({
            requestBody: { name: fileName },
            media: { mimeType: 'application/sql', body: fs.createReadStream(filePath) },
            fields: 'id,name'
          });
        },
        onProgress
      );

      await db
        .updateTable('backups')
        .set({
          drive_file_id: response.data.id ?? null,
          status: 'DONE',
          message: 'Backup subido correctamente'
        })
        .where('id', '=', Number(createdBackup.insertId))
        .execute();

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      return {
        success: true,
        fileName,
        driveFileId: response.data.id ?? null,
        message: 'Backup subido correctamente a Google Drive.'
      };
    } catch (error) {
      const displayMessage = error instanceof Error
        ? error.message.replace(/^REAUTH_REQUIRED:\s*/, '')
        : 'Error subiendo backup';

      await db
        .updateTable('backups')
        .set({ status: 'ERROR', message: displayMessage })
        .where('id', '=', Number(createdBackup.insertId))
        .execute();

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      throw error;
    }
  }

  async listBackups() {
    const db = await databaseManager.getDb();

    const rows = await db
      .selectFrom('backups')
      .selectAll()
      .orderBy('id desc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      file_name: row.file_name,
      drive_file_id: row.drive_file_id,
      status: row.status,
      message: row.message,
      created_at: new Date(row.created_at).toISOString()
    }));
  }
}

export const backupService = new BackupService();

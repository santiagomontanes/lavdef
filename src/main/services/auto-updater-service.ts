import { app, BrowserWindow, dialog } from 'electron'
import type { MessageBoxOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import { mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs'
import path from 'node:path'

// Estado consolidado que se transmite al renderer por IPC para que la UI
// pueda mostrar "buscando", "descargando 32 %", "lista para instalar", etc.
export type AutoUpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'not-available'; currentVersion: string }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }
  | { phase: 'disabled-in-dev' }

let currentStatus: AutoUpdateStatus = { phase: 'idle' }
let updatePromptOpen = false
let listenersRegistered = false
let mainWindowRef: BrowserWindow | null = null
let periodicTimer: NodeJS.Timeout | null = null

// Logger persistente a userData/logs/auto-update.log. No depende de
// electron-log para no añadir dependencias; se rota por tamaño en cuanto
// el archivo supera 1 MB para evitar crecer indefinidamente.
const getLogDir = () => {
  const dir = path.join(app.getPath('userData'), 'logs')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // ignore: si no se puede crear, fallback a console
  }
  return dir
}

const getLogPath = () => path.join(getLogDir(), 'auto-update.log')

const rotateIfTooBig = (file: string) => {
  try {
    const { size } = statSync(file)
    if (size > 1_000_000) {
      renameSync(file, `${file}.1`)
    }
  } catch {
    // ignore: archivo aún no existe
  }
}

const writeLog = (level: 'info' | 'warn' | 'error', message: string, payload?: unknown) => {
  const ts = new Date().toISOString()
  const detail = payload === undefined ? '' : ` ${safeStringify(payload)}`
  const line = `[${ts}] ${level.toUpperCase()} ${message}${detail}\n`
  try {
    const file = getLogPath()
    rotateIfTooBig(file)
    appendFileSync(file, line, 'utf8')
  } catch (err) {
    // Si la escritura falla, no podemos hacer mucho más que console.
    console.error('No fue posible escribir auto-update.log:', err)
  }
  if (level === 'error') console.error(`[auto-update] ${message}`, payload ?? '')
  else if (level === 'warn') console.warn(`[auto-update] ${message}`, payload ?? '')
  else console.log(`[auto-update] ${message}`, payload ?? '')
}

const safeStringify = (value: unknown) => {
  try {
    if (value instanceof Error) {
      return JSON.stringify({ message: value.message, stack: value.stack })
    }
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const setStatus = (status: AutoUpdateStatus) => {
  currentStatus = status
  writeLog('info', 'status', status)
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('app:update-status', status)
  }
}

export const getCurrentAutoUpdateStatus = (): AutoUpdateStatus => currentStatus

const promptForDownloadedUpdate = async (version: string) => {
  if (updatePromptOpen) return
  updatePromptOpen = true

  try {
    const dialogOptions: MessageBoxOptions = {
      type: 'info',
      buttons: ['Instalar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Actualización lista',
      message: `Hay una actualización lista (versión ${version}).`,
      detail:
        'Si eliges "Más tarde", podrás seguir usando el programa sin que esta actualización te afecte ahora.'
    }
    const result =
      mainWindowRef && !mainWindowRef.isDestroyed()
        ? await dialog.showMessageBox(mainWindowRef, dialogOptions)
        : await dialog.showMessageBox(dialogOptions)

    if (result.response === 0) {
      writeLog('info', 'Usuario aceptó instalar; lanzando quitAndInstall().')
      autoUpdater.quitAndInstall()
      return
    }

    writeLog('info', 'Usuario pospuso la instalación.')
  } finally {
    updatePromptOpen = false
  }
}

const registerListeners = () => {
  if (listenersRegistered) return
  listenersRegistered = true

  autoUpdater.on('checking-for-update', () => {
    setStatus({ phase: 'checking' })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    setStatus({ phase: 'not-available', currentVersion: app.getVersion() })
    writeLog('info', 'update-not-available', info)
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setStatus({ phase: 'available', version: info.version })
    writeLog('info', 'update-available', info)
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    const version =
      currentStatus.phase === 'available' || currentStatus.phase === 'downloading'
        ? currentStatus.version
        : app.getVersion()
    setStatus({
      phase: 'downloading',
      version,
      percent: Math.round(progress.percent ?? 0),
      transferred: Math.round(progress.transferred ?? 0),
      total: Math.round(progress.total ?? 0),
      bytesPerSecond: Math.round(progress.bytesPerSecond ?? 0)
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setStatus({ phase: 'downloaded', version: info.version })
    writeLog('info', 'update-downloaded', info)
    void promptForDownloadedUpdate(info.version)
  })

  autoUpdater.on('error', (err: Error) => {
    setStatus({ phase: 'error', message: err.message ?? 'Error desconocido en autoUpdater' })
    writeLog('error', 'autoUpdater error', err)
  })
}

const isDev = () => !app.isPackaged

// Configura el autoUpdater pero NO dispara la primera verificación: eso
// se hace desde main.ts después de crear la ventana, para que el primer
// resultado pueda transmitirse al renderer ya montado.
export const setupAutoUpdater = (mainWindow: BrowserWindow) => {
  mainWindowRef = mainWindow

  if (isDev()) {
    setStatus({ phase: 'disabled-in-dev' })
    writeLog('info', 'autoUpdater deshabilitado en desarrollo (app no empacada).')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  // Logger compatible con la firma que espera electron-updater. Esto envía
  // sus mensajes internos al mismo archivo que nuestros eventos custom,
  // por lo que el cliente puede mandarnos auto-update.log y vemos TODO.
  autoUpdater.logger = {
    info: (msg: unknown) => writeLog('info', String(msg)),
    warn: (msg: unknown) => writeLog('warn', String(msg)),
    error: (msg: unknown) => writeLog('error', String(msg)),
    debug: (msg: unknown) => writeLog('info', `[debug] ${String(msg)}`)
  } as unknown as typeof autoUpdater.logger

  registerListeners()
  writeLog('info', `setupAutoUpdater listo (versión ${app.getVersion()}).`)
}

export const checkForUpdates = async (reason: 'startup' | 'periodic' | 'manual') => {
  if (isDev()) {
    setStatus({ phase: 'disabled-in-dev' })
    writeLog('info', `checkForUpdates(${reason}) ignorado en dev.`)
    return currentStatus
  }

  try {
    writeLog('info', `checkForUpdates(${reason}) — disparando verificación.`)
    await autoUpdater.checkForUpdates()
  } catch (err) {
    const error = err as Error
    setStatus({ phase: 'error', message: error.message ?? 'No fue posible verificar actualizaciones.' })
    writeLog('error', `checkForUpdates(${reason}) falló`, error)
  }
  return currentStatus
}

// Arranca la verificación inicial y programa re-checks cada 4 horas. Cuatro
// horas es agresivo para una app comercial pero el polling solo es un GET
// al feed de GitHub Releases y la app puede quedar abierta toda una jornada.
export const startAutoUpdateLoop = () => {
  if (isDev()) return

  // Espera 5 segundos para no competir con el primer render.
  setTimeout(() => {
    void checkForUpdates('startup')
  }, 5_000)

  if (periodicTimer) clearInterval(periodicTimer)
  periodicTimer = setInterval(
    () => {
      void checkForUpdates('periodic')
    },
    4 * 60 * 60 * 1000
  )
}

export const installDownloadedUpdate = () => {
  if (currentStatus.phase !== 'downloaded') {
    writeLog('warn', 'installDownloadedUpdate ignorado: no hay actualización descargada.')
    return false
  }
  writeLog('info', 'installDownloadedUpdate: lanzando quitAndInstall().')
  autoUpdater.quitAndInstall()
  return true
}

export const getAutoUpdateLogPath = () => getLogPath()

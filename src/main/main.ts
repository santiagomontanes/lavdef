import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc/register'
import { autoUpdater } from 'electron-updater'
import { syncUserPreferences } from './services/telemetry'
import { databaseManager } from './services/database-manager'
import { reconcileOrderStates } from '../backend/modules/orders/reconcile-service'
import { createReadyQueueService } from '../backend/modules/ready-queue/service'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

// Track which date we last sent the due-tomorrow notification to avoid spamming
let lastDueTomorrowDate = ''

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#edf1f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  try {
    if (isDev) {
      await mainWindow.loadURL('http://localhost:5173')
      mainWindow.webContents.openDevTools()
    } else {
      const indexPath = path.join(app.getAppPath(), 'dist', 'index.html')
      await mainWindow.loadFile(indexPath)
    }
  } catch (error) {
    console.error('Error cargando la ventana principal:', error)

    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <html>
          <body style="font-family: Arial; padding: 24px;">
            <h2>Error cargando la aplicación</h2>
            <p>Revisa la consola principal para más detalles.</p>
          </body>
        </html>
      `)}`
    )
  }
}

const runReconcile = async () => {
  try {
    const db = await databaseManager.getDb()
    const { dueTomorrow, companyName, autoProcessedCount } = await reconcileOrderStates(db)

    // OS notification for due-tomorrow: once per Colombia-day only
    if (dueTomorrow.length > 0) {
      const todayColombia = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
      if (lastDueTomorrowDate !== todayColombia) {
        lastDueTomorrowDate = todayColombia
        if (Notification.isSupported()) {
          const body = dueTomorrow.map((o) => `${o.orderNumber} – ${o.clientName}`).join('\n')
          new Notification({
            title: `⚠️ ${dueTomorrow.length} orden(es) vence(n) mañana`,
            body: body.slice(0, 300)
          }).show()
        }
      }
    }

    // Bell: READY_CHECK entries from ready_queue table
    const pendingItems = await createReadyQueueService(db).listPending()
    const pendingChecks = pendingItems
      .filter((item) => item.status === 'PENDING')
      .map((item) => ({
        queueId: item.id,
        orderId: item.orderId,
        orderNumber: item.orderNumber,
        clientName: item.clientName,
        dueDate: item.dueDate,
        type: 'READY_CHECK' as const
      }))

    // Bell: merge DUE_TOMORROW items (avoid duplicates with existing PENDING queue entries)
    const pendingOrderIds = new Set(pendingChecks.map((c) => c.orderId))
    const dueTomorrowChecks = dueTomorrow
      .filter((dt) => !pendingOrderIds.has(dt.orderId))
      .map((dt) => ({
        queueId: 0,
        orderId: dt.orderId,
        orderNumber: dt.orderNumber,
        clientName: dt.clientName,
        dueDate: dt.dueDate,
        clientPhone: dt.clientPhone,
        type: 'DUE_TOMORROW' as const
      }))

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ready-check-pending', [...pendingChecks, ...dueTomorrowChecks])
      if (autoProcessedCount > 0) {
        mainWindow.webContents.send('orders:status-changed')
      }
    }
  } catch (err) {
    // DB might not be configured yet — skip silently
    if (isDev) console.warn('Reconcile skipped (DB not ready):', (err as Error).message)
  }
}

ipcMain.handle('orders:trigger-reconcile', async () => {
  await runReconcile()
})

app.whenReady().then(async () => {
  registerIpc()
  await createWindow()

  const runDailyQueueSetup = async () => {
    try {
      const db = await databaseManager.getDb()
      await createReadyQueueService(db).createQueueForToday()
    } catch (err) {
      if (isDev) console.warn('Queue setup skipped:', (err as Error).message)
    }
  }

  const runAutoProcess = async () => {
    try {
      const db = await databaseManager.getDb()
      await createReadyQueueService(db).autoProcessPending()
    } catch (err) {
      if (isDev) console.warn('Auto-process skipped:', (err as Error).message)
    }
  }

  // Run reconcile + queue setup after window loads
  mainWindow?.webContents.once('did-finish-load', () => {
    setTimeout(() => runReconcile(), 3000)
    setTimeout(() => {
      runDailyQueueSetup().catch(console.error)
      runAutoProcess().catch(console.error)
    }, 5000)
  })

  // Run every 30 seconds so CREATED→IN_PROGRESS (10s threshold) fires promptly
  setInterval(() => {
    runReconcile().catch(console.error)
  }, 30 * 1000)

  // Queue setup every 5 minutes (idempotent)
  setInterval(() => {
    runDailyQueueSetup().catch(console.error)
    runAutoProcess().catch(console.error)
  }, 5 * 60 * 1000)

  // Sync user preferences in background
  syncUserPreferences().catch(console.error)
  setInterval(() => {
    syncUserPreferences().catch(console.error)
  }, 24 * 60 * 60 * 1000)

  if (!isDev) {
    try {
      autoUpdater.checkForUpdatesAndNotify()

      autoUpdater.on('update-available', () => {
        console.log('Nueva actualización disponible')
      })

      autoUpdater.on('update-downloaded', () => {
        console.log('Update descargado, reiniciando...')
        autoUpdater.quitAndInstall()
      })

      autoUpdater.on('error', (err) => {
        console.error('Error en autoUpdater:', err)
      })
    } catch (error) {
      console.error('Error iniciando autoUpdater:', error)
    }
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

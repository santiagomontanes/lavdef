import { contextBridge, ipcRenderer } from 'electron';
import type {
  BatchPaymentInput,
  ClientInput,
  DbConnectionConfig,
  DeliveryInput,
  DueTomorrowOrder,
  ExternalLinkPayload,
  LoginInput,
  OrderInput,
  PaymentInput,
  VoidPaymentInput,
  PendingReadyCheck,
  ServiceInput,
  SetupFinalizeInput,
  SetupInitializeProgress,
  SetupRootConnectionInput,
  ReadyQueueItem,
  ReadyQueueStats,
  MessageQueueItem
} from '../shared/types.js';

type DesktopPdfPageSize = 'A4' | 'Letter' | 'Legal' | 'Tabloid';
type DesktopPdfInput = {
  defaultFileName?: string;
  targetDir?: string | null;
  subfolder?: string | null;
  pageSize?: DesktopPdfPageSize;
  landscape?: boolean;
  preferCssPageSize?: boolean;
};

const gpuSafeModeEnabled = process.env.ELECTRON_DISABLE_GPU === 'true';
const htmlCanvasElementCtor = (globalThis as { HTMLCanvasElement?: { prototype: { getContext: (...args: unknown[]) => unknown } } })
  .HTMLCanvasElement;

if (gpuSafeModeEnabled && htmlCanvasElementCtor) {
  const originalGetContext = htmlCanvasElementCtor.prototype.getContext;
  htmlCanvasElementCtor.prototype.getContext = (function (this: unknown, type: string, ...args: unknown[]) {
    if (type === 'webgl' || type === 'webgl2') return null;
    return originalGetContext.call(this, type, ...args);
  }) as typeof originalGetContext;
}

if (gpuSafeModeEnabled) {
  (globalThis as { document?: { documentElement?: { setAttribute: (k: string, v: string) => void } } })
    .document?.documentElement?.setAttribute('data-gpu-safe-mode', 'true');
}

contextBridge.exposeInMainWorld('desktopApi', {
  getPlatform: () => process.platform,
  verifyPassword: (password: string) =>
    ipcRenderer.invoke('auth:verify-password', password),

  // License (V1 Supabase system)
  getLicenseStatus: () => ipcRenderer.invoke('license:status'),
  activateLicense: (licenseKey: string) => ipcRenderer.invoke('license:activate', licenseKey),

  getOrderProtectionPassword: () =>
    ipcRenderer.invoke('settings:get-order-protection-password'),
  getAutoReadyByDueDateEnabled: () =>
    ipcRenderer.invoke('settings:get-auto-ready-by-due-date-enabled'),
  getDisableGpuRenderingEnabled: () =>
    ipcRenderer.invoke('settings:get-disable-gpu-rendering-enabled'),
  getInvoiceShowAllActiveOrdersEnabled: () =>
    ipcRenderer.invoke('settings:get-invoice-show-all-active-orders-enabled'),
  getInvoiceShowBarcodeEnabled: () =>
    ipcRenderer.invoke('settings:get-invoice-show-barcode-enabled'),
  getOrderQuantityDecimalsEnabled: () =>
    ipcRenderer.invoke('settings:get-order-quantity-decimals-enabled'),
  getPdfOutputDir: () =>
    ipcRenderer.invoke('settings:get-pdf-output-dir'),
  updatePdfOutputDir: (value: string | null) =>
    ipcRenderer.invoke('settings:update-pdf-output-dir', value),
  updateAutoReadyByDueDateEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('settings:update-auto-ready-by-due-date-enabled', enabled),
  updateDisableGpuRenderingEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('settings:update-disable-gpu-rendering-enabled', enabled),
  updateInvoiceShowAllActiveOrdersEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('settings:update-invoice-show-all-active-orders-enabled', enabled),
  updateInvoiceShowBarcodeEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('settings:update-invoice-show-barcode-enabled', enabled),
  updateOrderQuantityDecimalsEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('settings:update-order-quantity-decimals-enabled', enabled),

  updateOrderProtectionPassword: (input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) =>
  ipcRenderer.invoke('settings:update-order-protection-password', input),

  connectDriveBackup: () => ipcRenderer.invoke('backup:connect-drive'),
  uploadBackupToDrive: () => ipcRenderer.invoke('backup:upload-drive'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  onBackupUploadProgress: (callback: (status: string) => void) => {
    const listener = (_event: unknown, status: string) => callback(status);
    ipcRenderer.on('backup:upload-progress', listener);
    return () => ipcRenderer.removeListener('backup:upload-progress', listener);
  },

  listPrinters: () => ipcRenderer.invoke('printers:list'),
  openCashDrawer: (printerName?: string) => ipcRenderer.invoke('printer:open-drawer', printerName),

  updateCompanySettings: (input: any) =>
    ipcRenderer.invoke('settings:update-company', input),
  getReportsSummary: (from?: string, to?: string) =>
    ipcRenderer.invoke('reports:summary', from, to),
  getInventoryGeneral: (from?: string, to?: string) =>
    ipcRenderer.invoke('reports:inventory-general', from, to),

  listWarranties: () => ipcRenderer.invoke('warranties:list'),
  listWarrantyStatuses: () => ipcRenderer.invoke('warranties:statuses'),
  createWarranty: (input: { orderId: number; reason: string }) =>
    ipcRenderer.invoke('warranties:create', input),
  updateWarrantyStatus: (id: number, input: { statusId: number; resolution: string | null }) =>
    ipcRenderer.invoke('warranties:update-status', id, input),

  health: () => ipcRenderer.invoke('app:health'),
  getVersionInfo: () => ipcRenderer.invoke('app:version-info'),
  runtimeDiagnostics: () => ipcRenderer.invoke('app:runtime-diagnostics'),
  restartApp: () => ipcRenderer.invoke('app:restart'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  getUpdateStatus: () => ipcRenderer.invoke('app:update-status'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateStatus: (callback: (status: any) => void) => {
    const listener = (_event: unknown, status: any) => callback(status);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  },
  openExternal: (payload: ExternalLinkPayload) => ipcRenderer.invoke('app:open-external', payload),
  printToPdf: (input?: Omit<DesktopPdfInput, 'targetDir' | 'subfolder'>) => ipcRenderer.invoke('app:print-to-pdf', input),
  printToPdfAuto: (input?: DesktopPdfInput) =>
    ipcRenderer.invoke('app:print-to-pdf-auto', input),
  selectDirectory: () => ipcRenderer.invoke('app:select-directory'),

  // Legacy setup via db:save-config
  saveDbConfig: (config: DbConnectionConfig) => ipcRenderer.invoke('db:save-config', config),

  // New setup flow
  setupCreateDatabase: (input: SetupRootConnectionInput) =>
    ipcRenderer.invoke('setup:create-database', input),
  setupInitializeSchema: (input: SetupRootConnectionInput) =>
    ipcRenderer.invoke('setup:initialize-schema', input),
  onSetupInitializeProgress: (callback: (progress: SetupInitializeProgress) => void) => {
    const listener = (_event: unknown, progress: SetupInitializeProgress) => callback(progress);
    ipcRenderer.on('setup:initialize-progress', listener);
    return () => ipcRenderer.removeListener('setup:initialize-progress', listener);
  },
  setupFinalize: (input: SetupFinalizeInput) =>
    ipcRenderer.invoke('setup:finalize', input),
  login: (input: LoginInput) => ipcRenderer.invoke('auth:login', input),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getCompanySettings: () => ipcRenderer.invoke('settings:company'),

  listClients: () => ipcRenderer.invoke('clients:list'),
  searchClients: (term: string, limit?: number) => ipcRenderer.invoke('clients:search', term, limit),
  createClient: (input: ClientInput & { force?: boolean }) => ipcRenderer.invoke('clients:create', input),
  updateClient: (id: number, input: ClientInput) => ipcRenderer.invoke('clients:update', id, input),
  deleteClient: (id: number) => ipcRenderer.invoke('clients:delete', id),
  findSimilarClients: (input: { firstName: string; lastName: string; phone: string; excludeId?: number }) =>
    ipcRenderer.invoke('clients:find-similar', input),
  mergeClients: (primaryId: number, duplicateId: number) =>
    ipcRenderer.invoke('clients:merge', primaryId, duplicateId),

  listOrders: () => ipcRenderer.invoke('orders:list'),
  listOrdersPage: (params?: { page?: number; pageSize?: number; status?: number | 'ALL' | null; search?: string | null }) =>
    ipcRenderer.invoke('orders:list-page', params),
  searchOrders: (term: string, limit?: number) => ipcRenderer.invoke('orders:search', term, limit),
  getOrderDetail: (id: number) => ipcRenderer.invoke('orders:detail', id),
  getOrderCatalogs: () => ipcRenderer.invoke('orders:catalogs'),
  createOrder: (input: OrderInput) => ipcRenderer.invoke('orders:create', input),
  updateOrderStatus: (orderId: number, statusId: number) =>
    ipcRenderer.invoke('orders:update-status', orderId, statusId),

  updateOrder: (orderId: number, input: OrderInput) =>
    ipcRenderer.invoke('orders:update', orderId, input),

  cancelOrder: (orderId: number) =>
    ipcRenderer.invoke('orders:cancel', orderId),

  listPayments: (orderId?: number) => ipcRenderer.invoke('payments:list', orderId),
  createPayment: (input: PaymentInput) => ipcRenderer.invoke('payments:create', input),
  createPaymentBatch: (input: BatchPaymentInput) => ipcRenderer.invoke('payments:create-batch', input),
  voidPayment: (input: VoidPaymentInput) => ipcRenderer.invoke('payments:void', input),

  listInvoices: () => ipcRenderer.invoke('invoices:list'),
  searchInvoices: (term: string, limit?: number) => ipcRenderer.invoke('invoices:search', term, limit),
  getInvoiceDetail: (id: number) => ipcRenderer.invoke('invoices:detail', id),
  createInvoiceFromOrder: (orderId: number) => ipcRenderer.invoke('invoices:create-from-order', orderId),
  updateInvoiceNotes: (orderId: number, notes: string | null) =>
    ipcRenderer.invoke('invoices:update-notes', orderId, notes),

  openCashSession: (input: {
  openingAmount?: number;
  openedByName: string;
  openedByPhone: string;
}) => ipcRenderer.invoke('cash:open', input),
  closeCashSession: (declaredAmount: number) => ipcRenderer.invoke('cash:close', declaredAmount),
  getCashClosureDetail: (closureId: number) => ipcRenderer.invoke('cash:closure-detail', closureId),
  getCashSummary: () => ipcRenderer.invoke('cash:summary'),
  addCashMovement: (input: { type: 'CASH_IN' | 'CASH_OUT'; amount: number; notes?: string | null }) =>
    ipcRenderer.invoke('cash:movement', input),
  listCashMovements: (args?: { sessionId?: number | null; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('cash:movements', args),
  listCashClosures: (filter?: { from?: string | null; to?: string | null; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('cash:closures', filter),

  listExpenses: () => ipcRenderer.invoke('expenses:list'),
  createExpense: (input: { categoryId: number; paymentMethodId: number; amount: number; description: string; expenseDate: string }) =>
    ipcRenderer.invoke('expenses:create', input),
  listExpenseCategories: () => ipcRenderer.invoke('expenses:categories'),

  listSellerUsers: () => ipcRenderer.invoke('users:list-sellers'),
  createSellerUser: (input: { fullName: string; username: string; password: string }) =>
    ipcRenderer.invoke('users:create-seller', input),
  updateSellerUser: (id: number, input: { fullName: string; username: string; password?: string | null }) =>
    ipcRenderer.invoke('users:update-seller', id, input),
  deleteSellerUser: (id: number) => ipcRenderer.invoke('users:delete-seller', id),

  listDeliveries: () => ipcRenderer.invoke('deliveries:list'),
  createDelivery: (input: DeliveryInput) => ipcRenderer.invoke('deliveries:create', input),

  getDashboardSummary: () => ipcRenderer.invoke('dashboard:summary'),
  auditListDays: () => ipcRenderer.invoke('audit:list-days'),
  auditListByDay: (date: string) => ipcRenderer.invoke('audit:list-by-day', date),

  listServices: (activeOnly?: boolean) => ipcRenderer.invoke('services:list', activeOnly),
  createService: (input: ServiceInput) => ipcRenderer.invoke('services:create', input),
  updateService: (id: number, input: ServiceInput) => ipcRenderer.invoke('services:update', id, input),
  deleteService: (id: number) => ipcRenderer.invoke('services:delete', id),

  listInventorySummary: () => ipcRenderer.invoke('orders:inventory-summary'),

  onDueTomorrowOrders: (callback: (orders: DueTomorrowOrder[]) => void) => {
    const listener = (_event: unknown, orders: DueTomorrowOrder[]) => callback(orders);
    ipcRenderer.on('due-tomorrow-orders', listener);
    return () => ipcRenderer.removeListener('due-tomorrow-orders', listener);
  },

  listReadyQueuePending: (): Promise<{ success: boolean; data?: ReadyQueueItem[]; error?: string }> =>
    ipcRenderer.invoke('ready-queue:list-pending'),
  getReadyQueueStats: (): Promise<{ success: boolean; data?: ReadyQueueStats; error?: string }> =>
    ipcRenderer.invoke('ready-queue:stats'),
  confirmReadyQueue: (queueId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ready-queue:confirm', queueId),
  rescheduleReadyQueue: (queueId: number, newDueDate: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ready-queue:reschedule', queueId, newDueDate),
  skipReadyQueue: (queueId: number, notes?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ready-queue:skip', queueId, notes),
  listMessageQueue: (date?: string): Promise<{ success: boolean; data?: MessageQueueItem[]; error?: string }> =>
    ipcRenderer.invoke('message-queue:list', date),
  markMessageSent: (messageId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('message-queue:mark-sent', messageId),
  markMessageFailed: (messageId: number, errorMessage: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('message-queue:mark-failed', messageId, errorMessage),

  confirmAndMakeReady: (queueId: number): Promise<{ success: boolean; data?: { whatsappUrl: string | null }; error?: string }> =>
    ipcRenderer.invoke('ready-queue:confirm-and-ready', queueId),

  onReadyCheckPending: (callback: (checks: PendingReadyCheck[]) => void) => {
    const listener = (_event: unknown, checks: PendingReadyCheck[]) => callback(checks);
    ipcRenderer.on('ready-check-pending', listener);
    return () => ipcRenderer.removeListener('ready-check-pending', listener);
  },

  triggerReconcile: () => ipcRenderer.invoke('orders:trigger-reconcile'),

  onOrdersStatusChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('orders:status-changed', listener);
    return () => ipcRenderer.removeListener('orders:status-changed', listener);
  }
});

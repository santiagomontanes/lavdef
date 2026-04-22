import type {
  AuditDay,
  AuditEntry,
  BatchPaymentInput,
  Expense,
  ExpenseInput,
  ApiResponse,
  CashCloseResult,
  CashSessionSummary,
  CatalogsPayload,
  Client,
  ClientInput,
  CompanySettings,
  DashboardSummary,
  DbConnectionConfig,
  DeliveryInput,
  DeliveryRecord,
  HealthStatus,
  InventorySummary,
  Invoice,
  InvoiceDetail,
  LoginInput,
  Order,
  OrderDetail,
  OrderInput,
  Payment,
  PaymentInput,
  Service,
  ServiceInput,
  SessionUser,
  WarrantyInput,
  WarrantyRecord,
  WarrantyStatus,
  WarrantyUpdateInput,
  ReportsSummary,
  PrinterInfo,
  OpenDrawerResult,
  RuntimeDiagnostics,
  BackupRecord,
  BackupUploadResult,
  ConnectDriveResult,
  CashOpenInput,
  SetupCreateDatabaseResult,
  SetupFinalizeInput,
  SetupFinalizeResult,
  SetupInitializeProgress,
  SetupInitializeSchemaResult,
  SetupRootConnectionInput,
  SellerUser,
  SellerUserCreateInput,
  SellerUserUpdateInput,
  ReadyQueueItem,
  ReadyQueueStats,
  MessageQueueItem,
  PendingReadyCheck,
} from '@shared/types';

async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  const response = (await promise) as ApiResponse<T>;
  if (!response.success) throw new Error(response.error ?? 'Error desconocido.');
  return response.data as T;
}

const callDesktopApi = <T>(fnName: string, ...args: any[]): Promise<T> => {
  const desktopApi = window.desktopApi as unknown as Record<string, (...inner: any[]) => Promise<unknown>>;
  const fn = desktopApi[fnName];
  if (typeof fn !== 'function') {
    throw new Error(`La función ${fnName} no está disponible. Reinicia la app para cargar la última versión.`);
  }
  return fn(...args) as Promise<T>;
};

type DesktopPdfPageSize = 'A4' | 'Letter' | 'Legal' | 'Tabloid';
type DesktopPdfInput = {
  defaultFileName?: string;
  targetDir?: string | null;
  subfolder?: string | null;
  pageSize?: DesktopPdfPageSize;
  landscape?: boolean;
  preferCssPageSize?: boolean;
};

export const api = {
  // License (V1 Supabase system)
  licenseStatus: () => unwrap<any>(window.desktopApi.getLicenseStatus()),
  activateLicense: (licenseKey: string) =>
    unwrap<any>(window.desktopApi.activateLicense(licenseKey)),

  connectDriveBackup: () =>
    unwrap<ConnectDriveResult>(window.desktopApi.connectDriveBackup()),

  uploadBackupToDrive: () =>
    unwrap<BackupUploadResult>(window.desktopApi.uploadBackupToDrive()),

  listBackups: () =>
    unwrap<BackupRecord[]>(window.desktopApi.listBackups()),

  listPrinters: () => unwrap<PrinterInfo[]>(window.desktopApi.listPrinters()),
  openCashDrawer: (printerName?: string) =>
    unwrap<OpenDrawerResult>(window.desktopApi.openCashDrawer(printerName)),

  updateCompanySettings: (input: any) =>
    unwrap(window.desktopApi.updateCompanySettings(input)),

  getOrderProtectionPassword: () =>
    unwrap<string | null>(window.desktopApi.getOrderProtectionPassword()),
  getAutoReadyByDueDateEnabled: () =>
    unwrap<boolean>(callDesktopApi('getAutoReadyByDueDateEnabled')),
  getPdfOutputDir: () =>
    unwrap<string | null>(callDesktopApi('getPdfOutputDir')),
  updatePdfOutputDir: (value: string | null) =>
    unwrap<{ success: true; value: string | null }>(callDesktopApi('updatePdfOutputDir', value)),
  updateAutoReadyByDueDateEnabled: (enabled: boolean) =>
    unwrap<{ success: true; enabled: boolean }>(callDesktopApi('updateAutoReadyByDueDateEnabled', enabled)),

  updateOrderProtectionPassword: (input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) =>
  unwrap<{ success: true }>(
    window.desktopApi.updateOrderProtectionPassword(input)
  ),

  reportsSummary: (from?: string, to?: string) =>
    unwrap<ReportsSummary>(window.desktopApi.getReportsSummary(from, to)),

  listWarranties: () => unwrap<WarrantyRecord[]>(window.desktopApi.listWarranties()),
  listWarrantyStatuses: () => unwrap<WarrantyStatus[]>(window.desktopApi.listWarrantyStatuses()),
  createWarranty: (input: WarrantyInput) => unwrap<WarrantyRecord>(window.desktopApi.createWarranty(input)),
  updateWarrantyStatus: (id: number, input: WarrantyUpdateInput) =>
    unwrap<WarrantyRecord>(window.desktopApi.updateWarrantyStatus(id, input)),

  listExpenseCategories: () =>
    unwrap<{ id: number; name: string }[]>(
      window.desktopApi.listExpenseCategories()
    ),

  listExpenses: () => unwrap<Expense[]>(window.desktopApi.listExpenses()),
  createExpense: (input: ExpenseInput) => unwrap<Expense>(window.desktopApi.createExpense(input)),
  health: () => unwrap<HealthStatus>(window.desktopApi.health()),
  runtimeDiagnostics: () => unwrap<RuntimeDiagnostics>(callDesktopApi('runtimeDiagnostics')),
  restartApp: () => unwrap<{ restarted: boolean }>(window.desktopApi.restartApp()),
  quitApp: () => unwrap<{ quit: boolean }>(window.desktopApi.quitApp()),
  openExternal: (url: string) => unwrap(window.desktopApi.openExternal({ url })),
  printToPdf: (input?: Omit<DesktopPdfInput, 'targetDir' | 'subfolder'>) =>
    unwrap<{ saved: boolean; path: string | null }>(window.desktopApi.printToPdf(input)),
  printToPdfAuto: (input: DesktopPdfInput) =>
    unwrap<{ saved: boolean; path: string | null }>(callDesktopApi('printToPdfAuto', input)),
  selectDirectory: () =>
    unwrap<{ selected: boolean; path: string | null }>(callDesktopApi('selectDirectory')),

  // Legacy db:save-config (V1 backward compat)
  saveDbConfig: (config: DbConnectionConfig) => unwrap<HealthStatus>(window.desktopApi.saveDbConfig(config)),

  setupCreateDatabase: (input: SetupRootConnectionInput) =>
    unwrap<SetupCreateDatabaseResult>(window.desktopApi.setupCreateDatabase(input)),
  setupInitializeSchema: (input: SetupRootConnectionInput) =>
    unwrap<SetupInitializeSchemaResult>(window.desktopApi.setupInitializeSchema(input)),
  onSetupInitializeProgress: (callback: (progress: SetupInitializeProgress) => void) =>
    window.desktopApi.onSetupInitializeProgress(callback),
  setupFinalize: (input: SetupFinalizeInput) =>
    unwrap<SetupFinalizeResult>(window.desktopApi.setupFinalize(input)),
  login: (input: LoginInput) => unwrap<SessionUser>(window.desktopApi.login(input)),
  logout: () => unwrap<{ success: true }>(window.desktopApi.logout()),
  companySettings: () => unwrap<CompanySettings | null>(window.desktopApi.getCompanySettings()),

  verifyPassword: (password: string) =>
    unwrap<{ valid: boolean }>(window.desktopApi.verifyPassword(password)),

  listClients: () => unwrap<Client[]>(window.desktopApi.listClients()),
  searchClientsByName: (term: string, limit = 40) =>
    unwrap<Client[]>(window.desktopApi.searchClients(term, limit)),
  createClient: (input: ClientInput) => unwrap<Client>(window.desktopApi.createClient(input)),
  updateClient: (id: number, input: ClientInput) => unwrap<Client>(window.desktopApi.updateClient(id, input)),
  deleteClient: (id: number) => unwrap<{ id: number }>(window.desktopApi.deleteClient(id)),

  listOrders: () => unwrap<Order[]>(window.desktopApi.listOrders()),
  searchOrders: (term: string, limit = 8) =>
    unwrap<Order[]>(window.desktopApi.searchOrders(term, limit)),
  orderDetail: (id: number) => unwrap<OrderDetail>(window.desktopApi.getOrderDetail(id)),
  orderCatalogs: () => unwrap<CatalogsPayload>(window.desktopApi.getOrderCatalogs()),
  createOrder: (input: OrderInput) => unwrap<OrderDetail>(window.desktopApi.createOrder(input)),
  updateOrder: (orderId: number, input: OrderInput) =>
    unwrap<OrderDetail>(window.desktopApi.updateOrder(orderId, input)),
  cancelOrder: (orderId: number) =>
    unwrap<{ success: boolean }>(window.desktopApi.cancelOrder(orderId)),
  updateOrderStatus: (orderId: number, statusId: number) =>
    unwrap<{ success: boolean }>(window.desktopApi.updateOrderStatus(orderId, statusId)),
  triggerReconcile: () => window.desktopApi.triggerReconcile(),

  listPayments: (orderId?: number) => unwrap<Payment[]>(window.desktopApi.listPayments(orderId)),
  createPayment: (input: PaymentInput) => unwrap<Payment>(window.desktopApi.createPayment(input)),
  createPaymentBatch: (input: BatchPaymentInput) => unwrap<Payment[]>(window.desktopApi.createPaymentBatch(input)),

  listInvoices: () => unwrap<Invoice[]>(window.desktopApi.listInvoices()),
  searchInvoices: (term: string, limit = 8) =>
    unwrap<Invoice[]>(window.desktopApi.searchInvoices(term, limit)),
  invoiceDetail: (id: number) => unwrap<InvoiceDetail>(window.desktopApi.getInvoiceDetail(id)),
  createInvoiceFromOrder: (orderId: number) => unwrap<InvoiceDetail>(window.desktopApi.createInvoiceFromOrder(orderId)),

  openCashSession: (input: CashOpenInput) =>
  unwrap(window.desktopApi.openCashSession(input)),
  closeCashSession: (declaredAmount: number) =>
    unwrap<CashCloseResult>(window.desktopApi.closeCashSession(declaredAmount)),
  cashSummary: () => unwrap<CashSessionSummary>(window.desktopApi.getCashSummary()),

  listDeliveries: () => unwrap<DeliveryRecord[]>(window.desktopApi.listDeliveries()),
  createDelivery: (input: DeliveryInput) => unwrap<DeliveryRecord>(window.desktopApi.createDelivery(input)),

  listSellerUsers: () => unwrap<SellerUser[]>(window.desktopApi.listSellerUsers()),
  createSellerUser: (input: SellerUserCreateInput) =>
    unwrap<SellerUser>(window.desktopApi.createSellerUser(input)),
  updateSellerUser: (id: number, input: SellerUserUpdateInput) =>
    unwrap<SellerUser>(window.desktopApi.updateSellerUser(id, input)),
  deleteSellerUser: (id: number) =>
    unwrap<{ success: true }>(window.desktopApi.deleteSellerUser(id)),

  dashboardSummary: () => unwrap<DashboardSummary>(window.desktopApi.getDashboardSummary()),
  auditListDays: () => unwrap<AuditDay[]>(window.desktopApi.auditListDays()),
  auditListByDay: (date: string) => unwrap<AuditEntry[]>(window.desktopApi.auditListByDay(date)),

  listServices: (activeOnly?: boolean) => unwrap<Service[]>(window.desktopApi.listServices(activeOnly)),
  createService: (input: ServiceInput) => unwrap<Service>(window.desktopApi.createService(input)),
  updateService: (id: number, input: ServiceInput) => unwrap<Service>(window.desktopApi.updateService(id, input)),
  deleteService: (id: number) => unwrap<{ success: boolean }>(window.desktopApi.deleteService(id)),

  listInventorySummary: () => unwrap<InventorySummary>(window.desktopApi.listInventorySummary()),

  listReadyQueuePending: () => unwrap<ReadyQueueItem[]>(callDesktopApi('listReadyQueuePending')),
  getReadyQueueStats: () => unwrap<ReadyQueueStats>(callDesktopApi('getReadyQueueStats')),
  confirmReadyQueue: (queueId: number) => unwrap<{ success: true }>(callDesktopApi('confirmReadyQueue', queueId)),
  rescheduleReadyQueue: (queueId: number, newDueDate: string) =>
    unwrap<{ success: true }>(callDesktopApi('rescheduleReadyQueue', queueId, newDueDate)),
  skipReadyQueue: (queueId: number, notes?: string) =>
    unwrap<{ success: true }>(callDesktopApi('skipReadyQueue', queueId, notes)),
  listMessageQueue: (date?: string) => unwrap<MessageQueueItem[]>(callDesktopApi('listMessageQueue', date)),
  markMessageSent: (messageId: number) => unwrap<{ success: true }>(callDesktopApi('markMessageSent', messageId)),
  markMessageFailed: (messageId: number, errorMessage: string) =>
    unwrap<{ success: true }>(callDesktopApi('markMessageFailed', messageId, errorMessage)),

  confirmAndMakeReady: (queueId: number) =>
    unwrap<{ whatsappUrl: string | null }>(callDesktopApi('confirmAndMakeReady', queueId))
};

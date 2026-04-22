/// <reference types="vite/client" />

import type {
  ApiResponse,
  BatchPaymentInput,
  ClientInput,
  DbConnectionConfig,
  DeliveryInput,
  DueTomorrowOrder,
  ExternalLinkPayload,
  InventorySummary,
  LoginInput,
  OrderInput,
  PaymentInput,
  Service,
  ServiceInput,
  SetupFinalizeInput,
  SetupInitializeProgress,
  SetupRootConnectionInput
} from '@shared/types';

declare global {
  type DesktopPdfPageSize = 'A4' | 'Letter' | 'Legal' | 'Tabloid';
  type DesktopPdfInput = {
    defaultFileName?: string;
    targetDir?: string | null;
    subfolder?: string | null;
    pageSize?: DesktopPdfPageSize;
    landscape?: boolean;
    preferCssPageSize?: boolean;
  };

  interface Window {
    desktopApi: {
      getPlatform: () => NodeJS.Platform;
      verifyPassword: (password: string) => Promise<ApiResponse<{ valid: boolean }>>;

      // License (V1 Supabase system)
      getLicenseStatus: () => Promise<unknown>;
      activateLicense: (licenseKey: string) => Promise<unknown>;

      getOrderProtectionPassword: () => Promise<unknown>;
      getPdfOutputDir: () => Promise<unknown>;
      updatePdfOutputDir: (value: string | null) => Promise<unknown>;
      updateOrderProtectionPassword: (input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) => Promise<unknown>;

      updateOrder: (orderId: number, input: OrderInput) => Promise<unknown>;
      cancelOrder: (orderId: number) => Promise<unknown>;

      connectDriveBackup: () => Promise<unknown>;
      uploadBackupToDrive: () => Promise<unknown>;
      listBackups: () => Promise<unknown>;
      onBackupUploadProgress: (callback: (status: string) => void) => () => void;

      listPrinters: () => Promise<unknown>;
      openCashDrawer: (printerName?: string) => Promise<unknown>;

      updateCompanySettings: (input: any) => Promise<any>;

      getReportsSummary: (from?: string, to?: string) => Promise<unknown>;

      listWarranties: () => Promise<unknown>;
      listWarrantyStatuses: () => Promise<unknown>;
      createWarranty: (input: { orderId: number; reason: string }) => Promise<unknown>;
      updateWarrantyStatus: (
        id: number,
        input: { statusId: number; resolution: string | null }
      ) => Promise<unknown>;

      listExpenses: () => Promise<unknown>;
      createExpense: (input: {
        categoryId: number;
        paymentMethodId: number;
        amount: number;
        description: string;
        expenseDate: string;
      }) => Promise<unknown>;
      listExpenseCategories: () => Promise<unknown>;
      listSellerUsers: () => Promise<unknown>;
      createSellerUser: (input: {
        fullName: string;
        username: string;
        password: string;
      }) => Promise<unknown>;
      updateSellerUser: (
        id: number,
        input: { fullName: string; username: string; password?: string | null }
      ) => Promise<unknown>;
      deleteSellerUser: (id: number) => Promise<unknown>;

      listServices: (activeOnly?: boolean) => Promise<Service[]>;
      createService: (input: ServiceInput) => Promise<Service>;
      updateService: (id: number, input: ServiceInput) => Promise<Service>;
      deleteService: (id: number) => Promise<{ success: boolean }>;

      listInventorySummary: () => Promise<ApiResponse<InventorySummary>>;
      onDueTomorrowOrders: (callback: (orders: DueTomorrowOrder[]) => void) => () => void;

      listReadyQueuePending: () => Promise<unknown>;
      getReadyQueueStats: () => Promise<unknown>;
      confirmReadyQueue: (queueId: number) => Promise<unknown>;
      rescheduleReadyQueue: (queueId: number, newDueDate: string) => Promise<unknown>;
      skipReadyQueue: (queueId: number, notes?: string) => Promise<unknown>;
      listMessageQueue: (date?: string) => Promise<unknown>;
      markMessageSent: (messageId: number) => Promise<unknown>;
      markMessageFailed: (messageId: number, errorMessage: string) => Promise<unknown>;
      confirmAndMakeReady: (queueId: number) => Promise<unknown>;
      onReadyCheckPending: (callback: (checks: any[]) => void) => () => void;
      triggerReconcile: () => Promise<void>;
      onOrdersStatusChanged: (callback: () => void) => () => void;

      health: () => Promise<unknown>;
      runtimeDiagnostics: () => Promise<unknown>;
      restartApp: () => Promise<unknown>;
      quitApp: () => Promise<unknown>;
      openExternal: (payload: ExternalLinkPayload) => Promise<unknown>;
      printToPdf: (input?: Omit<DesktopPdfInput, 'targetDir' | 'subfolder'>) => Promise<unknown>;
      printToPdfAuto: (input?: DesktopPdfInput) => Promise<unknown>;
      selectDirectory: () => Promise<unknown>;

      // Legacy db:save-config (V1 backward compat)
      saveDbConfig: (config: DbConnectionConfig) => Promise<unknown>;

      setupCreateDatabase: (input: SetupRootConnectionInput) => Promise<unknown>;
      setupInitializeSchema: (input: SetupRootConnectionInput) => Promise<unknown>;
      onSetupInitializeProgress: (
        callback: (progress: SetupInitializeProgress) => void
      ) => () => void;
      setupFinalize: (input: SetupFinalizeInput) => Promise<unknown>;
      login: (input: LoginInput) => Promise<unknown>;
      logout: () => Promise<unknown>;
      getCompanySettings: () => Promise<unknown>;

      listClients: () => Promise<unknown>;
      searchClients: (term: string, limit?: number) => Promise<unknown>;
      createClient: (input: ClientInput) => Promise<unknown>;
      updateClient: (id: number, input: ClientInput) => Promise<unknown>;
      deleteClient: (id: number) => Promise<unknown>;

      listOrders: () => Promise<unknown>;
      searchOrders: (term: string, limit?: number) => Promise<unknown>;
      getOrderDetail: (id: number) => Promise<unknown>;
      getOrderCatalogs: () => Promise<unknown>;
      createOrder: (input: OrderInput) => Promise<unknown>;
      updateOrderStatus: (orderId: number, statusId: number) => Promise<unknown>;

      listPayments: (orderId?: number) => Promise<unknown>;
      createPayment: (input: PaymentInput) => Promise<unknown>;
      createPaymentBatch: (input: BatchPaymentInput) => Promise<unknown>;

      listInvoices: () => Promise<unknown>;
      searchInvoices: (term: string, limit?: number) => Promise<unknown>;
      getInvoiceDetail: (id: number) => Promise<unknown>;
      createInvoiceFromOrder: (orderId: number) => Promise<unknown>;

      openCashSession: (input: {
  openingAmount?: number;
  openedByName: string;
  openedByPhone: string;
}) => Promise<unknown>;
      closeCashSession: (declaredAmount: number) => Promise<unknown>;
      getCashSummary: () => Promise<unknown>;

      listDeliveries: () => Promise<unknown>;
      createDelivery: (input: DeliveryInput) => Promise<unknown>;

      getDashboardSummary: () => Promise<unknown>;
      auditListDays: () => Promise<unknown>;
      auditListByDay: (date: string) => Promise<unknown>;
    };
  }
}

export {};

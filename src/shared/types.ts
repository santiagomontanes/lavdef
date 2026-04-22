export type DbConnectionConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
};

export type HealthStatus = {
  configured: boolean;
  connected: boolean;
  migrated: boolean;
  message: string;
};

export type RuntimeCheckStatus = 'ok' | 'warning' | 'error';

export type RuntimeCheck = {
  key: string;
  status: RuntimeCheckStatus;
  message: string;
  resolvedPath: string | null;
  required: boolean;
};

export type RuntimeDiagnostics = {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  checks: RuntimeCheck[];
};

export type SetupRootConnectionInput = {
  host: string;
  port: number;
  user: string;
  password: string;
  databaseName: string;
  ssl?: boolean;
};

export type SetupCreateDatabaseResult = {
  success: boolean;
  databaseName: string;
  message: string;
};

export type SetupInitializeSchemaResult = {
  success: boolean;
  databaseName: string;
  executedFiles: string[];
  message: string;
};

export type SetupInitializeProgress = {
  current: number;
  total: number;
  percent: number;
  file: string;
  status: 'running' | 'completed';
  message: string;
};

export type SetupAppUserInput = {
  username: string;
  password: string;
};

export type SetupApplicationUserInput = {
  username: string;
  password: string;
  fullName: string;
};

export type SetupFinalizeInput = {
  root: SetupRootConnectionInput;
  appUser: SetupAppUserInput;
  adminUser: SetupApplicationUserInput;
  sellerUser: SetupApplicationUserInput;
};

export type SetupFinalizeResult = {
  success: boolean;
  message: string;
  connection: DbConnectionConfig;
};

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type SessionUser = {
  id: number;
  username: string;
  roleId: number;
  roleName: string;
  displayName: string;
};

export type LoginInput = {
  username: string;
  password: string;
  rememberMe?: boolean;
};

export type CompanySettings = {
  id: number;
  companyName: string;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  nit: string | null;
  logoBase64: string | null;
  currencyCode: string;
  invoicePolicies: string | null;
};

export type Client = {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  ordersCount?: number;
  createdAt: string;
};

export type ClientInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
};

export type OrderStatus = {
  id: number;
  code: string;
  name: string;
  color: string;
};

export type PaymentMethod = {
  id: number;
  code: string;
  name: string;
};

export type OrderItem = {
  id: number;
  garmentTypeId: number | null;
  serviceId: number | null;
  description: string;
  quantity: number;
  color: string | null;
  brand: string | null;
  sizeReference: string | null;
  material: string | null;
  receivedCondition: string | null;
  workDetail: string | null;
  stains: string | null;
  damages: string | null;
  missingAccessories: string | null;
  customerObservations: string | null;
  internalObservations: string | null;
  unitPrice: number;
  discountAmount: number;
  discountReason: string | null;
  surchargeAmount: number;
  surchargeReason: string | null;
  subtotal: number;
  total: number;
};

export type OrderItemInput = Omit<OrderItem, 'id'>;

export type Order = {
  id: number;
  orderNumber: string;
  clientId: number;
  clientName: string;
  statusId: number;
  statusCode: string;
  statusName: string;
  statusColor: string;
  notes: string | null;
  discountReason: string | null;
  subtotal: number;
  discountTotal: number;
  total: number;
  paidTotal: number;
  balanceDue: number;
  dueDate: string | null;
  createdAt: string;
};

export type OrderInput = {
  clientId: number;
  notes: string | null;
  dueDate: string | null;
  discountTotal: number;
  discountReason: string | null;
  initialPaymentLines: PaymentLineInput[];
  items: OrderItemInput[];
};

export type InventoryOrderItem = { description: string; quantity: number };

export type InventoryOrder = {
  id: number;
  orderNumber: string;
  clientName: string;
  statusCode: string;
  statusName: string;
  statusColor: string;
  items: InventoryOrderItem[];
  totalItems: number;
};

export type InventorySummary = {
  activeOrdersCount: number;
  totalItemsCount: number;
  orders: InventoryOrder[];
};

export type DueTomorrowOrder = {
  orderId: number;
  orderNumber: string;
  clientName: string;
  dueDate: string;
};

export type OrderDetail = Order & {
  items: OrderItem[];
  payments: Payment[];
  invoices: Invoice[];
  deliveries: DeliveryRecord[];
};

export type Payment = {
  id: number;
  orderId: number;
  invoiceId: number | null;
  paymentMethodId: number;
  paymentMethodName: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  createdAt: string;
};

export type PaymentInput = {
  orderId: number;
  paymentMethodId: number;
  amount: number;
  reference: string | null;
  notes?: string | null;
};

export type AuditEntry = {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, any> | null;
  userId: number | null;
  actorName: string | null;
  actorUsername: string | null;
  createdAt: string;
};

export type AuditDay = {
  date: string;
  count: number;
};

export type PaymentLineInput = {
  paymentMethodId: number;
  amount: number;
  reference: string | null;
};

export type BatchPaymentInput = {
  orderId: number;
  lines: PaymentLineInput[];
  notes?: string | null;
};

export type Invoice = {
  id: number;
  invoiceNumber: string;
  orderId: number;
  orderNumber: string;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  legalText: string | null;
  dueDate: string | null;
  notes: string | null;
  paidTotal: number;
  balanceDue: number;
  ticketCode: string;
  companyName: string | null;
  companyLegalName: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyAddress: string | null;
  companyNit: string | null;
  companyLogo: string | null;
  companyPolicies: string | null;
  createdAt: string;
};

export type BackupRecord = {
  id: number;
  file_name: string;
  drive_file_id: string | null;
  status: string;
  message: string | null;
  created_at: string;
};

export type BackupUploadResult = {
  success: boolean;
  fileName: string;
  driveFileId: string | null;
  message: string;
};

export type ConnectDriveResult = {
  success: boolean;
  message: string;
};

export type PrinterInfo = {
  name: string;
  isDefault: boolean;
  status: number;
};

export type OpenDrawerResult = {
  success: boolean;
  printerName: string;
  message: string;
};

export type InvoiceDetail = Invoice & {
  items: Array<{
    id: number;
    garmentTypeId: number | null;
    serviceId: number | null;
    description: string;
    quantity: number;
    color: string | null;
    brand: string | null;
    sizeReference: string | null;
    material: string | null;
    receivedCondition: string | null;
    workDetail: string | null;
    stains: string | null;
    damages: string | null;
    missingAccessories: string | null;
    customerObservations: string | null;
    internalObservations: string | null;
    unitPrice: number;
    discountAmount: number;
    surchargeAmount: number;
    subtotal: number;
    total: number;
  }>;
  activeOrders: Array<{
    id: number;
    orderNumber: string;
    dueDate: string | null;
    itemsCount: number;
  }>;
  generatedBy: string | null;
  softwareName: string;
  whatsappMessage: string;
};

export type DeliveryRecord = {
  id: number;
  orderId: number;
  deliveredTo: string;
  receiverDocument: string | null;
  receiverPhone: string | null;
  relationshipToClient: string | null;
  receiverSignature: string | null;
  outstandingBalance: number;
  ticketCode: string;
  createdAt: string;
};

export type DeliveryInput = {
  orderId: number;
  deliveredTo: string;
  receiverDocument: string | null;
  receiverPhone: string | null;
  relationshipToClient: string | null;
  receiverSignature: string | null;
  ticketCode: string;
};

export type CashCloseInput = {
  declaredAmount: number;
};

export type CashOpenInput = {
  openingAmount?: number;
  openedByName: string;
  openedByPhone: string;
};

export type CashCloseResult = {
  closureId: number;
  cashSessionId: number;
  openingAmount: number;
  declaredAmount: number;
  systemAmount: number;
  differenceAmount: number;
  closedAt?: string;
  cashierName?: string;
  openedByName?: string | null;
  openedByPhone?: string | null;
  companyName?: string;
  companyNit?: string | null;
  companyPhone?: string | null;
  companyAddress?: string | null;
  totalsByMethod?: Array<{
    methodName: string;
    amount: number;
  }>;
  totalExpenses?: number;
  expensesByMethod?: Array<{
    methodName: string;
    amount: number;
  }>;
  deliveredOrders?: Array<{
    orderId: number;
    orderNumber: string;
    deliveredTo: string;
    total: number;
    paidTotal: number;
    paymentMethods: string;
    deliveredAt: string | null;
  }>;
  sessionPayments?: Array<{
    id: number;
    orderId: number;
    orderNumber: string;
    clientName: string;
    amount: number;
    paymentMethodName: string;
    reference: string | null;
    createdAt: string;
  }>;
};

export type CashSessionSummary = {
  activeSession: {
    id: number;
    openingAmount: number;
    openedAt: string;
    status: string;
    openedByName?: string | null;
    openedByPhone?: string | null;
  } | null;
  suggestedOpeningAmount: number;
  systemAmount: number;
  lastClosure: {
    id: number;
    cashSessionId: number;
    declaredAmount: number;
    systemAmount: number;
    differenceAmount: number;
    closedAt: string;
  } | null;
  totalsByMethod: Array<{ methodName: string; amount: number }>;
  totalExpenses: number;
  expensesByMethod: Array<{ methodName: string; amount: number }>;
  recentMovements: Array<{
    id: number;
    movementType: string;
    amount: number;
    notes: string | null;
    createdAt: string;
  }>;
};

export type GlobalSearchResult = {
  clients: Array<Pick<Client, 'id' | 'firstName' | 'lastName' | 'phone'>>;
  orders: Array<Pick<Order, 'id' | 'orderNumber' | 'clientName' | 'statusName' | 'total' | 'balanceDue'>>;
  invoices: Array<Pick<Invoice, 'id' | 'invoiceNumber' | 'orderId' | 'clientName' | 'total' | 'balanceDue'>>;
};

export type SellerUser = {
  id: number;
  fullName: string;
  username: string;
  password: string;
};

export type SellerUserUpdateInput = {
  fullName: string;
  username: string;
  password?: string | null;
};

export type SellerUserCreateInput = {
  fullName: string;
  username: string;
  password: string;
};

export type DashboardSummary = {
  clients: number;
  openOrders: number;
  dailySales: number;
  pendingBalance: number;
  openWarranties: number;
  dailyExpenses: number;
  recentOrders: Order[];
  paymentBreakdown: Array<{ methodName: string; amount: number }>;
};

export type Service = {
  id: number;
  categoryId: number | null;
  name: string;
  basePrice: number;
  isActive: boolean;
};

export type ServiceInput = {
  categoryId?: number | null;
  name: string;
  basePrice: number;
  isActive: boolean;
};

export type CatalogsPayload = {
  statuses: OrderStatus[];
  paymentMethods: PaymentMethod[];
  services: Service[];
};

export type ExternalLinkPayload = {
  url: string;
};

export type Expense = {
  id: number;
  cashSessionId: number | null;
  categoryId: number;
  categoryName?: string;
  paymentMethodId: number | null;
  paymentMethodName?: string | null;
  amount: number;
  description: string;
  expenseDate: string;
  createdBy: number | null;
  createdAt: string;
};

export type ExpenseInput = {
  categoryId: number;
  paymentMethodId: number;
  amount: number;
  description: string;
  expenseDate: string;
};

export type WarrantyStatus = {
  id: number;
  code: string;
  name: string;
  color: string;
};

export type WarrantyRecord = {
  id: number;
  orderId: number;
  orderNumber: string;
  clientName: string;
  statusId: number;
  statusCode: string;
  statusName: string;
  statusColor: string;
  reason: string;
  resolution: string | null;
  createdAt: string;
};

export type WarrantyInput = {
  orderId: number;
  reason: string;
};

export type WarrantyUpdateInput = {
  statusId: number;
  resolution: string | null;
};

export type PendingReadyCheck = {
  queueId: number;
  orderId: number;
  orderNumber: string;
  clientName: string;
  dueDate: string | null;
  type: 'READY_CHECK' | 'WA_REMINDER' | 'DUE_TOMORROW';
  clientPhone?: string | null;
};

export type ReadyQueueStatus = 'PENDING' | 'CONFIRMED_READY' | 'RESCHEDULED' | 'AUTO_PROCESSED' | 'SKIPPED' | 'CANCELLED';
export type MessageQueueStatus = 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
export type MessageTrigger = 'MANUAL' | 'AUTO';

export type ReadyQueueItem = {
  id: number;
  orderId: number;
  orderNumber: string;
  clientName: string;
  clientPhone: string | null;
  queueDate: string;
  status: ReadyQueueStatus;
  autoProcessAfter: string | null;
  checkedAt: string | null;
  notes: string | null;
  dueDate: string | null;
  balanceDue: number;
  total: number;
  currentStatusCode: string;
  currentStatusName: string;
  currentStatusColor: string;
  itemCount: number;
  createdAt: string;
};

export type ReadyQueueStats = {
  pendingCount: number;
  confirmedTodayCount: number;
  autoProcessedTodayCount: number;
  totalTodayCount: number;
};

export type MessageQueueItem = {
  id: number;
  orderId: number;
  orderNumber: string;
  clientName: string;
  phone: string;
  messageText: string;
  triggerType: MessageTrigger;
  status: MessageQueueStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type ReportsSummary = {
  from: string | null;
  to: string | null;
  totalSales: number;
  totalExpenses: number;
  totalPaymentOut: number;
  netUtility: number;
  totalPayments: number;
  totalOrders: number;
  warrantiesCreated: number;
  warrantiesClosed: number;
  openWarranties: number;
  paymentMethods: Array<{
    methodName: string;
    amount: number;
    count: number;
  }>;
  orderStatuses: Array<{
    statusName: string;
    count: number;
    total: number;
  }>;
  expensesByCategory: Array<{
    categoryName: string;
    amount: number;
    count: number;
  }>;
  expensesByPaymentMethod: Array<{
    methodName: string;
    amount: number;
    count: number;
  }>;
  dailySeries: Array<{
    date: string;
    sales: number;
    payments: number;
    expenses: number;
    orders: number;
  }>;
  biggestExpenses: Array<{
    date: string;
    description: string;
    categoryName: string;
    amount: number;
  }>;
};

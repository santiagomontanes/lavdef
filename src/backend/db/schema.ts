import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface GoogleDriveTokensTable {
  id: Generated<number>;
  user_id: number | null;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  expiry_date: number | null;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface BackupsTable {
  id: Generated<number>;
  file_name: string;
  drive_file_id: string | null;
  status: string;
  message: string | null;
  created_at: ColumnType<Date, never, never>;
}


export interface CompanySettingsTable {
  id: Generated<number>;
  company_name: string;
  legal_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  invoice_policies: string | null;
  currency_code: string;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface AppSettingsTable {
  id: Generated<number>;
  setting_key: string;
  setting_value: string;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface SchemaMigrationsTable {
  id: Generated<number>;
  name: string;
  executed_at: ColumnType<Date, never, never>;
}

export interface CountersTable {
  id: Generated<number>;
  counter_key: string;
  prefix: string;
  current_value: number;
  padding: number;
  updated_at: ColumnType<Date, never, Date>;
}

export interface RolesTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  created_at: ColumnType<Date, never, never>;
}

export interface UsersTable {
  id: Generated<number>;
  branch_id: number | null;
  role_id: number;
  username: string;
  password_hash: string;
  full_name: string;
  is_active: number;
  created_at: ColumnType<Date, never, never>;
}

export interface ClientsTable {
  id: Generated<number>;
  code: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: ColumnType<Date, never, never>;
}

export interface OrdersTable {
  id: Generated<number>;
  order_number: string;
  client_id: number;
  branch_id: number | null;
  status_id: number;
  notes: string | null;
  discount_reason: string | null;
  subtotal: number;
  discount_total: number;
  total: number;
  paid_total: number;
  balance_due: number;
  due_date: Date | null;
  created_by: number | null;
  created_at: ColumnType<Date, never, never>;
  whatsapp_created_sent: number;
  whatsapp_ready_sent: number;
  status_changed_at: Date | null;
}

export interface OrderItemsTable {
  id: Generated<number>;
  order_id: number;
  garment_type_id: number | null;
  service_id: number | null;
  description: string;
  quantity: number;
  color: string | null;
  brand: string | null;
  size_reference: string | null;
  material: string | null;
  received_condition: string | null;
  work_detail: string | null;
  stains: string | null;
  damages: string | null;
  missing_accessories: string | null;
  customer_observations: string | null;
  internal_observations: string | null;
  unit_price: number;
  discount_amount: number;
  discount_reason: string | null;
  surcharge_amount: number;
  surcharge_reason: string | null;
  subtotal: number;
  total: number;
}

export interface OrderStatusesTable {
  id: Generated<number>;
  code: string;
  name: string;
  color: string;
  is_final: number;
}

export interface AuditLogsTable {
  id: Generated<number>;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details_json: string | null;
  created_at: ColumnType<Date, never, never>;
}

export interface PaymentMethodsTable {
  id: Generated<number>;
  code: string;
  name: string;
  is_active: number;
}

export interface BranchesTable { id: Generated<number>; name: string; code: string; is_active: number; created_at: ColumnType<Date, never, never>; }
export interface PermissionsTable { id: Generated<number>; code: string; name: string; module: string; }
export interface RolePermissionsTable { id: Generated<number>; role_id: number; permission_id: number; }
export interface CustomerMeasurementsTable { id: Generated<number>; client_id: number; measurement_key: string; measurement_value: string; notes: string | null; created_at: ColumnType<Date, never, never>; }
export interface ServiceCategoriesTable { id: Generated<number>; name: string; description: string | null; }
export interface ServicesTable { id: Generated<number>; category_id: number | null; name: string; base_price: number; is_active: number; }
export interface GarmentTypesTable { id: Generated<number>; name: string; is_active: number; }
export interface WarrantyStatusesTable { id: Generated<number>; code: string; name: string; color: string; }
export interface ExpenseCategoriesTable { id: Generated<number>; name: string; is_active: number; }
export interface PriceListsTable { id: Generated<number>; name: string; is_default: number; is_active: number; }
export interface ServicePricesTable { id: Generated<number>; price_list_id: number; service_id: number; garment_type_id: number | null; price: number; }
export interface OrderStatusHistoryTable { id: Generated<number>; order_id: number; status_id: number; notes: string | null; changed_by: number | null; created_at: ColumnType<Date, never, never>; }
export interface OrderLogsTable { id: Generated<number>; order_id: number; event_type: string; description: string; created_by: number | null; created_at: ColumnType<Date, never, never>; }
export interface InvoicesTable { id: Generated<number>; invoice_number: string; order_id: number; client_id: number; subtotal: number; tax_total: number; total: number; legal_text: string | null; whatsapp_sent_at: Date | null; created_at: ColumnType<Date, never, never>; }
export interface InvoiceItemsSnapshotTable {
  id: Generated<number>;
  invoice_id: number;
  garment_type_id: number | null;
  service_id: number | null;
  description: string;
  quantity: number;
  color: string | null;
  brand: string | null;
  size_reference: string | null;
  material: string | null;
  received_condition: string | null;
  work_detail: string | null;
  stains: string | null;
  damages: string | null;
  missing_accessories: string | null;
  customer_observations: string | null;
  internal_observations: string | null;
  unit_price: number;
  discount_amount: number;
  surcharge_amount: number;
  subtotal: number;
  total: number;
}
export interface PaymentsTable { id: Generated<number>; order_id: number; invoice_id: number | null; payment_method_id: number; amount: number; reference: string | null; notes: string | null; received_by: number | null; created_at: ColumnType<Date, never, never>; }
export interface DiscountAuthorizationsTable { id: Generated<number>; order_id: number; authorized_by: number; amount: number; reason: string; created_at: ColumnType<Date, never, never>; }
export interface CashSessionsTable {
  id: Generated<number>;
  branch_id: number | null;
  opened_by: number;
  opened_by_name: string | null;
  opened_by_phone: string | null;
  opening_amount: number;
  status: string;
  opened_at: ColumnType<Date, never, never>;
}
export interface CashClosuresTable { id: Generated<number>; cash_session_id: number; closed_by: number; declared_amount: number; system_amount: number; difference_amount: number; closed_at: ColumnType<Date, never, never>; }
export interface CashSessionTotalsTable { id: Generated<number>; cash_session_id: number; payment_method_id: number; system_amount: number; counted_amount: number | null; }
export interface CashMovementsTable { id: Generated<number>; cash_session_id: number; movement_type: string; amount: number; notes: string | null; created_by: number | null; created_at: ColumnType<Date, never, never>; }
export interface ExpensesTable { id: Generated<number>; cash_session_id: number | null; category_id: number; payment_method_id: number | null; amount: number; description: string; expense_date: Date; created_by: number | null; created_at: ColumnType<Date, never, never>; }
export interface WarrantiesTable { id: Generated<number>; order_id: number; status_id: number; reason: string; resolution: string | null; created_at: ColumnType<Date, never, never>; }
export interface WarrantyStatusLogsTable { id: Generated<number>; warranty_id: number; status_id: number; notes: string | null; created_by: number | null; created_at: ColumnType<Date, never, never>; }
export interface AttachmentsTable { id: Generated<number>; entity_type: string; entity_id: number; file_name: string; file_path: string; mime_type: string | null; created_at: ColumnType<Date, never, never>; }
export interface SystemDocumentsTable { id: Generated<number>; document_type: string; document_number: string; payload_json: string; created_at: ColumnType<Date, never, never>; }
export interface DeliveryRecordsTable { id: Generated<number>; order_id: number; delivered_to: string; delivered_by: number | null; receiver_document: string | null; receiver_phone: string | null; relationship_to_client: string | null; receiver_signature: string | null; outstanding_balance: number; ticket_code: string; created_at: ColumnType<Date, never, never>; }
export interface NotificationTemplatesTable { id: Generated<number>; code: string; name: string; message_template: string; is_active: number; }
export interface NotificationsWhatsappTable { id: Generated<number>; client_id: number | null; order_id: number | null; phone: string; message_text: string; status: string; created_at: ColumnType<Date, never, never>; }
export interface PrintersTable { id: Generated<number>; name: string; printer_type: string; is_default: number; }
export interface StockItemsTable { id: Generated<number>; name: string; sku: string | null; unit: string; current_stock: number; minimum_stock: number; is_active: number; }
export interface StockMovementsTable { id: Generated<number>; stock_item_id: number; movement_type: string; quantity: number; notes: string | null; created_by: number | null; created_at: ColumnType<Date, never, never>; }

export interface CompanySettingsTable {
  id: Generated<number>;
  company_name: string;
  legal_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;

  nit: string | null; // 👈 NUEVO
  logo_base64: string | null; // 👈 NUEVO

  currency_code: string;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface ReadyQueueTable {
  id: Generated<number>;
  order_id: number;
  queue_date: Date;
  status: string;
  auto_process_after: Date | null;
  checked_at: Date | null;
  checked_by: number | null;
  notes: string | null;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface MessageQueueTable {
  id: Generated<number>;
  order_id: number;
  client_id: number;
  phone: string;
  message_text: string;
  trigger_type: string;
  status: string;
  scheduled_at: Date | null;
  sent_at: Date | null;
  error_message: string | null;
  created_at: ColumnType<Date, never, never>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface Database {
  google_drive_tokens: GoogleDriveTokensTable;
  backups: BackupsTable;
  company_settings: CompanySettingsTable;
  app_settings: AppSettingsTable;
  schema_migrations: SchemaMigrationsTable;
  counters: CountersTable;
  branches: BranchesTable;
  roles: RolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  users: UsersTable;
  clients: ClientsTable;
  customer_measurements: CustomerMeasurementsTable;
  service_categories: ServiceCategoriesTable;
  services: ServicesTable;
  garment_types: GarmentTypesTable;
  payment_methods: PaymentMethodsTable;
  order_statuses: OrderStatusesTable;
  warranty_statuses: WarrantyStatusesTable;
  expense_categories: ExpenseCategoriesTable;
  price_lists: PriceListsTable;
  service_prices: ServicePricesTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  order_status_history: OrderStatusHistoryTable;
  order_logs: OrderLogsTable;
  invoices: InvoicesTable;
  invoice_items_snapshot: InvoiceItemsSnapshotTable;
  payments: PaymentsTable;
  discount_authorizations: DiscountAuthorizationsTable;
  cash_sessions: CashSessionsTable;
  cash_closures: CashClosuresTable;
  cash_session_totals: CashSessionTotalsTable;
  cash_movements: CashMovementsTable;
  expenses: ExpensesTable;
  warranties: WarrantiesTable;
  warranty_status_logs: WarrantyStatusLogsTable;
  attachments: AttachmentsTable;
  system_documents: SystemDocumentsTable;
  delivery_records: DeliveryRecordsTable;
  notification_templates: NotificationTemplatesTable;
  notifications_whatsapp: NotificationsWhatsappTable;
  printers: PrintersTable;
  stock_items: StockItemsTable;
  stock_movements: StockMovementsTable;
  audit_logs: AuditLogsTable;
  ready_queue: ReadyQueueTable;
  message_queue: MessageQueueTable;
}

export type ClientRow = Selectable<ClientsTable>;
export type NewClientRow = Insertable<ClientsTable>;
export type UpdateClientRow = Updateable<ClientsTable>;

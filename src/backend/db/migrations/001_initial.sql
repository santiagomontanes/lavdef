CREATE TABLE IF NOT EXISTS company_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(150) NOT NULL DEFAULT 'Mi Negocio',
  legal_name VARCHAR(150) NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'COP',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(120) NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS counters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  counter_key VARCHAR(120) NOT NULL UNIQUE,
  prefix VARCHAR(20) NOT NULL,
  current_value INT NOT NULL DEFAULT 0,
  padding INT NOT NULL DEFAULT 6,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(20) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  module VARCHAR(80) NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  UNIQUE KEY uk_role_permission (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  role_id INT NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_measurements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  measurement_key VARCHAR(80) NOT NULL,
  measurement_value VARCHAR(80) NOT NULL,
  notes VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS service_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL
);
CREATE TABLE IF NOT EXISTS services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NULL,
  name VARCHAR(120) NOT NULL,
  base_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS garment_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS payment_methods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS order_statuses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT 'gray',
  is_final TINYINT(1) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS warranty_statuses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT 'amber'
);
CREATE TABLE IF NOT EXISTS expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS price_lists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS service_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  price_list_id INT NOT NULL,
  service_id INT NOT NULL,
  garment_type_id INT NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(30) NOT NULL UNIQUE,
  client_id INT NOT NULL,
  branch_id INT NULL,
  status_id INT NOT NULL,
  notes TEXT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_due DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  garment_type_id INT NULL,
  service_id INT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  status_id INT NOT NULL,
  notes VARCHAR(255) NULL,
  changed_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(30) NOT NULL UNIQUE,
  order_id INT NOT NULL,
  client_id INT NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invoice_items_snapshot (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  invoice_id INT NULL,
  payment_method_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  reference VARCHAR(120) NULL,
  received_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS discount_authorizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  authorized_by INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cash_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  opened_by INT NOT NULL,
  opening_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cash_closures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cash_session_id INT NOT NULL,
  closed_by INT NOT NULL,
  declared_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  system_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  difference_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cash_session_totals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cash_session_id INT NOT NULL,
  payment_method_id INT NOT NULL,
  system_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  counted_amount DECIMAL(12,2) NULL
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cash_session_id INT NOT NULL,
  movement_type VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cash_session_id INT NULL,
  category_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  description VARCHAR(255) NOT NULL,
  expense_date DATE NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS warranties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  status_id INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  resolution TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS warranty_status_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warranty_id INT NOT NULL,
  status_id INT NOT NULL,
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(80) NOT NULL,
  entity_id INT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS system_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_type VARCHAR(60) NOT NULL,
  document_number VARCHAR(60) NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS delivery_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  delivered_to VARCHAR(120) NOT NULL,
  delivered_by INT NULL,
  outstanding_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  ticket_code VARCHAR(60) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notification_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  message_template TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS notifications_whatsapp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NULL,
  order_id INT NULL,
  phone VARCHAR(30) NOT NULL,
  message_text TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS printers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  printer_type VARCHAR(60) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  sku VARCHAR(60) NULL,
  unit VARCHAR(20) NOT NULL,
  current_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stock_item_id INT NOT NULL,
  movement_type VARCHAR(20) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(60) NOT NULL,
  details_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO counters (counter_key, prefix, current_value, padding)
SELECT 'orders', 'ORD', 0, 6 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM counters WHERE counter_key = 'orders');
INSERT INTO counters (counter_key, prefix, current_value, padding)
SELECT 'invoices', 'FAC', 0, 6 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM counters WHERE counter_key = 'invoices');
INSERT INTO roles (name, description)
SELECT 'Administrador', 'Acceso total al sistema' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Administrador');
INSERT INTO users (role_id, username, password_hash, full_name, is_active)
SELECT 1, 'admin', 'admin', 'Administrador General', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');
INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'CREATED', 'Creada', 'slate', 0 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'CREATED');
INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'IN_PROGRESS', 'En proceso', 'amber', 0 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'IN_PROGRESS');
INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'READY', 'Lista', 'green', 0 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'READY');
INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'DELIVERED', 'Entregada', 'blue', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'DELIVERED');
INSERT INTO payment_methods (code, name, is_active)
SELECT 'cash', 'Efectivo', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE code = 'cash');
INSERT INTO payment_methods (code, name, is_active)
SELECT 'nequi', 'Nequi', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE code = 'nequi');
INSERT INTO payment_methods (code, name, is_active)
SELECT 'daviplata', 'Daviplata', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE code = 'daviplata');
INSERT INTO payment_methods (code, name, is_active)
SELECT 'transfer', 'Transferencia', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE code = 'transfer');
INSERT INTO payment_methods (code, name, is_active)
SELECT 'card', 'Tarjeta', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE code = 'card');
INSERT INTO service_categories (name, description)
SELECT 'Lavandería', 'Servicios generales de lavado' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'Lavandería');
INSERT INTO services (category_id, name, base_price, is_active)
SELECT 1, 'Lavado estándar', 12000, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Lavado estándar');
INSERT INTO garment_types (name, is_active)
SELECT 'Camisa', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM garment_types WHERE name = 'Camisa');
INSERT INTO company_settings (company_name, currency_code)
SELECT 'Mi Lavandería', 'COP' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM company_settings);

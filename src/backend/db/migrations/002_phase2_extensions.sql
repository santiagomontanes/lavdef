ALTER TABLE order_items ADD COLUMN IF NOT EXISTS color VARCHAR(80) NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS brand VARCHAR(80) NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size_reference VARCHAR(80) NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS material VARCHAR(80) NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_condition TEXT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS work_detail TEXT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stains TEXT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS damages TEXT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS missing_accessories TEXT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS customer_observations TEXT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS internal_observations TEXT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS surcharge_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS total DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS legal_text TEXT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS whatsapp_sent_at DATETIME NULL;

ALTER TABLE delivery_records ADD COLUMN IF NOT EXISTS receiver_document VARCHAR(60) NULL;
ALTER TABLE delivery_records ADD COLUMN IF NOT EXISTS receiver_phone VARCHAR(30) NULL;
ALTER TABLE delivery_records ADD COLUMN IF NOT EXISTS relationship_to_client VARCHAR(80) NULL;
ALTER TABLE delivery_records ADD COLUMN IF NOT EXISTS receiver_signature TEXT NULL;

INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'RECEIVED', 'Recibido', 'slate', 0 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'RECEIVED');

INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'READY_FOR_DELIVERY', 'Listo para entregar', 'green', 0 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'READY_FOR_DELIVERY');

INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'WARRANTY', 'En garantía', 'amber', 0 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'WARRANTY');

INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'CANCELED', 'Cancelado', 'red', 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'CANCELED');

INSERT INTO permissions (code, name, module)
SELECT 'orders.manage', 'Gestionar órdenes', 'orders' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'orders.manage');

INSERT INTO permissions (code, name, module)
SELECT 'payments.manage', 'Gestionar pagos', 'payments' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'payments.manage');

INSERT INTO permissions (code, name, module)
SELECT 'invoices.manage', 'Gestionar facturas', 'invoices' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'invoices.manage');

INSERT INTO permissions (code, name, module)
SELECT 'cash.manage', 'Gestionar caja', 'cash' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'cash.manage');

INSERT INTO permissions (code, name, module)
SELECT 'deliveries.manage', 'Gestionar entregas', 'deliveries' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'deliveries.manage');

-- =====================================================================
-- 019_payment_voids_and_idempotency.sql
--
-- Agrega soporte para anular pagos sin borrarlos y para detectar
-- reenvios accidentales del mismo formulario de pago.
--
-- Compatible con MySQL 8 sin usar ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- =====================================================================

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'status'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE payments ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT ''ACTIVE''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'voided_at'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE payments ADD COLUMN voided_at DATETIME NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'voided_by'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE payments ADD COLUMN voided_by INT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'void_reason'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE payments ADD COLUMN void_reason TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'idempotency_key'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE payments ADD COLUMN idempotency_key VARCHAR(140) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE payments
SET status = 'ACTIVE'
WHERE status IS NULL OR status = '';

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND INDEX_NAME = 'uk_payments_idempotency_key'
);
SET @sql := IF(
  @exists = 0,
  'CREATE UNIQUE INDEX uk_payments_idempotency_key ON payments (idempotency_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND INDEX_NAME = 'idx_payments_order_status_created'
);
SET @sql := IF(
  @exists = 0,
  'CREATE INDEX idx_payments_order_status_created ON payments (order_id, status, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND INDEX_NAME = 'idx_payments_duplicate_guard'
);
SET @sql := IF(
  @exists = 0,
  'CREATE INDEX idx_payments_duplicate_guard ON payments (order_id, payment_method_id, amount, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

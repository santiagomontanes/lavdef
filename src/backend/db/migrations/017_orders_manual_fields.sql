-- Add support for manual orders (paper notebooks / physical receipts).
-- Compatible con MySQL que NO soporta ALTER TABLE ADD COLUMN IF NOT EXISTS.

SET @db_name := DATABASE();

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'is_manual'
);

SET @sql := IF(
  @exists = 0,
  'ALTER TABLE orders ADD COLUMN is_manual TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'manual_order_number'
);

SET @sql := IF(
  @exists = 0,
  'ALTER TABLE orders ADD COLUMN manual_order_number VARCHAR(50) NULL',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'manual_order_date'
);

SET @sql := IF(
  @exists = 0,
  'ALTER TABLE orders ADD COLUMN manual_order_date DATE NULL',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_manual_number'
);

SET @sql := IF(
  @exists = 0,
  'CREATE UNIQUE INDEX idx_orders_manual_number ON orders (manual_order_number)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
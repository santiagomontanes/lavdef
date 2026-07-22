-- =====================================================================
-- 021_invoice_items_snapshot_full_columns.sql
--
-- BUG REPORT (producción): en el EXE instalado del cliente las
-- observaciones de prendas (NO USAR CLORO, etc.) no aparecían en la
-- factura impresa. La causa raíz es que la tabla invoice_items_snapshot
-- fue creada por 001_initial.sql con solo 5 columnas. Las observaciones
-- y los demás campos descriptivos nunca se agregaron en ninguna
-- migración posterior, por lo que en cualquier instalación nueva esas
-- columnas simplemente no existen.
--
-- El servicio de facturas (createFromOrder) filtra silenciosamente los
-- campos al snapshot según las columnas reales (information_schema), de
-- modo que en cliente nuevo las observaciones se "pierden" al guardarse.
--
-- COMPATIBILIDAD: usamos el patrón SET @exists / SET @sql / PREPARE /
-- EXECUTE / DEALLOCATE — el mismo que ya usan 017 y 019 — porque
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS no está disponible en todas
-- las builds de MySQL 8.0 que tenemos en producción. Cada columna se
-- añade de forma individual; el patrón es idempotente: si la columna
-- ya existe el statement se reemplaza por SELECT 1 (no-op).
--
-- ESTA MIGRACIÓN ES 100 % NO DESTRUCTIVA: no usa DELETE / DROP /
-- TRUNCATE / RECREATE. Solo añade columnas faltantes. Las filas previas
-- conservan sus datos; las columnas nuevas quedan en NULL (o con su
-- DEFAULT) y la migración 022 hace el backfill seguro desde order_items.
-- =====================================================================

-- ---------------------------------------------------------------------
-- garment_type_id
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'garment_type_id'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN garment_type_id INT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- service_id
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'service_id'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN service_id INT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- color
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'color'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN color VARCHAR(80) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- brand
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'brand'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN brand VARCHAR(80) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- size_reference
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'size_reference'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN size_reference VARCHAR(80) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- material
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'material'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN material VARCHAR(80) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- received_condition
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'received_condition'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN received_condition TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- work_detail
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'work_detail'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN work_detail TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- stains
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'stains'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN stains TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- damages
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'damages'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN damages TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- missing_accessories
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'missing_accessories'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN missing_accessories TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- customer_observations  (la columna crítica del bug)
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'customer_observations'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN customer_observations TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- internal_observations  (la otra columna crítica del bug)
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'internal_observations'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN internal_observations TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- discount_amount
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'discount_amount'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- surcharge_amount
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'surcharge_amount'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN surcharge_amount DECIMAL(12,2) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- total
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_items_snapshot'
    AND COLUMN_NAME = 'total'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE invoice_items_snapshot ADD COLUMN total DECIMAL(12,2) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

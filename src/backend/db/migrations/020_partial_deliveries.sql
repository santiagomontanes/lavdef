-- =====================================================================
-- 020_partial_deliveries.sql
--
-- Soporte para entregas parciales (un mismo pedido puede entregarse
-- en varios actos y con un saldo pendiente). Compatible con MySQL 8.0
-- en builds que no soportan ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- Idempotente y NO destructivo: usa el patrón SET @exists / SET @sql
-- / PREPARE / EXECUTE / DEALLOCATE para añadir cada columna solo si no
-- existe. El INSERT del estado nuevo usa NOT EXISTS para evitar
-- duplicados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- delivery_records.delivery_type
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'delivery_records'
    AND COLUMN_NAME = 'delivery_type'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE delivery_records ADD COLUMN delivery_type VARCHAR(20) NOT NULL DEFAULT ''COMPLETE''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- delivery_records.pending_delivery_notes
-- ---------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'delivery_records'
    AND COLUMN_NAME = 'pending_delivery_notes'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE delivery_records ADD COLUMN pending_delivery_notes TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- Estado 'PARTIAL_DELIVERY' (idempotente: solo inserta si no existe).
-- ---------------------------------------------------------------------
INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'PARTIAL_DELIVERY', 'Entrega parcial', 'amber', 0 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'PARTIAL_DELIVERY');

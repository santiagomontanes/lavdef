-- =====================================================================
-- 023_orders_idempotency.sql
--
-- Agrega una columna de idempotencia a `orders` para impedir que un
-- doble clic (o varios clics rápidos) en "Guardar orden" cree órdenes
-- duplicadas. El frontend genera una llave aleatoria por intento de
-- creación; si el backend recibe la misma llave dos veces, devuelve la
-- orden ya creada en vez de insertar una nueva.
--
-- Esta migración es puramente aditiva: no borra, no renombra y no
-- modifica ninguna orden existente. Las órdenes históricas quedan con
-- idempotency_key = NULL (permitido, la columna es NULLABLE y NULL no
-- colisiona con el índice UNIQUE en MySQL).
--
-- Compatible con MySQL 8 sin usar ALTER TABLE ... ADD COLUMN IF NOT
-- EXISTS (mismo patrón que 019_payment_voids_and_idempotency.sql).
-- =====================================================================

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'idempotency_key'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(140) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'uk_orders_idempotency_key'
);
SET @sql := IF(
  @exists = 0,
  'CREATE UNIQUE INDEX uk_orders_idempotency_key ON orders (idempotency_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

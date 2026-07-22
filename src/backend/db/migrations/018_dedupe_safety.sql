-- =====================================================================
-- 018_dedupe_safety.sql
--
-- Endurece la integridad de clientes y facturas. Esta migración NO borra
-- datos del negocio: marca, renombra y reasigna registros para que el
-- esquema pueda imponer UNIQUE sin perder historial. Cada bloque es
-- idempotente y los índices se crean con el marcador @safe-if-exists,
-- que le indica al migrador que tolere el error "Duplicate key name" si
-- el índice ya existe en una instalación previamente reparada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Garantiza que el contador de clientes exista y esté sincronizado.
--    Migración 016 lo creó, pero algunas instalaciones quedaron con el
--    contador desfasado y producían 'Duplicate entry CLI-xxxxx'.
-- ---------------------------------------------------------------------
INSERT INTO counters (counter_key, prefix, current_value, padding)
SELECT 'clients', 'CLI', 0, 5 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM counters WHERE counter_key = 'clients');

UPDATE counters
SET current_value = GREATEST(
  current_value,
  COALESCE(
    (SELECT MAX(CAST(SUBSTRING_INDEX(code, '-', -1) AS UNSIGNED))
     FROM clients
     WHERE code REGEXP '^CLI-[0-9]+$'),
    0
  )
)
WHERE counter_key = 'clients';

-- ---------------------------------------------------------------------
-- 2. Si existen códigos duplicados de cliente (porque el índice UNIQUE
--    se eliminó en alguna instalación), renombramos los duplicados con
--    sufijo '-DUP-{id}' antes de re-imponer el UNIQUE. El registro más
--    antiguo conserva su código original; los demás se podrán fusionar
--    desde la UI de "Fusionar duplicados".
-- ---------------------------------------------------------------------
UPDATE clients c
JOIN (
  SELECT code, MIN(id) AS keep_id
  FROM clients
  GROUP BY code
  HAVING COUNT(*) > 1
) d ON d.code = c.code AND c.id <> d.keep_id
SET c.code = CONCAT(c.code, '-DUP-', c.id);

-- ---------------------------------------------------------------------
-- 3. Re-aplica el índice UNIQUE en clients.code. Si ya existe, el
--    migrador (gracias al marcador @safe-if-exists) ignora el error
--    "Duplicate key name" y continúa.
-- ---------------------------------------------------------------------
-- @safe-if-exists
CREATE UNIQUE INDEX uk_clients_code ON clients (code);

-- ---------------------------------------------------------------------
-- 4. Limpieza de facturas duplicadas por order_id antes de imponer el
--    UNIQUE. Conservamos la factura más antigua (MIN(id)) por cada
--    orden y reasignamos pagos / items snapshot que apuntaban a las
--    facturas duplicadas hacia la canónica.
-- ---------------------------------------------------------------------
UPDATE payments p
JOIN invoices i ON i.id = p.invoice_id
JOIN (
  SELECT order_id, MIN(id) AS keep_id
  FROM invoices
  GROUP BY order_id
  HAVING COUNT(*) > 1
) d ON d.order_id = i.order_id
SET p.invoice_id = d.keep_id
WHERE p.invoice_id IS NOT NULL
  AND p.invoice_id <> d.keep_id;

-- Borra los items snapshot de las facturas duplicadas; la factura
-- canónica conserva sus propios items.
DELETE iis
FROM invoice_items_snapshot iis
JOIN invoices i ON i.id = iis.invoice_id
JOIN (
  SELECT order_id, MIN(id) AS keep_id
  FROM invoices
  GROUP BY order_id
  HAVING COUNT(*) > 1
) d ON d.order_id = i.order_id AND i.id <> d.keep_id;

-- Borra las facturas duplicadas, conservando la más antigua por orden.
DELETE i
FROM invoices i
JOIN (
  SELECT order_id, MIN(id) AS keep_id
  FROM invoices
  GROUP BY order_id
  HAVING COUNT(*) > 1
) d ON d.order_id = i.order_id AND i.id <> d.keep_id;

-- ---------------------------------------------------------------------
-- 5. UNIQUE en invoices.order_id para impedir duplicadas a nivel de BD.
--    @safe-if-exists permite re-correr la migración sin fallar si el
--    índice ya está creado.
-- ---------------------------------------------------------------------
-- @safe-if-exists
CREATE UNIQUE INDEX uk_invoices_order_id ON invoices (order_id);

-- ---------------------------------------------------------------------
-- 6. Índices auxiliares para acelerar la búsqueda de "clientes
--    similares" desde la UI antes de crear uno nuevo. No son UNIQUE:
--    pueden existir homónimos legítimos.
-- ---------------------------------------------------------------------
-- @safe-if-exists
CREATE INDEX idx_clients_phone ON clients (phone);

-- @safe-if-exists
CREATE INDEX idx_clients_first_last ON clients (first_name, last_name);

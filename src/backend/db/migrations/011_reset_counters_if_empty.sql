-- Resetea contadores a 0 solo si no hay registros reales en la tabla.
-- Esto corrige instalaciones nuevas donde la migración 006 sembró valores de un dump de producción.
UPDATE counters
SET current_value = 0
WHERE counter_key = 'orders'
  AND (SELECT COUNT(*) FROM orders) = 0;

UPDATE counters
SET current_value = 0
WHERE counter_key = 'invoices'
  AND (SELECT COUNT(*) FROM invoices) = 0;

-- =====================================================================
-- 022_backfill_invoice_snapshot_observations.sql
--
-- Backfill seguro y NO destructivo de invoice_items_snapshot. Las
-- facturas que ya existían en clientes con la versión anterior tienen
-- snapshots con observaciones en NULL (porque la columna no existía).
-- Esta migración rellena las observaciones leyendo desde order_items
-- vía la relación invoice -> order.
--
-- Estrategia anti-pérdida de datos:
--   * Solo se actualizan campos que están en NULL. Si el snapshot ya
--     tiene un valor (porque se regeneró tras la 021), NO se sobreescribe.
--   * El JOIN empareja por descripción + cantidad + unit_price + orden
--     para minimizar el riesgo de cruzar filas distintas cuando hay
--     varios items por orden. No se necesita 100 % exactitud: si una
--     fila no encuentra match deja el NULL y la próxima vez que se abra
--     la factura, createFromOrder regenera el snapshot completo.
--   * No se elimina ninguna fila, no se modifican totales ni descuentos.
-- =====================================================================

UPDATE invoice_items_snapshot iis
JOIN invoices i ON i.id = iis.invoice_id
JOIN order_items oi
  ON oi.order_id = i.order_id
 AND oi.description = iis.description
 AND oi.quantity = iis.quantity
 AND oi.unit_price = iis.unit_price
SET
  iis.customer_observations = COALESCE(iis.customer_observations, oi.customer_observations),
  iis.internal_observations = COALESCE(iis.internal_observations, oi.internal_observations),
  iis.garment_type_id       = COALESCE(iis.garment_type_id, oi.garment_type_id),
  iis.service_id            = COALESCE(iis.service_id, oi.service_id),
  iis.color                 = COALESCE(iis.color, oi.color),
  iis.brand                 = COALESCE(iis.brand, oi.brand),
  iis.size_reference        = COALESCE(iis.size_reference, oi.size_reference),
  iis.material              = COALESCE(iis.material, oi.material),
  iis.received_condition    = COALESCE(iis.received_condition, oi.received_condition),
  iis.work_detail           = COALESCE(iis.work_detail, oi.work_detail),
  iis.stains                = COALESCE(iis.stains, oi.stains),
  iis.damages               = COALESCE(iis.damages, oi.damages),
  iis.missing_accessories   = COALESCE(iis.missing_accessories, oi.missing_accessories);

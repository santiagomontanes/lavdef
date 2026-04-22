-- Sync order counter to the actual highest order_number in the table.
-- This fixes installations migrated from another system where the counters
-- table was seeded with a stale value, causing duplicate order_number errors.
UPDATE counters
SET current_value = COALESCE(
  (SELECT MAX(CAST(SUBSTRING_INDEX(order_number, '-', -1) AS UNSIGNED))
   FROM orders
   WHERE order_number REGEXP '^[A-Z]+-[0-9]+$'),
  current_value
)
WHERE counter_key = 'orders'
  AND COALESCE(
    (SELECT MAX(CAST(SUBSTRING_INDEX(order_number, '-', -1) AS UNSIGNED))
     FROM orders
     WHERE order_number REGEXP '^[A-Z]+-[0-9]+$'),
    0
  ) > current_value;

-- Same fix for invoices counter.
UPDATE counters
SET current_value = COALESCE(
  (SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '-', -1) AS UNSIGNED))
   FROM invoices
   WHERE invoice_number REGEXP '^[A-Z]+-[0-9]+$'),
  current_value
)
WHERE counter_key = 'invoices'
  AND COALESCE(
    (SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '-', -1) AS UNSIGNED))
     FROM invoices
     WHERE invoice_number REGEXP '^[A-Z]+-[0-9]+$'),
    0
  ) > current_value;

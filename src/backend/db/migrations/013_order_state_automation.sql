ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `whatsapp_created_sent` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `whatsapp_ready_sent` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `status_changed_at` DATETIME NULL;

INSERT INTO order_statuses (code, name, color, is_final)
SELECT 'READY_FOR_DELIVERY', 'Lista para entregar', 'teal', 0 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM order_statuses WHERE code = 'READY_FOR_DELIVERY');

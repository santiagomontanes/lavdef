INSERT INTO `app_settings` (`id`, `setting_key`, `setting_value`, `created_at`, `updated_at`)
VALUES (1,'order_protection_password','12345','2026-04-07 23:21:08','2026-04-08 00:05:12')
ON DUPLICATE KEY UPDATE
  `setting_key` = VALUES(`setting_key`),
  `setting_value` = VALUES(`setting_value`),
  `updated_at` = VALUES(`updated_at`);

INSERT INTO `counters` (`id`, `counter_key`, `prefix`, `current_value`, `padding`, `updated_at`)
VALUES
  (1,'orders','ORD',136,6,'2026-04-14 23:09:27'),
  (2,'invoices','FAC',37,6,'2026-04-15 00:32:18')
ON DUPLICATE KEY UPDATE
  `counter_key` = VALUES(`counter_key`),
  `prefix` = VALUES(`prefix`),
  `current_value` = VALUES(`current_value`),
  `padding` = VALUES(`padding`),
  `updated_at` = VALUES(`updated_at`);

INSERT INTO `permissions` (`id`, `code`, `name`, `module`)
VALUES
  (1,'orders.manage','Gestionar órdenes','orders'),
  (2,'payments.manage','Gestionar pagos','payments'),
  (3,'invoices.manage','Gestionar facturas','invoices'),
  (4,'cash.manage','Gestionar caja','cash'),
  (5,'deliveries.manage','Gestionar entregas','deliveries')
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `module` = VALUES(`module`);

INSERT INTO `order_statuses` (`id`, `code`, `name`, `color`, `is_final`)
VALUES
  (1,'CREATED','Creada','slate',0),
  (2,'IN_PROGRESS','En proceso','amber',0),
  (3,'READY','Lista','green',0),
  (4,'DELIVERED','Entregada','blue',1),
  (5,'RECEIVED','Recibido','slate',0),
  (6,'READY_FOR_DELIVERY','Listo para entregar','green',0),
  (7,'WARRANTY','En garantía','amber',0),
  (8,'CANCELED','Cancelado','red',1)
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `color` = VALUES(`color`),
  `is_final` = VALUES(`is_final`);

INSERT INTO `payment_methods` (`id`, `code`, `name`, `is_active`)
VALUES
  (1,'cash','Efectivo',1),
  (2,'nequi','Nequi',1),
  (3,'daviplata','Daviplata',1),
  (4,'transfer','Transferencia',1),
  (5,'card','Tarjeta',1)
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `is_active` = VALUES(`is_active`);

INSERT INTO `service_categories` (`id`, `name`, `description`)
VALUES (1,'Lavandería','Servicios generales de lavado')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`);

INSERT INTO `garment_types` (`id`, `name`, `is_active`)
VALUES (1,'Camisa',1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `is_active` = VALUES(`is_active`);

INSERT INTO `expense_categories` (`id`, `name`, `is_active`)
VALUES
  (1,'Arriendo',1),
  (2,'Servicios públicos',1),
  (3,'Papelería',1),
  (4,'Transporte',1),
  (5,'Insumos',1),
  (6,'Otros',1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `is_active` = VALUES(`is_active`);

INSERT INTO `warranty_statuses` (`id`, `code`, `name`, `color`)
VALUES
  (1,'OPEN','Abierta','amber'),
  (2,'RESOLVED','Resuelta','green'),
  (3,'CLOSED','Cerrada','blue')
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `color` = VALUES(`color`);

INSERT INTO `roles` (`id`, `name`, `description`, `created_at`)
VALUES (1,'Administrador','Acceso total al sistema','2026-03-24 22:30:26')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`);
INSERT INTO `roles` (`id`, `name`, `description`, `created_at`)
VALUES (2,'Vendedor','Acceso comercial y operativo',CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`);
INSERT INTO `users` (`id`, `branch_id`, `role_id`, `username`, `password_hash`, `full_name`, `is_active`, `created_at`)
VALUES (1,NULL,1,'admin','admin','Administrador General',1,'2026-03-24 22:30:26')
ON DUPLICATE KEY UPDATE
  `branch_id` = VALUES(`branch_id`),
  `role_id` = VALUES(`role_id`),
  `username` = VALUES(`username`),
  `password_hash` = VALUES(`password_hash`),
  `full_name` = VALUES(`full_name`),
  `is_active` = VALUES(`is_active`);

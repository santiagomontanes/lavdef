CREATE TABLE IF NOT EXISTS `ready_queue` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `queue_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `auto_process_after` DATETIME NULL,
  `checked_at` DATETIME NULL,
  `checked_by` INT NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_rq_order_date` (`order_id`, `queue_date`),
  INDEX `idx_rq_date` (`queue_date`),
  INDEX `idx_rq_status` (`status`),
  CONSTRAINT `fk_rq_order` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `message_queue` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `client_id` INT NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `message_text` TEXT NOT NULL,
  `trigger_type` VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
  `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  `scheduled_at` DATETIME NULL,
  `sent_at` DATETIME NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_mq_order` (`order_id`),
  INDEX `idx_mq_status` (`status`),
  CONSTRAINT `fk_mq_order` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
);

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS payment_method_id INT NULL;

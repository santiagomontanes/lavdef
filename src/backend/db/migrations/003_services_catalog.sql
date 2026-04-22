CREATE TABLE IF NOT EXISTS services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NULL,
  name VARCHAR(120) NOT NULL,
  base_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);

INSERT INTO services (name, base_price, is_active)
SELECT 'Lavado camisa', 8000, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Lavado camisa');

INSERT INTO services (name, base_price, is_active)
SELECT 'Lavado pantalón', 10000, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Lavado pantalón');

INSERT INTO services (name, base_price, is_active)
SELECT 'Planchado camisa', 4000, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Planchado camisa');

INSERT INTO services (name, base_price, is_active)
SELECT 'Ajuste de bota', 12000, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Ajuste de bota');

INSERT INTO services (name, base_price, is_active)
SELECT 'Cambio de cremallera', 18000, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Cambio de cremallera');
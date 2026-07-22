-- =====================================================================
-- 024_orders_listing_indexes.sql
--
-- Índices de apoyo para el nuevo listado paginado de órdenes
-- (orders:list-page). Puramente aditivo: solo crea índices, no toca
-- ninguna fila existente. Cada CREATE INDEX está marcado
-- @safe-if-exists para que el migrador tolere "Duplicate key name" si
-- el índice ya fue creado en una corrida previa.
-- =====================================================================

-- @safe-if-exists
CREATE INDEX idx_orders_client_id ON orders (client_id);

-- @safe-if-exists
CREATE INDEX idx_orders_status_id ON orders (status_id);

-- @safe-if-exists
CREATE INDEX idx_orders_created_at ON orders (created_at);

-- @safe-if-exists
CREATE INDEX idx_orders_client_status ON orders (client_id, status_id);

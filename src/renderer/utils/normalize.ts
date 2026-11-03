export const normalizeScan = (value: string | null | undefined) => {
  return String(value ?? '')
    .replace(/[‘’´`]/g, "'")   // normaliza comillas raras
    .replace(/'/g, '-')        // 🔥 convierte comillas a guion
    .replace(/[–—−]/g, '-')    // normaliza guiones raros
    .replace(/\s+/g, '')       // elimina espacios
    .trim()
    .toUpperCase();
};
// Igual que normalizeScan pero conserva los espacios (colapsados a uno) para
// poder buscar por nombre y apellido. No recorta al final: mientras se escribe
// hace falta el espacio para empezar la siguiente palabra.
export const normalizeSearchText = (value: string | null | undefined) => {
  return String(value ?? '')
    .replace(/[‘’´`]/g, "'")
    .replace(/'/g, '-')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\s+/, '')
    .toUpperCase();
};

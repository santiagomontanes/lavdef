export const normalizeScan = (value: string | null | undefined) => {
  return String(value ?? '')
    .replace(/[‘’´`]/g, "'")   // normaliza comillas raras
    .replace(/'/g, '-')        // 🔥 convierte comillas a guion
    .replace(/[–—−]/g, '-')    // normaliza guiones raros
    .replace(/\s+/g, '')       // elimina espacios
    .trim()
    .toUpperCase();
};
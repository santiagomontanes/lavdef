// Búsqueda de clientes tolerante en el renderer. Debe comportarse igual
// que clients.searchByName del backend: sin tildes, sin importar
// mayúsculas, sin importar el orden de las palabras y sin importar cómo se
// haya escrito el teléfono. Objetivo: que un cliente existente nunca
// "desaparezca" de la búsqueda y el operario no lo cree otra vez.

export type SearchableClient = {
  firstName: string;
  lastName: string;
  phone: string;
  code: string;
};

export const normalizeSearchText = (value: string | number | null | undefined) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const onlyDigits = (value: string | number | null | undefined) =>
  String(value ?? '').replace(/\D/g, '');

export const clientMatchesSearch = (client: SearchableClient, term: string) => {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return true;

  const haystack = normalizeSearchText(
    `${client.firstName} ${client.lastName} ${client.phone} ${client.code}`
  );
  const phoneDigits = onlyDigits(client.phone);
  const codeDigits = onlyDigits(client.code);

  // Todas las palabras deben aparecer en algún campo, en cualquier orden.
  return normalizedTerm.split(' ').every((token) => {
    if (haystack.includes(token)) return true;

    const tokenDigits = onlyDigits(token);
    if (tokenDigits.length < 3) return false;
    return phoneDigits.includes(tokenDigits) || codeDigits.includes(tokenDigits);
  });
};

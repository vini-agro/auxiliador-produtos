/**
 * Extrai código do curso, data (DDMMYYYY) e o restante (professor+título)
 * do nome de um vídeo do Vimeo, no padrão observado na pasta "MBA - LW":
 *   {CÓDIGO}[_ ]{DDMMYYYY}[_ ]{resto}
 * @param {string} name
 * @returns {{code: string, date: string, rest: string} | null}
 */
export function parseVideoName(name) {
  const match = name.match(/^([A-Za-zÀ-ÿ]+)[_ ](\d{8})[_ ](.+)$/);
  if (!match) return null;
  const [, code, date, rest] = match;
  return { code, date, rest };
}

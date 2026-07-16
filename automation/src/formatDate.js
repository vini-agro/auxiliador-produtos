/**
 * @param {string} ddmmyyyy - ex: "01062026"
 * @returns {string} formato ISO "YYYY-MM-DD"
 */
export function ddmmyyyyToIso(ddmmyyyy) {
  const dd = ddmmyyyy.slice(0, 2);
  const mm = ddmmyyyy.slice(2, 4);
  const yyyy = ddmmyyyy.slice(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}

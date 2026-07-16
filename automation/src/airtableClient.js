import Airtable from 'airtable';

function getBase() {
  return new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(process.env.AIRTABLE_BASE_ID);
}

/**
 * Busca registros de "Op 4.0 (Calendário Operacional)" numa data específica.
 * @param {string} iso - formato "YYYY-MM-DD"
 * @returns {Promise<object[]>} registros crus do Airtable (com .fields)
 */
export async function findOpEventoByDate(iso) {
  const base = getBase();
  const records = await base('Op 4.0 (Calendário Operacional)')
    .select({ filterByFormula: `{Data} = '${iso}'` })
    .all();
  return records.map((r) => ({ id: r.id, fields: r.fields }));
}

/**
 * @param {string} aulaRecordId
 * @returns {Promise<string|null>}
 */
export async function getAulaLwUnitUrl(aulaRecordId) {
  const base = getBase();
  let record;
  try {
    record = await base('Aulas').find(aulaRecordId);
  } catch (err) {
    if (err && err.error === 'NOT_FOUND') return null;
    throw err;
  }
  return record.fields['LW Unit URL'] || null;
}

/**
 * @param {string} eventoCursoRecordId
 * @returns {Promise<string|null>}
 */
export async function getLinkCsat(eventoCursoRecordId) {
  const base = getBase();
  let record;
  try {
    record = await base('Evento × Curso').find(eventoCursoRecordId);
  } catch (err) {
    if (err && err.error === 'NOT_FOUND') return null;
    throw err;
  }
  return record.fields['LINK CSAT'] || null;
}

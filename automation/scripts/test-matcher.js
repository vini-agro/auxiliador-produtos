import 'dotenv/config';
import { findOpEventoByDate } from '../src/airtableClient.js';
import { ddmmyyyyToIso } from '../src/formatDate.js';

// Data real confirmada no vídeo "GPA_01062026_MARCOS NASCIMBEM FERRAZ_..."
const iso = ddmmyyyyToIso('01062026');
const records = await findOpEventoByDate(iso);

console.log(`Encontrados ${records.length} registro(s) em Op 4.0 pra data ${iso}:`);
for (const r of records) {
  console.log('-', r.id, '|', r.fields['Nome do Evento'], '| Professor:', r.fields['Professor']);
}

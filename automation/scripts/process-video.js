// automation/scripts/process-video.js
import 'dotenv/config';
import { parseVideoName } from '../src/parseVideoName.js';
import { ddmmyyyyToIso } from '../src/formatDate.js';
import { generateEmbedHtml } from '../src/generateEmbedHtml.js';
import { findOpEventoByDate, getAulaLwUnitUrl, getLinkCsat } from '../src/airtableClient.js';
import { updateEmbedUnit } from '../src/lwRobot.js';
import { formatResultLine } from '../src/resultReporter.js';

const [videoName, vimeoEmbedUrl] = process.argv.slice(2);

if (!videoName || !vimeoEmbedUrl) {
  console.error('Uso: node process-video.js "<nome do video>" "<url de embed do vimeo>"');
  process.exit(1);
}

const parsed = parseVideoName(videoName);
if (!parsed) {
  const reason = `nome de vídeo fora do padrão esperado: ${videoName}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const iso = ddmmyyyyToIso(parsed.date);
const eventos = await findOpEventoByDate(iso);

if (eventos.length === 0) {
  const reason = `nenhum evento em "Op 4.0" pra data ${iso} (vídeo: ${videoName})`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}
if (eventos.length > 1) {
  const reason = `${eventos.length} eventos ambíguos pra data ${iso} — desambiguação por professor ainda não implementada`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const evento = eventos[0];
const aulaIds = evento.fields['Aula'] || [];
const eventoCursoIds = evento.fields['Evento × Curso (espelho)'] || [];

if (aulaIds.length === 0) {
  const reason = `evento sem Aula vinculada: ${evento.id}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const lwUnitUrl = await getAulaLwUnitUrl(aulaIds[0]);
if (!lwUnitUrl) {
  const reason = `Aula sem "LW Unit URL" cadastrado ainda: ${aulaIds[0]}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

if (eventoCursoIds.length === 0) {
  const reason = `evento sem "Evento × Curso" vinculado: ${evento.id}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const csatLink = await getLinkCsat(eventoCursoIds[0]);
if (!csatLink) {
  const reason = `sem LINK CSAT pra Evento × Curso: ${eventoCursoIds[0]}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const html = generateEmbedHtml({ vimeoEmbedUrl, csatLink });

const courseTitleId = lwUnitUrl.split('/courses/')[1]?.split('/')[0];
if (!courseTitleId) {
  const reason = `não foi possível extrair courseTitleId de "${lwUnitUrl}"`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

console.log('Colando embed na LW, unit URL:', lwUnitUrl);
const result = await updateEmbedUnit({
  adminUrl: process.env.LW_ADMIN_URL,
  email: process.env.LW_ADMIN_EMAIL,
  password: process.env.LW_ADMIN_PASSWORD,
  courseTitleId,
  unitName: 'Aula Teste',
  html,
});

console.log(result);
if (result.ok) {
  console.log(formatResultLine('ok'));
} else {
  console.log(formatResultLine('error', { message: result.error }));
}

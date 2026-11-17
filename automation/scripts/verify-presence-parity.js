import 'dotenv/config';
import fs from 'fs';
import { fetchOauthToken } from './lw-oauth.js';

const adminUrl = process.env.LW_ADMIN_URL;
const baseUrl = adminUrl.replace(/\/admin\/?$/, '');
const OAUTH_CLIENT = process.env.LW_API_CLIENT_ID;
const OAUTH_SECRET = process.env.LW_API_CLIENT_SECRET;
const API_BASE = baseUrl + '/admin/api/v2';

const [courseSlug, zoomUnitId, videoUnitId, outputFile] = process.argv.slice(2);
if (!videoUnitId) {
  console.error('uso: node verify-presence-parity.js <courseSlug> <zoomUnitId> <videoUnitId> [outputFile]');
  console.error('Compara quem completou o Zoom vs quem completou o video/embed correspondente.');
  console.error('Rode isso ANTES de apagar a unit de Zoom - se sobrar mismatch, NAO apague ainda.');
  process.exit(1);
}

async function fetchWithRetry(doFetch, maxRetries = 5) {
  for (let attempt = 0; ; attempt++) {
    const resp = await doFetch();
    if (resp.status !== 429) return resp;
    if (attempt >= maxRetries) return resp;
    const wait = 500 * 2 ** attempt + Math.random() * 250;
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function apiGet(token, path) {
  const resp = await fetchWithRetry(() => fetch(API_BASE + path, {
    headers: { Authorization: 'Bearer ' + token, 'Lw-Client': OAUTH_CLIENT },
  }));
  return resp.json();
}

async function getAllUsers(token, slug) {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const resp = await apiGet(token, '/courses/' + slug + '/users?page=' + page + '&items_per_page=50');
    all.push(...(resp.data || []));
    totalPages = resp.meta ? resp.meta.totalPages : 1;
    page++;
  } while (page <= totalPages);
  return all;
}

function findUnitStatus(progress, unitId) {
  const sections = progress.progress_per_section_unit || [];
  for (const sec of sections) {
    for (const u of sec.units || []) {
      if (u.unit_id === unitId) return u.unit_status;
    }
  }
  return null;
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runNext() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
  return results;
}

// A API v2 do LW aplica um rate limit por rajada bem mais agressivo do que o
// documentado antes (confirmado 2026-08-31: concorrencia 3 e 8 disparam 429
// na hora, so 1 requisicao por vez com espacamento passa). Nao paralelizar
// aqui - CONCURRENCY=1 mantem o comportamento sequencial original, so trocando
// o delay fixo por retry/backoff em cima de 429.
const CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY || 1);

const token = await fetchOauthToken({ baseUrl, clientId: OAUTH_CLIENT, clientSecret: OAUTH_SECRET });
const users = await getAllUsers(token, courseSlug);

let zoomCompleted = 0;
let videoCompleted = 0;
const missingVideo = []; // zoom ok, video nao -> perigoso apagar o zoom
const missingZoom = []; // video ok, zoom nao -> so informativo (aluno assistiu gravado sem ir ao vivo)

const perUser = await runPool(users, async (u) => {
  const progress = await apiGet(token, '/users/' + u.id + '/courses/' + courseSlug + '/progress');
  await new Promise((r) => setTimeout(r, 150));
  return { u, zoomStatus: findUnitStatus(progress, zoomUnitId), videoStatus: findUnitStatus(progress, videoUnitId) };
}, CONCURRENCY);

for (const { u, zoomStatus, videoStatus } of perUser) {
  if (zoomStatus === 'completed') {
    zoomCompleted++;
    if (videoStatus !== 'completed') {
      missingVideo.push({ id: u.id, email: u.email, name: u.username, zoomStatus, videoStatus });
    }
  }
  if (videoStatus === 'completed') {
    videoCompleted++;
    if (zoomStatus !== 'completed') {
      missingZoom.push({ id: u.id, email: u.email, name: u.username, zoomStatus, videoStatus });
    }
  }
}

const report = {
  courseSlug,
  zoomUnitId,
  videoUnitId,
  totalUsers: users.length,
  zoomCompleted,
  videoCompleted,
  missingVideo,
  missingZoom,
  safeToDeleteZoom: missingVideo.length === 0,
};

console.log('=== VERIFICACAO DE PARIDADE DE PRESENCA ===');
console.log('Curso:', courseSlug);
console.log('Total alunos:', users.length);
console.log('Zoom completed:', zoomCompleted, '| Video completed:', videoCompleted);
console.log('Alunos com Zoom OK mas video NAO (perdem presenca se apagar o Zoom agora):', missingVideo.length);
if (missingVideo.length > 0) {
  missingVideo.forEach((u) => console.log('  -', u.name, `<${u.email}>`, '| video:', u.videoStatus));
}
console.log('Alunos com video OK mas Zoom nao (so informativo):', missingZoom.length);
console.log('');
console.log(missingVideo.length === 0
  ? '>>> SEGURO apagar a unit de Zoom: todo mundo que completou o Zoom ja tem o video completo tambem.'
  : `>>> NAO apague o Zoom ainda: ${missingVideo.length} aluno(s) ainda vao perder a presenca.`);

if (outputFile) {
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log('\nRelatorio completo salvo em', outputFile);
}

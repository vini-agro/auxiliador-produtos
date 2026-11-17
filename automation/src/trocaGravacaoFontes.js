// Leitores (so leitura) do robo troca-gravacao e do robo de materiais (17/nov/2026):
// Vimeo, Teamup, Agrotable (Postgres da intranet via tunel SSH) e LW (sessao Playwright + API v2).
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { extrairLinksDoComentario } from './revisorCsat.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const SESSAO = path.join(process.cwd(), '.lw-session-state.json');
const PSQL = process.env.PSQL_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const PORTA = 15432;

async function json(url, opcoes = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000), ...opcoes });
  if (!r.ok) throw new Error(`${r.status} em ${url.split('?')[0]}`);
  return r.json();
}

// ---------- Vimeo ----------
/** Videos do Vimeo criados desde `desde` (YYYY-MM-DD), mais novos primeiro. */
export async function gravacoesRecentes({ desde }) {
  const saida = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const url = `https://api.vimeo.com/me/videos?per_page=100&page=${pagina}&sort=date&direction=desc&fields=uri,name,duration,created_time,player_embed_url`;
    const dados = await json(url, { headers: { Authorization: `Bearer ${process.env.VIMEO_TOKEN}`, Accept: 'application/vnd.vimeo.*+json;version=3.4' } });
    let acabou = false;
    for (const v of dados.data || []) {
      if ((v.created_time || '').slice(0, 10) < desde) { acabou = true; break; }
      saida.push({ id: (v.uri || '').split('/').pop(), nome: v.name, duracao: v.duration, criado: v.created_time, embedUrl: v.player_embed_url });
    }
    if (acabou || (dados.data || []).length < 100) break;
  }
  return saida;
}

// ---------- Teamup ----------
export async function eventosTeamup(inicio, fim) {
  const url = `https://api.teamup.com/${process.env.TEAMUP_CALENDAR_KEY}/events?startDate=${inicio}&endDate=${fim}`;
  const dados = await json(url, { headers: { 'Teamup-Token': process.env.TEAMUP_API_KEY } });
  return (dados.events || []).map((e) => ({
    id: e.id,
    titulo: e.title,
    data: e.start_dt.slice(0, 10),
    agendas: e.subcalendar_ids,
    turmas: (e.comments || []).flatMap((c) => extrairLinksDoComentario(c.message)),
  }));
}

// ---------- Agrotable ----------
function portaAberta() {
  return new Promise((ok) => {
    const s = net.connect(PORTA, '127.0.0.1');
    s.once('connect', () => { s.destroy(); ok(true); });
    s.once('error', () => ok(false));
  });
}

/** Garante o tunel do Postgres da intranet em localhost:15432. Devolve a funcao que fecha (no-op se ja estava aberto). */
export async function abrirTunelAgrotable() {
  if (await portaAberta()) return () => {};
  const ssh = spawn('ssh', ['-i', process.env.AGROTABLE_SSH_KEY, '-N', '-L', `${PORTA}:127.0.0.1:5432`,
    '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', process.env.AGROTABLE_SSH_HOST], { stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    if (await portaAberta()) return () => ssh.kill();
    await new Promise((r) => setTimeout(r, 1000));
  }
  ssh.kill();
  throw new Error('tunel do Agrotable nao abriu em 30 s');
}

// Mesma consulta de listarLinksCsat (intranet: operacional/agrotable/evento-pesquisa-links.ts).
const SQL_EVENTOS = (inicio, fim) => `
SELECT coalesce(json_agg(x), '[]') FROM (
  SELECT c.id, to_char(c.nome_completo::date, 'YYYY-MM-DD') AS data, c.tipo_de_entrega AS "tipoEntrega",
    c.status_do_evento_processual AS status,
    (SELECT string_agg(au.nome_da_aula, ' + ' ORDER BY au.nome_da_aula)
       FROM op4_j_calendario_operacional__aula ja JOIN op4_aulas au ON au.id = ja.aulas_id
      WHERE ja.calendario_operacional_id = c.id) AS aula,
    (SELECT coalesce(json_agg(DISTINCT cu.sigla) FILTER (WHERE coalesce(cu.sigla, '') <> ''), '[]')
       FROM op4_j_calendario_operacional__turmas jt
       JOIN op4_j_turmas__curso jc ON jc.turmas_id = jt.turmas_id
       JOIN op4_cursos cu ON cu.id = jc.cursos_id
      WHERE jt.calendario_operacional_id = c.id) AS siglas
  FROM op4_calendario_operacional c
  WHERE c.nome_completo IS NOT NULL
    AND c.nome_completo::date BETWEEN '${inicio}' AND '${fim}'
    AND upper(coalesce(c.status_do_evento_processual, '')) <> 'CANCELADO'
) x;`;

/** Eventos do Calendario Operacional do Agrotable entre duas datas (YYYY-MM-DD). So leitura. */
export function eventosAgrotable(inicio, fim) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new Error('datas invalidas');
  const saida = execFileSync(PSQL, ['-h', 'localhost', '-p', String(PORTA), '-U', process.env.AGROTABLE_PG_USER,
    '-d', process.env.AGROTABLE_PG_DB || 'intranet', '-tA', '-v', 'ON_ERROR_STOP=1', '-c',
    `SET default_transaction_read_only = on; ${SQL_EVENTOS(inicio, fim)}`],
  { env: { ...process.env, PGPASSWORD: process.env.AGROTABLE_PG_PASSWORD }, encoding: 'utf8', timeout: 60000 });
  // json_agg quebra linha entre os itens; a 1a linha e' o "SET" do read-only
  const json = saida.split(/\r?\n/).filter((l) => l.trim() && l.trim() !== 'SET').join('');
  return JSON.parse(json);
}

// ---------- LW ----------
export async function abrirLw(browser) {
  const baseUrl = process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '');
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1400, height: 1000 }, ...(fs.existsSync(SESSAO) ? { storageState: SESSAO } : {}) });
  const page = await context.newPage();
  await page.route('**/*getbeamer.com/**', (r) => r.abort());
  await page.goto(`${baseUrl}/library`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (page.url().includes('not-logged-in') || page.url().replace(/\/$/, '') === baseUrl) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.getByRole('link', { name: 'ENTRAR' }).first().click();
    await page.locator('#signin-email').fill(process.env.LW_ADMIN_EMAIL);
    await page.locator('#signin-password').fill(process.env.LW_ADMIN_PASSWORD);
    await page.locator('#submitLogin').click();
    await page.getByText('Courses & programs').waitFor({ state: 'visible', timeout: 20000 });
    await context.storageState({ path: SESSAO });
  }
  return page;
}

/** Units do curso (titulo, tipo, anexos, secao) pela API interna de sessao; null se nao der para ler. */
export async function unitsDoCurso(page, slug) {
  const dados = await page.evaluate(async (s) => {
    const r = await fetch(`/api/course/${s}?contents&path-player`, { credentials: 'include' });
    return r.ok ? r.json() : null;
  }, slug).catch(() => null);
  if (!dados) return null;
  const mapa = new Map();
  for (const secao of Object.values((dados.course && dados.course.sections) || {})) {
    for (const u of secao.learningPath || []) {
      // quando o nome ja existe no storage a LW grava como "2-<nome>": conta como o mesmo arquivo
      const nomes = (u.attachments || []).map((a) => a.title || a.file);
      mapa.set(u.id, { titulo: u.unitTitle || u.title || '', tipo: u.type, secao: secao.title || '', qtd: nomes.length, anexos: [...nomes, ...nomes.map((n) => n.replace(/^\d+-/, ''))] });
    }
  }
  return mapa;
}

let tokenV2 = null;
/** Categorias do curso pela API v2 (OAuth). */
export async function categoriasDoCurso(slug) {
  const baseUrl = process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '');
  if (!tokenV2) {
    const corpo = `client_id=${process.env.LW_API_CLIENT_ID}&client_secret=${process.env.LW_API_CLIENT_SECRET}&grant_type=client_credentials`;
    const t = await json(`${baseUrl}/admin/api/oauth2/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo });
    tokenV2 = t.tokenData.access_token;
  }
  const c = await json(`${baseUrl}/admin/api/v2/courses/${slug}`, { headers: { Authorization: `Bearer ${tokenV2}`, 'Lw-Client': process.env.LW_API_CLIENT_ID } });
  return (c.categories || []).map((x) => (typeof x === 'string' ? x : x.title || x.name || ''));
}

/** HTML de dentro do Embed (iframe do path-player); '' se vazio ou nao renderizou. */
export async function htmlDoEmbed(page, slug, unitId) {
  const baseUrl = process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '');
  await page.goto(`${baseUrl}/path-player?courseid=${slug}&unit=${unitId}Unit`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const limite = Date.now() + 25000;
  while (Date.now() < limite) {
    const frame = page.frames().find((f) => f.url().includes('objectType=embed'));
    if (frame) {
      await page.waitForTimeout(2500);
      return frame.evaluate(() => (document.body ? document.body.innerHTML : '')).catch(() => '');
    }
    await page.waitForTimeout(500);
  }
  return '';
}

// ---------- pasta Share (materiais) ----------
const FORA_DA_SHARE = new Set(['Contratos', 'Notas fiscais', 'Provas', 'Exame final', 'Eventos', 'Graduação']);

// O atalho "Adicionar a Meus arquivos" aparece no PC como "Arquivos de <dona> - Share".
export function pastaShareNoOneDrive() {
  const od = process.env.OneDriveCommercial || process.env.OneDrive || '';
  const nomes = fs.existsSync(od) ? fs.readdirSync(od) : [];
  const achada = nomes.find((n) => n === 'Share') || nomes.find((n) => / - Share$/.test(n));
  return path.join(od, achada || 'Share');
}

/** Caminhos relativos (B2B|B2C/curso/...) de todos os arquivos da pasta Share. */
export function caminhosDaPasta(raiz) {
  if (!fs.existsSync(raiz)) {
    throw new Error(`pasta Share nao encontrada em "${raiz}". Adicione o atalho da pasta no OneDrive ("Adicionar atalho a Meus arquivos") ou passe --pasta / --listagem.`);
  }
  const saida = [];
  const andar = (dir, rel, nivel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'desktop.ini' || e.name.startsWith('~$')) continue;
      if (nivel === 0 && (!e.isDirectory() || FORA_DA_SHARE.has(e.name))) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (nivel < 4) andar(path.join(dir, e.name), r, nivel + 1); }
      else saida.push(r);
    }
  };
  andar(raiz, '', 0);
  return saida;
}

/** Estrutura do curso pela API v2: [{id, title, units: [[id, tipo, titulo]]}] na ordem das secoes (mesma do editor). */
export async function estruturaV2(slug) {
  await categoriasDoCurso(slug); // garante o token
  const baseUrl = process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '');
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const r = await fetch(`${baseUrl}/admin/api/v2/courses/${slug}/contents`, { headers: { Authorization: `Bearer ${tokenV2}`, 'Lw-Client': process.env.LW_API_CLIENT_ID }, signal: AbortSignal.timeout(60000) });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    if (!r.ok) throw new Error(`${r.status} em contents de ${slug}`);
    const j = await r.json();
    return (j.sections || []).map((s) => ({ id: s.id, title: s.title, units: (s.learningUnits || []).map((u) => [u.id, u.type, u.title]) }));
  }
  throw new Error(`429 repetido em contents de ${slug}`);
}

// ---------- robo de Presenca Zoom (n8n) ----------
const N8N = 'https://editor.agroadvance.com.br/api/v1';
const WORKFLOW_PRESENCA = 'na42taXeTMbq3IAv';

/**
 * Dispara o robo de Presenca Zoom para a data (GRAVA presenca: so da', nunca tira) e espera a
 * execucao terminar. Devolve o json do node "Presenca Zoom 75%" ({dryRun, relatorio[...]}).
 * `extra` = parametros a mais do webhook (ex. "teste=1&unit=<id>" no curso de teste).
 */
export async function dispararPresencaZoom(dataIso, extra = '') {
  const [a, m, d] = dataIso.split('-');
  const cab = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
  const t0 = Date.now() - 5000;
  const r = await fetch(`${process.env.PRESENCA_ZOOM_WEBHOOK_URL}?data=${d}/${m}/${a}${extra ? '&' + extra : ''}`, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`webhook do robo de Presenca Zoom respondeu ${r.status}`);
  const limite = Date.now() + 20 * 60000;
  let exec = null;
  while (Date.now() < limite) {
    await new Promise((ok) => setTimeout(ok, 15000));
    for (const status of ['running', 'success', 'error']) {
      const lista = await json(`${N8N}/executions?workflowId=${WORKFLOW_PRESENCA}&status=${status}&limit=5`, { headers: cab });
      const e = (lista.data || []).find((x) => x.mode === 'webhook' && Date.parse(x.startedAt) >= t0);
      if (e) { exec = e; break; }
    }
    if (exec && exec.status !== 'running') break;
  }
  if (!exec) throw new Error('execucao do robo de Presenca Zoom nao apareceu no n8n');
  if (exec.status === 'running') throw new Error(`robo de Presenca Zoom ainda rodando apos 20 min (execucao ${exec.id})`);
  if (exec.status !== 'success') throw new Error(`robo de Presenca Zoom terminou com ${exec.status} (execucao ${exec.id})`);
  const completa = await json(`${N8N}/executions/${exec.id}?includeData=true`, { headers: cab });
  const runs = completa.data && completa.data.resultData && completa.data.resultData.runData['Presença Zoom 75%'];
  const item = runs && runs[0].data && runs[0].data.main[0] && runs[0].data.main[0][0];
  if (!item) throw new Error(`execucao ${exec.id} sem saida do node "Presença Zoom 75%"`);
  return { ...item.json, execucao: exec.id };
}

/** Id interno do curso (o que a marcacao de presenca usa como courseId/cohortId). */
export async function idInternoDoCurso(page, slug) {
  return page.evaluate(async (s) => {
    const r = await fetch(`/api/course/${s}?contents&path-player`, { credentials: 'include' });
    return r.ok ? (await r.json()).course.id : null;
  }, slug);
}

// ---------- Teams (mesmo webhook e chat do revisor de CSAT) ----------
export async function avisarNoTeams(mensagem) {
  const { REVISOR_CSAT_TEAMS_WEBHOOK: webhook, REVISOR_CSAT_TEAMS_CHAT_ID: chatId, REVISOR_CSAT_TEAMS_HEADER_NOME: hn, REVISOR_CSAT_TEAMS_HEADER_VALOR: hv } = process.env;
  if (!webhook || !chatId || !hn || !hv) throw new Error('faltam dados do Teams no .env');
  const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', [hn]: hv }, body: JSON.stringify({ chatId, message: mensagem }), signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Teams respondeu ${r.status}`);
}

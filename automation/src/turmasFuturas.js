// Turmas que ainda nao comecaram (data de inicio no Airtable depois de hoje).
// Pedido do usuario (18/nov/2026): turma do ano seguinte (ex. PCA t8, fev/2027) nao deve receber
// conteudo; os robos (materiais, troca de gravacao, revisor de CSAT, divisor) pulam essas turmas.
// Fonte: tabela Turmas da base Op 4.0 (slug da LW + data de inicio). Se o Airtable falhar, usa a
// ultima leitura salva em .turmas-inicio.json; sem as duas, nao pula nada e avisa.
import fs from 'fs';
import path from 'path';

const TABELA = 'tblTugTZ6Hv9CPLp7';
const CAMPO_NOME = 'fldmDhNzR9bi2MdNR'; // "PCA t8"
const CAMPO_SLUG = 'fld0H0VcqEjToaisK'; // slug do curso na LW
const CAMPO_INICIO = 'fldGIcwhiNucphzWl'; // AAAA-MM-DD
const CACHE = path.join(process.cwd(), '.turmas-inicio.json');

export function hojeLocalIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Puro: das turmas [{nome, slug, inicio}], as que tem slug e comecam depois de hoje. Map slug -> {nome, inicio}. */
export function turmasFuturas(turmas, hojeIso) {
  const mapa = new Map();
  for (const t of turmas || []) {
    if (!t.slug || !/^\d{4}-\d{2}-\d{2}/.test(t.inicio || '')) continue;
    if (t.inicio.slice(0, 10) > hojeIso) mapa.set(t.slug, { nome: t.nome || t.slug, inicio: t.inicio.slice(0, 10) });
  }
  return mapa;
}

/**
 * Puro: tira as turmas futuras de cada evento ({turmas: [{courseid}]}). O evento continua na lista
 * (o robo ainda acha a aula), com `turmasPuladas` = quantas sairam; se so tinha turma futura,
 * fica com turmas = [] e turmasPuladas > 0 (nao e' "evento sem link").
 */
export function semTurmasFuturas(eventos, futuras) {
  const pulados = [];
  const saida = [];
  for (const ev of eventos || []) {
    const turmas = ev.turmas || [];
    const fora = turmas.filter((t) => futuras.has(t.courseid));
    if (!fora.length) { saida.push(ev); continue; }
    for (const t of fora) pulados.push({ titulo: ev.titulo, courseid: t.courseid, ...futuras.get(t.courseid) });
    saida.push({ ...ev, turmas: turmas.filter((t) => !futuras.has(t.courseid)), turmasPuladas: fora.length });
  }
  return { eventos: saida, pulados };
}

/** Linha de log/relatorio com as turmas puladas (uma por turma, sem repetir). */
export function textoPuladas(pulados) {
  const unicas = new Map();
  for (const p of pulados) if (!unicas.has(p.courseid)) unicas.set(p.courseid, p);
  return [...unicas.values()].map((p) => `${p.nome} (${p.courseid}, comeca ${p.inicio.split('-').reverse().join('/')})`).join(', ');
}

async function lerDoAirtable(fetchFn) {
  const turmas = [];
  let offset = null;
  do {
    const p = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' });
    for (const f of [CAMPO_NOME, CAMPO_SLUG, CAMPO_INICIO]) p.append('fields[]', f);
    if (offset) p.set('offset', offset);
    const r = await fetchFn(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${TABELA}?${p}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }, signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`Airtable respondeu ${r.status}`);
    const j = await r.json();
    for (const rec of j.records || []) {
      const f = rec.fields || {};
      turmas.push({ nome: f[CAMPO_NOME] || null, slug: f[CAMPO_SLUG] || null, inicio: f[CAMPO_INICIO] || null });
    }
    offset = j.offset;
  } while (offset);
  return turmas;
}

/**
 * Turmas que ainda nao comecaram. Nunca lanca: devolve {futuras, origem, erro}.
 * origem = 'airtable' | 'cache' | 'nenhuma' (nenhuma = nao pula nada; o robo deve avisar no log).
 */
export async function turmasQueNaoComecaram({ hojeIso = hojeLocalIso(), fetchFn = fetch, cache = CACHE } = {}) {
  try {
    const turmas = await lerDoAirtable(fetchFn);
    try { fs.writeFileSync(cache, JSON.stringify({ lidoEm: new Date().toISOString(), turmas }, null, 1)); } catch { /* cache e' so reserva */ }
    return { futuras: turmasFuturas(turmas, hojeIso), origem: 'airtable', erro: null };
  } catch (e) {
    try {
      const salvo = JSON.parse(fs.readFileSync(cache, 'utf8'));
      return { futuras: turmasFuturas(salvo.turmas, hojeIso), origem: 'cache', erro: `${e.message} (usei a leitura de ${salvo.lidoEm})` };
    } catch {
      return { futuras: new Map(), origem: 'nenhuma', erro: `${e.message}; sem leitura salva: nenhuma turma futura sera pulada` };
    }
  }
}

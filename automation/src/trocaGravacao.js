// Logica pura do robo que troca o Zoom pela gravacao (17/nov/2026).
// Spec: docs/superpowers/specs/2026-11-17-troca-zoom-gravacao-design.md
// Sem I/O: Vimeo, Teamup, Agrotable e LW sao lidos em src/trocaGravacaoFontes.js.
import { parseVideoName } from './parseVideoName.js';
import { cabecaDoEvento, normalizar, nomeDaAula, pastaCasaComEvento, APELIDOS_DE_PASTA } from './materiaisAula.js';

export const PESQUISA_BASE_URL = 'https://pesquisa.agroadvance.com.br';
// Mesmo gate do Agrotable (intranet: evento-pesquisa-link.ts, TAG_MODELO).
const TIPO_ENTREGA_COM_CSAT = new Set(['Ao vivo', 'Gravada (reex)', 'Gravada (comum)', 'Presencial']);
const CODIGO_VALIDO = /^[A-Za-z0-9_-]{6,40}$/;
const SALA = new Set(['zoomMeeting', 'teamsMeeting']);

/** "GPA_16112026_MELINA_..._ED" -> {sigla:'GPA', dataIso:'2026-11-16'}; so editado e com duracao. */
export function lerGravacao(nome, duracao) {
  if (!duracao || !/_ED\b/i.test(nome || '')) return null;
  const p = parseVideoName(nome);
  if (!p) return null;
  const d = p.date;
  const sigla = normalizar(p.code);
  // aula conjunta dos MBAs: "MBAs_" e, as vezes, "MBA_" (Pricing 09/nov/2026)
  return { sigla: sigla === 'MBA' ? 'MBAS' : sigla, dataIso: `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}` };
}

/** Uma gravacao por aula ("SIGLA|dataIso"), a criada por ultimo. */
export function escolherGravacao(videos) {
  const porAula = new Map();
  for (const v of videos) {
    const g = lerGravacao(v.nome, v.duracao);
    if (!g) continue;
    const chave = `${g.sigla}|${g.dataIso}`;
    const atual = porAula.get(chave);
    if (!atual || String(v.criado) > String(atual.criado)) porAula.set(chave, { ...v, ...g });
  }
  return porAula;
}

/** Evento do Teamup da gravacao. Zero ou mais de um = erro (nunca chuta). */
export function eventoDaGravacao(eventos, sigla, dataIso) {
  const casados = eventos.filter((e) => e.data === dataIso && pastaCasaComEvento(sigla, e.titulo));
  if (casados.length === 0) return { erro: `sem evento no Teamup para ${sigla} em ${dataIso}` };
  if (casados.length > 1) return { erro: `mais de um evento no Teamup para ${sigla} em ${dataIso}` };
  return { evento: casados[0] };
}

/** B2C = categoria MBA/Pos-graduacao; sem categoria, slug mba-/pos- (mesma regra do robo de Presenca Zoom). */
export function ehB2C({ categorias = [], slug = '' }) {
  if (categorias.length) return categorias.some((c) => /^MBA\b|^POS[- ]?GRADUACAO/.test(normalizar(c)));
  return /^(mba|pos)-/.test(slug);
}

export function aulaCompartilhada(tituloEvento) {
  return cabecaDoEvento(tituloEvento).length > 1;
}

/** Link do formulario `pesquisa` do Evento do Agrotable, ou null (aula compartilhada nunca tem CSAT). */
export function linkCsat(evento, compartilhada) {
  if (!evento || compartilhada) return null;
  if ((evento.siglas || []).length > 1) return null;
  if (!TIPO_ENTREGA_COM_CSAT.has(evento.tipoEntrega)) return null;
  if (normalizar(evento.status) === 'CANCELADO') return null;
  if (!CODIGO_VALIDO.test(evento.id || '')) return null;
  return `${PESQUISA_BASE_URL}/${evento.id}`;
}

/**
 * CSAT da aula. Compartilhada (mais de uma sigla no Teamup OU no Agrotable, ex. PFS citada so' como
 * "PFS" no Teamup mas PFS + PSS no Agrotable) = sem botao. Curso unico = link do Agrotable ou "sem-link".
 */
export function decidirCsat(tituloEvento, eventoAgrotable) {
  if (aulaCompartilhada(tituloEvento) || (eventoAgrotable && (eventoAgrotable.siglas || []).length > 1)) return { tipo: 'compartilhada', link: null };
  const link = linkCsat(eventoAgrotable, false);
  return link ? { tipo: 'link', link } : { tipo: 'sem-link', link: null };
}

/**
 * Evento do Agrotable da aula: mesma data, mesmo nome de aula E pelo menos uma sigla em comum com a
 * cabeca do Teamup (MBAs = LGE/GTC/MEA). Mais de um candidato = null (nunca pega o CSAT de outro curso).
 */
export function eventoDaAula(eventos, dataIso, tituloTeamup) {
  const alvo = nomeDaAula(tituloTeamup);
  const cabeca = cabecaDoEvento(tituloTeamup);
  const siglasDoTeamup = new Set(cabeca.flatMap((c) => APELIDOS_DE_PASTA[c] || [c]));
  const casados = eventos.filter((e) => e.data === dataIso && nomeDaAula(e.aula) === alvo
    && (e.siglas || []).some((s) => siglasDoTeamup.has(normalizar(s))));
  return casados.length === 1 ? casados[0] : null;
}

/** Trava da rodada: so assume se nao ha trava, ela esta corrompida, o dono morreu ou passou de 8 h. */
export function podeAssumirTrava(conteudo, { pid, agora, vivo }) {
  if (!conteudo) return true;
  let t;
  try { t = JSON.parse(conteudo); } catch { return true; }
  if (!t || typeof t.pid !== 'number' || typeof t.inicio !== 'number') return true;
  if (t.pid === pid) return true;
  if (!vivo(t.pid)) return true;
  return agora - t.inicio > 8 * 3600000;
}

function atividadesDaAula(units, tituloEvento, dataIso) {
  const [a, m, d] = dataIso.split('-');
  const dataNoTitulo = `${d}/${m}/${a}`;
  const alvo = nomeDaAula(tituloEvento);
  const achadas = [];
  for (const [id, u] of units) {
    if (!(u.titulo || '').includes(dataNoTitulo)) continue;
    const nome = nomeDaAula(u.titulo);
    if (alvo && nome && (nome === alvo || nome.startsWith(alvo) || alvo.startsWith(nome))) achadas.push({ id, ...u });
  }
  return achadas;
}

/**
 * O que fazer numa turma: criar Embed (so tem o Zoom), trocar o video (Embed vazio ou com o
 * evento ao vivo do Vimeo), nada (Embed ja com video gravado) ou nao achada.
 */
export function planoDaAula(units, tituloEvento, dataIso, unitDoLink = null) {
  let achadas = atividadesDaAula(units, tituloEvento, dataIso);
  // titulo diferente do Teamup: vale a unit do link e as de MESMO titulo (o Embed criado ao lado dela)
  if (!achadas.length && unitDoLink && units.has(unitDoLink)) {
    const titulo = (units.get(unitDoLink).titulo || '').trim();
    achadas = [...units].filter(([id, u]) => id === unitDoLink || (u.titulo || '').trim() === titulo).map(([id, u]) => ({ id, ...u }));
  }
  const zoom = achadas.find((u) => SALA.has(u.tipo)) || null;
  const embed = achadas.find((u) => u.tipo === 'embed') || null;
  if (embed) {
    const gravado = /player\.vimeo\.com\/video\//.test(embed.html || '');
    return { acao: gravado ? 'ja-feito' : 'trocar-video', zoom, embed };
  }
  if (zoom) return { acao: 'criar-embed', zoom, embed: null };
  return { acao: 'nao-achada', zoom: null, embed: null };
}

/** Zoom so estaria seguro para apagar com paridade zerada e o robo de Presenca Zoom sem erro nem revisao. */
export function veredito({ paridade = [], presencaZoom = {} }) {
  const motivos = [];
  if (presencaZoom.erro) motivos.push(`robo de Presenca Zoom: ${presencaZoom.erro}`);
  if ((presencaZoom.revisar || []).length) motivos.push(`Presenca Zoom pede revisao: ${presencaZoom.revisar.join(', ')}`);
  for (const p of paridade) if (p.faltando > 0) motivos.push(`${p.turma}: ${p.faltando} aluno(s) sem presenca no Embed`);
  return { seguro: motivos.length === 0, motivos };
}

/**
 * Fotografia antes/depois de criar o Embed em secao sincronizada (estrutura da API v2:
 * {slug: [{id, title, units: [[id, tipo, titulo]]}]}). Certo = em cada turma, exatamente 1 unit
 * nova, do tipo embed e com o titulo da aula, e nenhuma unit sumida (a sync ja apagou unit em 30/ago).
 */
export function compararEstrutura(antes, depois, tituloAula) {
  const problemas = [];
  const novos = {};
  const ids = (secs) => new Map((secs || []).flatMap((s) => s.units.map((u) => [u[0], u])));
  for (const slug of Object.keys(antes)) {
    const a = ids(antes[slug]);
    const d = ids(depois[slug]);
    for (const id of a.keys()) if (!d.has(id)) problemas.push(`${slug}: sumiu a '${id}' (${a.get(id)[2]})`);
    const criadas = [...d.values()].filter((u) => !a.has(u[0]));
    const certas = criadas.filter((u) => u[1] === 'embed' && u[2].trim() === tituloAula.trim());
    if (certas.length !== 1 || criadas.length !== 1) problemas.push(`${slug}: ${certas.length} Embed(s) novo(s) com o titulo e ${criadas.length} unit(s) nova(s) no total (esperado 1 e 1)`);
    else novos[slug] = certas[0][0];
  }
  return { ok: problemas.length === 0, problemas, novos };
}

/**
 * Resultado do robo de Presenca Zoom (n8n, node "Presenca Zoom 75%") para uma aula, no formato que
 * `veredito` usa. Aula fora do relatorio, execucao sem resultado ou em simulacao = erro (nao seguro).
 */
export function presencaDaAula(saida, tituloZoom, dataIso = null) {
  if (!saida || !Array.isArray(saida.relatorio)) return { erro: 'robo de Presenca Zoom sem resultado', revisar: [] };
  if (saida.dryRun) return { erro: 'robo de Presenca Zoom rodou em simulacao', revisar: [] };
  if (dataIso && saida.data !== dataIso.split('-').reverse().join('/')) return { erro: `robo de Presenca Zoom rodou para outra data (${saida.data})`, revisar: [] };
  const data = ((tituloZoom || '').match(/\d{2}\/\d{2}\/\d{4}/) || [])[0];
  const alvo = nomeDaAula(tituloZoom);
  const r = saida.relatorio.find((x) => (!data || (x.aula || '').includes(data)) && nomeDaAula(x.aula) === alvo);
  if (!r) return { erro: 'aula nao apareceu no relatorio do robo de Presenca Zoom', revisar: [] };
  // sem isso a paridade fica zerada e daria "seguro" com alunos que nunca receberam presenca no Zoom
  if (r.erro) return { erro: `robo de Presenca Zoom: ${r.erro}`, revisar: r.revisar || [] };
  if (/PROFESSOR N/i.test(r.base || '')) return { erro: 'professor nao achado no Zoom: ninguem recebeu presenca', revisar: r.revisar || [] };
  const falhas = (saida.aGravar || []).filter((g) => g.aula === r.aula && !/^presen.a dada$/i.test(g.resultado || ''));
  if (falhas.length) return { erro: `${falhas.length} gravacao(oes) de presenca do Zoom falharam (${[...new Set(falhas.map((f) => f.resultado))].join(', ')})`, revisar: r.revisar || [] };
  return { revisar: r.revisar || [] };
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const dataCurta = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${MESES[+m - 1]}/${a}`; };
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Aviso no Teams (chat do usuario, HTML com <br>): aulas concluidas nesta rodada, cada uma com o link
 * de admin de uma turma para conferir e apagar o Zoom a mao, e problemas novos. Nada novo = null.
 */
export function mensagemTeams({ concluidas = [], problemas = [], baseUrl }) {
  if (!concluidas.length && !problemas.length) return null;
  const L = ['<b>🎬 Troca do Zoom pela gravação</b>'];
  for (const c of concluidas) {
    const admin = `${baseUrl}/author/course?courseid=${c.slugAdmin}&tab=contents`;
    L.push('', `✅ <b>${esc(c.titulo.split('|').slice(0, 2).join('|').trim())}</b> (${dataCurta(c.dataIso)}) · ${c.turmas} turma(s)`);
    L.push(`Embed com a gravação · ${c.csat === 'link' ? 'botão de CSAT do Agrotable' : 'sem CSAT (aula compartilhada)'} · ${c.pdfs ? `${c.pdfs} PDF(s) anexado(s)` : 'sem PDF na pasta'}`);
    if (!c.veredito) L.push('⚪ Presença ainda não conferida pelo robô: não apague o Zoom ainda.');
    else if (c.veredito.semZoom) L.push('⚪ Aula sem atividade Zoom (VMIX): nada a apagar, só conferir o vídeo.');
    else if (c.veredito.seguro) L.push('🟢 Presença passada para o Embed em todas as turmas: pode conferir e apagar o Zoom manualmente.');
    else L.push(`🔴 Não apague o Zoom ainda: ${esc(c.veredito.motivos.join('; '))}`);
    L.push(`<a href="${admin}">Abrir ${esc(c.slugAdmin)} no admin da LW</a> (a sincronização leva a troca para as outras turmas)`);
  }
  if (problemas.length) L.push('', '<b>⚠ Precisa de você</b>', ...problemas.map((p) => `· ${esc(p)}`));
  return L.join('<br>');
}

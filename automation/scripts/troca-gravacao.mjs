// Robo de D+1 (17/nov/2026): troca a atividade Zoom pela gravacao do Vimeo nas aulas B2C.
// Spec: docs/superpowers/specs/2026-11-17-troca-zoom-gravacao-design.md
//
// uso:
//   node scripts/troca-gravacao.mjs                      (simulacao; ter/qua/qui; aulas dos ultimos 7 dias)
//   node scripts/troca-gravacao.mjs --data 2026-11-16    (so as aulas dessa data, qualquer dia da semana)
//   node scripts/troca-gravacao.mjs --gravar embed,material,presenca   (liga os passos; padrao = nada grava)
// Nunca apaga o Zoom (decisao do usuario, 17/nov/2026).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';
import {
  gravacoesRecentes, eventosTeamup, abrirTunelAgrotable, eventosAgrotable, abrirLw, unitsDoCurso,
  categoriasDoCurso, htmlDoEmbed, pastaShareNoOneDrive, caminhosDaPasta, estruturaV2, dispararPresencaZoom, idInternoDoCurso, avisarNoTeams,
} from '../src/trocaGravacaoFontes.js';
import {
  escolherGravacao, eventoDaGravacao, ehB2C, aulaCompartilhada, decidirCsat, eventoDaAula, planoDaAula, compararEstrutura, presencaDaAula, veredito, podeAssumirTrava, mensagemTeams, ehEquipe, semEquipeNaRevisao,
} from '../src/trocaGravacao.js';
import { generateEmbedHtml } from '../src/generateEmbedHtml.js';
import { lerCaminho, montarPlano, dataBr, chaveDaPasta, jaTemArquivo } from '../src/materiaisAula.js';
import { turmasQueNaoComecaram, semTurmasFuturas, textoPuladas } from '../src/turmasFuturas.js';

const SAIDA = path.join(process.cwd(), 'troca-gravacao');
const TRAVA = path.join(process.cwd(), '.troca-gravacao.lock');

// --log <arquivo>: o proprio robo acrescenta no log, abrindo e fechando a cada linha. Com o ">>" do
// .cmd o arquivo ficava preso a rodada inteira e, quando o PC volta da suspensao e o agendador solta
// 10h e 13h juntas, a segunda morria sem deixar rastro (18/nov/2026).
const LOG = process.argv.includes('--log') ? path.resolve(process.argv[process.argv.indexOf('--log') + 1]) : null;
if (LOG) {
  for (const nivel of ['log', 'error']) {
    const original = console[nivel].bind(console);
    console[nivel] = (...partes) => {
      original(...partes);
      try { fs.appendFileSync(LOG, partes.map((p) => (typeof p === 'string' ? p : String(p))).join(' ') + '\n'); } catch { /* log ocupado: segue */ }
    };
  }
}
const DIAS_PARA_TRAS = 7;

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const gravar = new Set((arg('--gravar') || '').split(',').filter(Boolean));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = new Date();
const HOJE = iso(hoje);

// ---------- trava contra rodada concorrente (mesmo padrao do revisor de CSAT) ----------
function vivo(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
// A rodada com presenca pode passar de 1 h (15 a 90 s por aluno): so assume a trava se o dono
// morreu (ou passou de 8 h). Criacao atomica ('wx') e so o dono apaga.
function pegarTrava() {
  const nova = JSON.stringify({ pid: process.pid, inicio: Date.now() });
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try { fs.writeFileSync(TRAVA, nova, { flag: 'wx' }); return true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let atual = null;
    try { atual = fs.readFileSync(TRAVA, 'utf8'); } catch { /* sumiu entre o wx e a leitura */ }
    if (!podeAssumirTrava(atual, { pid: process.pid, agora: Date.now(), vivo })) return false;
    fs.rmSync(TRAVA, { force: true });
  }
  return false;
}
function soltarTrava() {
  try { if (JSON.parse(fs.readFileSync(TRAVA, 'utf8')).pid === process.pid) fs.rmSync(TRAVA, { force: true }); } catch { /* nao e minha ou nao existe */ }
}

// ---------- janela de datas ----------
function janela() {
  if (arg('--data')) return { inicio: arg('--data'), fim: arg('--data') };
  const inicio = iso(new Date(hoje.getTime() - DIAS_PARA_TRAS * 86400000));
  // corte: nunca antes do dia em que o robo foi ligado
  const corte = process.env.TROCA_INICIO || HOJE;
  return { inicio: inicio < corte ? corte : inicio, fim: HOJE };
}

function rodar(script, argumentos, env = {}) {
  try {
    return execFileSync(process.execPath, [path.join('scripts', script), ...argumentos], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15 * 60000 });
  } catch (e) {
    const ultimas = String((e.stdout || '') + (e.stderr || '')).trim().split(String.fromCharCode(10)).map((l) => l.trim()).slice(-3);
    throw new Error(`${script} falhou: ${ultimas.join(' | ')}`);
  }
}

// Passo 2 da spec: Embed com a gravacao + CSAT numa turma; a sync leva para as peers.
async function passoEmbed({ g, ev, planos, decisao, L, precisa }) {
  const acoes = [...new Set(planos.map((p) => p.plano.acao))];
  const doPlano = () => ({ titulo: planos[0].plano.embed.titulo, embeds: Object.fromEntries(planos.map((p) => [p.t.courseid, p.plano.embed.id])) });
  if (acoes.length === 1 && acoes[0] === 'ja-feito') return doPlano();
  if (acoes.length !== 1 || !['criar-embed', 'trocar-video'].includes(acoes[0])) {
    precisa.push(`${ev.titulo}: turmas em estados diferentes (${acoes.join(', ')}), nao criei Embed`);
    return null;
  }
  const pasta = path.join(SAIDA, 'prints');
  fs.mkdirSync(pasta, { recursive: true });
  const arq = path.join(SAIDA, 'prints', `embed-${g.id}.html`);
  fs.writeFileSync(arq, generateEmbedHtml({ vimeoEmbedUrl: g.embedUrl, csatLink: decisao.link }), 'utf8');
  const { t, plano } = planos[0];
  try {
    if (acoes[0] === 'trocar-video') {
      rodar('claude-embed-preencher.mjs', [t.courseid, plano.embed.titulo, arq, pasta], { SALVAR: '1', TROCAR: '1', UNIT_ID: plano.embed.id });
      L.push(`   ✅ video trocado no Embed ${plano.embed.id} (${t.courseid}); a sync leva para as outras turmas`);
      return doPlano();
    }
    const slugs = planos.map((p) => p.t.courseid);
    const antes = {};
    for (const s of slugs) antes[s] = await estruturaV2(s);
    const iSec = antes[t.courseid].findIndex((s) => s.units.some((u) => u[0] === plano.zoom.id));
    if (iSec < 0) throw new Error('secao do Zoom nao achada na API v2');
    const saida = rodar('claude-embed-criar.mjs', [t.courseid, String(iSec + 1), plano.zoom.titulo, arq, pasta], { SALVAR: '1', SEC_TXT: antes[t.courseid][iSec].title });
    const idNovo = ((saida.match(/^UNIT ([A-Za-z0-9]+)/m) || [])[1] || '').trim();
    if (!idNovo) throw new Error('Embed criado mas nao achei o id novo');
    rodar('claude-lw-mover-unit.mjs', [t.courseid, idNovo, plano.zoom.id, pasta]);
    await new Promise((ok) => setTimeout(ok, 15000));
    const depois = {};
    for (const s of slugs) depois[s] = await estruturaV2(s);
    const cmp = compararEstrutura(antes, depois, plano.zoom.titulo);
    if (!cmp.ok) { precisa.push(`${ev.titulo}: fotografia depois do Embed nao bateu: ${cmp.problemas.join('; ')}`); L.push('   ❌ Embed criado, mas a fotografia nao bateu (ver "Precisa de voce")'); return null; }
    L.push(`   ✅ Embed criado em ${slugs.length} turma(s) (${Object.values(cmp.novos).join(', ')}), logo abaixo do Zoom; nada sumiu`);
    return { titulo: plano.zoom.titulo, embeds: cmp.novos };
  } catch (e) {
    precisa.push(`${ev.titulo}: passo Embed parou: ${e.message}`);
    L.push(`   ❌ passo Embed parou: ${e.message}`);
    return null;
  }
}

// Passo 3 da spec: PDFs da pasta Share no Embed (uma turma; a sync leva) e conferencia nas outras.
async function passoMaterial({ page, ev, destino, arquivos, L, precisa }) {
  if (!arquivos.length) return;
  const slugs = Object.keys(destino.embeds);
  const slug0 = slugs[0];
  const pasta = path.join(SAIDA, 'prints');
  fs.mkdirSync(pasta, { recursive: true });
  const u0 = ((await unitsDoCurso(page, slug0)) || new Map()).get(destino.embeds[slug0]);
  const faltam = arquivos.filter((a) => !jaTemArquivo(u0 ? u0.anexos : [], path.basename(a)));
  try {
    for (const a of faltam) rodar('anexar-material.mjs', [slug0, destino.titulo, a, pasta], { SALVAR: '1', CONFIRMAR_SYNC: '1', UNIT_ID: destino.embeds[slug0] });
  } catch (e) { precisa.push(`${ev.titulo}: passo material parou: ${e.message}`); L.push(`   ❌ passo material parou: ${e.message}`); return; }
  await new Promise((ok) => setTimeout(ok, 10000));
  const sem = [];
  for (const s of slugs) {
    const u = ((await unitsDoCurso(page, s)) || new Map()).get(destino.embeds[s]);
    const falta = arquivos.filter((a) => !jaTemArquivo(u ? u.anexos : [], path.basename(a)));
    if (falta.length) sem.push(`${s} (${falta.length})`);
  }
  if (sem.length) { precisa.push(`${ev.titulo}: material nao chegou em ${sem.join(', ')}`); L.push(`   ❌ material nao chegou em ${sem.join(', ')}`); }
  else L.push(`   ✅ material no Embed das ${slugs.length} turma(s)${faltam.length ? ` (${faltam.length} PDF(s) anexado(s) agora)` : ' (ja estava)'}`);
}

// Passos 4 a 6 da spec: dispara o robo de Presenca Zoom, passa a presenca do Zoom para o Embed
// turma a turma e diz se o Zoom estaria seguro para apagar. NUNCA apaga.
async function passoPresenca({ page, g, ev, planos, destino, teste, L, precisa }) {
  const comZoom = planos.filter((p) => p.plano.zoom && destino.embeds[p.t.courseid]);
  if (!comZoom.length) { L.push('   · presenca: sem atividade Zoom (VMIX ou Zoom ja apagado), nada a passar'); return { seguro: true, motivos: [], semZoom: true }; }
  const tituloZoom = comZoom[0].plano.zoom.titulo;
  let presencaZoom;
  try {
    const saida = await dispararPresencaZoom(g.dataIso, teste ? teste.presencaWebhookExtra || '' : '');
    presencaZoom = presencaDaAula(saida, tituloZoom, g.dataIso);
    // host/equipe no Zoom nao e' aluno: sai da revisao (nomes no .env TROCA_EQUIPE_ZOOM, separados por ";")
    const semHost = semEquipeNaRevisao(presencaZoom.revisar, (process.env.TROCA_EQUIPE_ZOOM || '').split(';'));
    presencaZoom = { ...presencaZoom, revisar: semHost.revisar };
    if (semHost.ignorados.length) L.push(`   · equipe/host ignorado na revisao: ${semHost.ignorados.map((i) => i.split(' (')[0]).join(', ')}`);
    L.push(`   · robo de Presenca Zoom: execucao ${saida.execucao}${presencaZoom.erro ? ' · ' + presencaZoom.erro : ` · ${presencaZoom.revisar.length} para revisar`}`);
  } catch (e) { presencaZoom = { erro: e.message, revisar: [] }; L.push(`   ❌ robo de Presenca Zoom: ${e.message}`); }
  const pasta = path.join(SAIDA, 'presenca');
  fs.mkdirSync(pasta, { recursive: true });
  const paridade = [];
  for (const { t, plano } of comZoom) {
    const embedId = destino.embeds[t.courseid];
    const base = path.join(pasta, `${g.dataIso}-${t.courseid}`);
    // conta da equipe (@agroadvance.com.br, ex. host) nao conta e nao recebe presenca
    const conferir = () => { rodar('verify-presence-parity.js', [t.courseid, plano.zoom.id, embedId, `${base}-paridade.json`]); return (JSON.parse(fs.readFileSync(`${base}-paridade.json`, 'utf8')).missingVideo || []).filter((u) => !ehEquipe(u.email)); };
    try {
      let faltam = conferir();
      const passados = faltam.length;
      for (let volta = 0; faltam.length && volta < 3; volta++) {
        if (volta === 0 || volta === 1) {
          const interno = await idInternoDoCurso(page, t.courseid);
          const secao = (await estruturaV2(t.courseid)).find((s) => s.units.some((u) => u[0] === embedId));
          if (!interno || !secao) throw new Error('id interno do curso ou secao do Embed nao achados');
          fs.writeFileSync(`${base}-entrada.json`, JSON.stringify(faltam.map((u) => ({ id: u.id, email: u.email, name: u.name })), null, 1));
          rodar('bulk-mark-video-complete-generic.js', [`${base}-entrada.json`, `${base}-saida-${volta}.json`, interno, t.courseid, secao.id, embedId], { TOTAL_TIME: String(Math.max(6173, Math.round(g.duracao || 0))) });
        }
        // a LW demora alguns minutos para mostrar a conclusao no /progress
        await new Promise((ok) => setTimeout(ok, 3 * 60000));
        faltam = conferir();
      }
      paridade.push({ turma: t.courseid, faltando: faltam.length });
      L.push(`   ${faltam.length ? '❌' : '✅'} ${t.courseid}: ${passados} aluno(s) a passar, ${faltam.length} ainda sem presenca no Embed`);
    } catch (e) {
      paridade.push({ turma: t.courseid, faltando: 1 });
      L.push(`   ❌ ${t.courseid}: presenca parou: ${e.message}`);
      precisa.push(`${ev.titulo} · ${t.courseid}: presenca parou: ${e.message}`);
    }
  }
  const v = veredito({ paridade, presencaZoom });
  L.push(v.seguro ? '   🟢 Zoom estaria SEGURO para apagar (nao foi apagado)' : `   🔴 Zoom NAO seguro para apagar: ${v.motivos.join('; ')}`);
  if (!v.seguro) precisa.push(`${ev.titulo}: Zoom nao seguro para apagar (${v.motivos.join('; ')})`);
  return v;
}

// relatorio e pendencias ficam fora de principal(): se a rodada cair no meio, o que ja foi feito
// ainda vai para o arquivo (rodada calada = ninguem percebe)
const L = [];
const precisa = [];
// aulas concluidas nesta rodada (vao para o Teams com o link de admin)
const concluidas = [];
// estado entre rodadas: aula concluida nao e' reprocessada nem reavisada; problema so' e' avisado 1 vez
const ESTADO = path.join(process.cwd(), '.troca-gravacao-estado.json');
function lerEstado() {
  try { return { concluidas: {}, problemas: {}, ...JSON.parse(fs.readFileSync(ESTADO, 'utf8')) }; } catch { return { concluidas: {}, problemas: {} }; }
}
const estado = lerEstado();

async function principal() {
  const { inicio, fim } = janela();
  L.push(`TROCA DO ZOOM PELA GRAVACAO · ${gravar.size ? 'GRAVANDO: ' + [...gravar].join(', ') : 'SIMULACAO (nada foi gravado)'} · rodada ${new Date().toLocaleString('pt-BR')}`,
    `Aulas de ${dataBr(inicio)} a ${dataBr(fim)} · o Zoom nunca e' apagado nesta fase`);

  // modo teste (curso apagar): TROCA_TESTE=<arquivo.json> com {gravacao, evento, csat}
  const teste = process.env.TROCA_TESTE ? JSON.parse(fs.readFileSync(process.env.TROCA_TESTE, 'utf8')) : null;
  if (teste) L.push('*** MODO TESTE: gravacao, evento e CSAT vem de ' + process.env.TROCA_TESTE + ' ***');

  // 1. gravacoes editadas no Vimeo, uma por aula
  const videos = teste ? [] : await gravacoesRecentes({ desde: inicio });
  const gravacoes = teste ? [teste.gravacao] : [...escolherGravacao(videos).values()].filter((g) => g.dataIso >= inicio && g.dataIso <= fim);
  if (!gravacoes.length) { L.push('', 'Nenhuma gravacao editada (_ED) nova nessa janela.'); return; }

  // 2. Teamup, Agrotable e pasta Share
  // turma que ainda nao comecou (ex. lote fev/2027) fica de fora
  let eventos = teste ? [teste.evento] : await eventosTeamup(inicio, fim);
  if (!teste) {
    const { futuras, origem, erro: erroFuturas } = await turmasQueNaoComecaram();
    if (erroFuturas) L.push(`aviso: turmas futuras (${origem}): ${erroFuturas}`);
    const r = semTurmasFuturas(eventos, futuras);
    eventos = r.eventos;
    if (r.pulados.length) L.push(`Turmas que ainda nao comecaram, puladas: ${textoPuladas(r.pulados)}`);
  }
  let agrotable = null;
  let erroAgrotable = null;
  if (!teste) try {
    const fechar = await abrirTunelAgrotable();
    try { agrotable = eventosAgrotable(inicio, fim); } finally { fechar(); }
  } catch (e) { erroAgrotable = e.message; }
  let materiais = [];
  const raizShare = pastaShareNoOneDrive();
  try { materiais = caminhosDaPasta(raizShare).map(lerCaminho).filter(Boolean); } catch (e) { precisa.push(`pasta Share: ${e.message}`); }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await abrirLw(browser);
    for (const g of gravacoes.sort((a, b) => a.dataIso.localeCompare(b.dataIso))) try {
      L.push('', `🎬 ${g.nome}`, `   Vimeo ${g.id} · ${Math.round(g.duracao / 60)} min · ${g.embedUrl}`);
      const chave = `${g.sigla}|${g.dataIso}`;
      if (gravar.size && !teste && estado.concluidas[chave]) { L.push(`   · ja concluida e avisada em ${estado.concluidas[chave]}, pulada`); continue; }
      const precisaAntes = precisa.length;
      const r = eventoDaGravacao(eventos, g.sigla, g.dataIso);
      if (r.erro) { L.push(`   ❌ ${r.erro}`); precisa.push(`${g.nome}: ${r.erro}`); continue; }
      const ev = r.evento;
      L.push(`   📅 Teamup: ${ev.titulo} (${dataBr(g.dataIso)}) · ${ev.turmas.length} turma(s)`);
      if (!ev.turmas.length && ev.turmasPuladas) { L.push('   · so turma que ainda nao comecou: pulada'); continue; }
      if (!ev.turmas.length) { L.push('   ❌ evento sem link de turma da LW'); precisa.push(`${ev.titulo}: sem link de turma no Teamup`); continue; }

      // escopo B2C pela 1a turma (aula sincronizada = mesmo tipo de curso)
      const cats = await categoriasDoCurso(ev.turmas[0].courseid).catch(() => []);
      if (!teste && !ehB2C({ categorias: cats, slug: ev.turmas[0].courseid })) { L.push(`   · fora do escopo (B2B: ${cats.join(', ') || ev.turmas[0].courseid})`); continue; }

      // CSAT do Agrotable
      // sem Agrotable nao da para saber se e' compartilhada (PFS so' no Teamup, PFS + PSS no Agrotable)
      if (!teste && !agrotable && !aulaCompartilhada(ev.titulo)) { L.push(`   ❌ CSAT: Agrotable fora do ar (${erroAgrotable})`); precisa.push(`${ev.titulo}: Agrotable fora do ar, nada seria criado`); continue; }
      const evAg = agrotable ? eventoDaAula(agrotable, g.dataIso, ev.titulo) : null;
      const decisao = teste ? (teste.csat ? { tipo: 'link', link: teste.csat } : { tipo: 'compartilhada', link: null }) : decidirCsat(ev.titulo, evAg);
      if (decisao.tipo === 'compartilhada') L.push(`   CSAT: sem botao (aula compartilhada${evAg ? ': ' + evAg.siglas.join(', ') : ''})`);
      else if (decisao.tipo === 'sem-link') { L.push(`   ❌ CSAT: ${evAg ? `evento ${evAg.id} sem CSAT (tipo "${evAg.tipoEntrega}")` : 'aula nao achada no Agrotable'}`); precisa.push(`${ev.titulo}: sem link de CSAT no Agrotable`); continue; }
      else L.push(`   CSAT: ${decisao.link}`);

      // material da pasta Share
      const item = montarPlano(materiais, [ev], g.dataIso).itens.find((i) => i.eventos.length);
      const pdfs = item ? item.arquivos.filter((a) => a.sobe).map((a) => a.arquivo) : [];
      L.push(`   Material: ${pdfs.length ? pdfs.join(' · ') : 'nenhum PDF na pasta dessa aula'}`);

      // plano por turma
      let htmlLido = null;
      const planos = [];
      const ilegiveis = [];
      for (const t of ev.turmas) {
        const units = await unitsDoCurso(page, t.courseid);
        if (!units) { L.push(`   → ${t.courseid}: ❌ nao consegui ler o curso`); ilegiveis.push(t.courseid); continue; }
        let plano = planoDaAula(units, ev.titulo, g.dataIso, t.unit);
        if (plano.embed && htmlLido === null) {
          htmlLido = await htmlDoEmbed(page, t.courseid, plano.embed.id);
          await page.goto(`${process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '')}/library`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
        if (plano.embed) plano = planoDaAula(new Map([...units].map(([id, u]) => [id, id === plano.embed.id ? { ...u, html: htmlLido } : u])), ev.titulo, g.dataIso, t.unit);
        const destino = plano.embed || plano.zoom;
        const faltam = destino ? pdfs.filter((p) => !jaTemArquivo(plano.embed ? plano.embed.anexos : [], p)) : pdfs;
        const acao = {
          'criar-embed': `criaria Embed abaixo do Zoom ${plano.zoom && plano.zoom.id}`,
          'trocar-video': `trocaria o video do Embed ${plano.embed && plano.embed.id}`,
          'ja-feito': `Embed ${plano.embed && plano.embed.id} ja com a gravacao`,
          'nao-achada': '❌ atividade da aula nao achada',
        }[plano.acao];
        L.push(`   → ${t.courseid}: ${acao}${faltam.length ? ` · anexaria ${faltam.length} PDF(s)` : ''}${plano.zoom ? ' · passaria presenca do Zoom' : ''}`);
        if (plano.acao === 'nao-achada') precisa.push(`${ev.titulo} · ${t.courseid}: atividade nao achada`);
        planos.push({ t, plano });
      }
      // turma sem leitura fica fora da fotografia e da paridade: nao grava nada nessa aula
      if (ilegiveis.length || !planos.length) {
        precisa.push(`${ev.titulo}: nao consegui ler ${ilegiveis.join(', ') || 'nenhuma turma'}; nada foi gravado nessa aula`);
        continue;
      }
      let destino = null;
      if (gravar.has('embed')) destino = await passoEmbed({ g, ev, planos, decisao, L, precisa });
      else if (planos.every((p) => p.plano.embed)) destino = { titulo: planos[0].plano.embed.titulo, embeds: Object.fromEntries(planos.map((p) => [p.t.courseid, p.plano.embed.id])) };
      const arquivos = teste ? (teste.pdfs || []) : (item ? materiais.filter((m) => m.data === g.dataIso && chaveDaPasta(m) === item.pasta.chave && pdfs.includes(m.arquivo)).map((m) => path.join(raizShare, m.caminho)) : []);
      if (gravar.has('material') && destino) await passoMaterial({ page, ev, destino, arquivos, L, precisa });
      let v = null;
      if (gravar.has('presenca') && destino) v = await passoPresenca({ page, g, ev, planos, destino, teste, L, precisa });
      else if (gravar.has('presenca')) L.push('   · presenca: sem Embed nas turmas ainda, fica para a proxima rodada');
      if (!gravar.has('presenca')) L.push(`   Presenca: dispararia o robo de Presenca Zoom (?data=${g.dataIso.split('-').reverse().join('/')}) e conferiria a paridade turma a turma`);
      // concluida = gravou algo, Embed existe e nenhum passo ligado deixou pendencia (Zoom nao seguro e' pendencia)
      if (gravar.size && destino && precisa.length === precisaAntes) {
        concluidas.push({ chave, titulo: ev.titulo, dataIso: g.dataIso, turmas: planos.length, csat: decisao.tipo, pdfs: arquivos.length, veredito: v, slugAdmin: Object.keys(destino.embeds)[0] });
      }
    } catch (e) {
      // uma aula com erro nao derruba as outras
      L.push(`   ❌ aula parou: ${e.message}`);
      precisa.push(`${g.nome}: aula parou: ${e.message}`);
    }
  } finally {
    await browser.close();
  }
}

function salvarRelatorio() {
  if (precisa.length) L.push('', '⚠ Precisa de voce:', ...precisa.map((p) => `   · ${p}`));
  const texto = L.join('\n');
  console.log(texto);
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, `${HOJE}_${String(hoje.getHours()).padStart(2, '0')}${String(hoje.getMinutes()).padStart(2, '0')}.txt`), texto, 'utf8');
}

const DIAS_DO_ROBO = [2, 3, 4]; // ter, qua, qui
if (!arg('--data') && !DIAS_DO_ROBO.includes(hoje.getDay())) {
  console.log(new Date().toISOString(), 'fora do dia (so roda ter, qua e qui)');
} else if (!pegarTrava()) {
  console.log(new Date().toISOString(), 'outra rodada em andamento, saindo');
} else {
  try {
    await principal();
  } catch (e) {
    console.error(new Date().toISOString(), 'ERRO:', e.stack || e.message);
    L.push('', `❌ RODADA PAROU NO MEIO: ${e.message}`);
    process.exitCode = 1;
  } finally {
    try { salvarRelatorio(); } catch (e) { console.error('nao consegui salvar o relatorio:', e.message); }
    // Teams so' quando grava: aulas concluidas (com link de admin) e problemas ainda nao avisados
    if (gravar.size) {
      const novos = [...new Set(precisa)].filter((p) => !estado.problemas[p]);
      const msg = mensagemTeams({ concluidas, problemas: novos, baseUrl: process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '') });
      if (msg) {
        try {
          await avisarNoTeams((process.env.TROCA_TESTE ? '[TESTE] ' : '') + msg);
          console.log('aviso enviado pro Teams');
          const agora = new Date().toLocaleString('pt-BR');
          if (!process.env.TROCA_TESTE) for (const c of concluidas) estado.concluidas[c.chave] = agora;
          for (const p of novos) estado.problemas[p] = agora;
          fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 1));
        } catch (e) { console.error('nao consegui avisar no Teams:', e.message); process.exitCode = 1; }
      }
    }
    soltarTrava();
  }
}

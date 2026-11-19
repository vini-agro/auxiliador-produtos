// Robo de materiais (16/nov/2026) - MODO SIMULACAO: nao grava nada na LW.
// Le a pasta Share (OneDrive da Natalia), pega as aulas do dia no Teamup e
// mostra, turma por turma, qual PDF iria para qual atividade da LW.
//
// uso:
//   node scripts/simular-materiais.mjs                       (hoje e amanha, pasta local)
//   node scripts/simular-materiais.mjs --data 2026-11-17
//   node scripts/simular-materiais.mjs --listagem share.tsv  (fotografia: "caminho<TAB>data" por linha)
//   node scripts/simular-materiais.mjs --pasta "C:\...\Share"
// Pasta padrao: MATERIAIS_PASTA no .env, senao "<OneDrive>\Share" (atalho "Adicionar a Meus arquivos").
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { eventosTeamup as eventosDoTeamup, abrirLw, unitsDoCurso, pastaShareNoOneDrive, caminhosDaPasta } from '../src/trocaGravacaoFontes.js';
import { lerCaminho, montarPlano, dataBr, escolherAtividades, chaveDaPasta, mensagemMateriais, jaTemArquivo } from '../src/materiaisAula.js';
import { podeAssumirTrava } from '../src/trocaGravacao.js';
import { execFileSync } from 'child_process';

// --log <arquivo>: o robo acrescenta no log linha a linha, sem prender o arquivo (rodadas que se encontram nao se derrubam)
if (process.argv.includes('--log')) {
  const LOG = path.resolve(process.argv[process.argv.indexOf('--log') + 1]);
  for (const nivel of ['log', 'error']) {
    const original = console[nivel].bind(console);
    console[nivel] = (...partes) => { original(...partes); try { fs.appendFileSync(LOG, partes.map(String).join(' ') + '\n'); } catch { /* ocupado */ } };
  }
}
import { turmasQueNaoComecaram, semTurmasFuturas, textoPuladas } from '../src/turmasFuturas.js';

const SAIDA = path.join(process.cwd(), 'simulacao-materiais');

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const hoje = new Date();
// amanha (material antes da aula), hoje e os 7 dias anteriores: depois da aula a
// atividade do Zoom e' apagada e a gravacao entra como atividade nova, sem material.
const DIAS_PARA_TRAS = 7;
const datas = arg('--data')
  ? [arg('--data')]
  : Array.from({ length: DIAS_PARA_TRAS + 2 }, (_, i) => isoLocal(new Date(hoje.getTime() + (i - DIAS_PARA_TRAS) * 86400000)));
const HOJE_ISO = isoLocal(hoje);

// Para cada turma do evento: atividade(s) que recebem o material (pela data + nome da aula).
function destinos(ev, dataIso, unitsPorCurso) {
  return ev.turmas.map((t) => {
    const units = unitsPorCurso.get(t.courseid);
    if (units === null) return { courseid: t.courseid, erro: 'nao consegui ler o curso', atividades: [] };
    if (!units) return { courseid: t.courseid, erro: 'curso nao lido', atividades: [] };
    const r = escolherAtividades(units, ev.titulo, dataIso, t.unit);
    return { courseid: t.courseid, ...r, erro: r.atividades.length ? null : 'atividade da aula nao achada (Zoom apagado e gravacao ainda nao subiu?)' };
  });
}

// ---------- pasta Share ----------
function caminhosDaListagem(arquivo) {
  return fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).map((l) => l.split('\t')[0].trim()).filter((l) => l && !l.endsWith('/'));
}



// ---------- relatorio ----------
function relatorio(plano, unitsPorCurso) {
  const L = [];
  const contagem = { sobe: 0, jaTem: 0, problema: 0 };
  L.push(`===== ${dataBr(plano.data)} =====`);
  if (!plano.itens.length) L.push('  (nenhuma pasta de material com essa data)');
  for (const item of plano.itens) {
    L.push('');
    L.push(`📁 ${item.pasta.rotulo}`);
    const pdfs = item.arquivos.filter((a) => a.sobe).map((a) => a.arquivo);
    for (const a of item.arquivos.filter((x) => !x.sobe)) L.push(`   · fica de fora: ${a.arquivo} (${a.motivo})`);
    if (!item.eventos.length) { L.push('   ❌ nenhuma aula no Teamup casou com essa pasta nessa data'); contagem.problema++; continue; }
    for (const ev of item.eventos) {
      L.push(`   📅 Teamup: ${ev.titulo}`);
      if (!ev.turmas.length && ev.turmasPuladas) { L.push('      · so turma que ainda nao comecou: pulada'); continue; }
      if (!ev.turmas.length) { L.push('      ❌ evento sem link de aula da LW nos comentarios'); contagem.problema++; continue; }
      if (!pdfs.length) { L.push('      ❌ pasta sem PDF para subir'); contagem.problema++; }
      for (const dest of destinos(ev, plano.data, unitsPorCurso)) {
        if (dest.erro) { L.push(`      → ${dest.courseid} · ❌ ${dest.erro}`); contagem.problema++; continue; }
        for (const u of dest.atividades) {
          L.push(`      → ${dest.courseid} · "${u.titulo}" (${u.tipo}, ${u.qtd ?? u.anexos.length} anexo(s) hoje${dest.como !== 'titulo' ? ', achada pelo ' + dest.como : ''})`);
          for (const pdf of pdfs) {
            if (jaTemArquivo(u.anexos, pdf)) { L.push(`         ✔ ja tem ${pdf}`); contagem.jaTem++; }
            else { L.push(`         + anexaria ${pdf}`); contagem.sobe++; }
          }
        }
      }
    }
  }
  if (plano.eventosSemPasta.length && plano.data >= HOJE_ISO) {
    L.push('');
    L.push('Aulas do dia SEM pasta de material:');
    for (const ev of plano.eventosSemPasta) L.push(`   · ${ev.titulo}${ev.turmas.length ? '' : ' (sem link LW)'}`);
  }
  L.push('');
  L.push(`Resumo ${dataBr(plano.data)}: ${contagem.sobe} anexo(s) a subir · ${contagem.jaTem} ja estavam · ${contagem.problema} problema(s) · ${plano.eventosSemPasta.length} aula(s) sem pasta`);
  return L.join('\n');
}

// Versao curta para o Teams: uma linha por pasta/aula, sem listar turma a turma.
function resumoTeams(planos, unitsPorCurso) {
  const L = ['<b>🧪 Materiais das aulas · SIMULAÇÃO (nada foi gravado na LW)</b>'];
  for (const plano of [...planos].reverse()) {
    // dia que ja passou: so' aparece se tiver algo a fazer ou problema (o resto e' ruido diario)
    const passado = plano.data < HOJE_ISO;
    const bloco = [];
    const push = (linha, ok) => { if (!(passado && ok)) bloco.push(linha); };
    for (const item of plano.itens) {
      const pdfs = item.arquivos.filter((a) => a.sobe).map((a) => a.arquivo);
      const fora = item.arquivos.filter((a) => !a.sobe && !/vai o PDF/.test(a.motivo));
      if (!item.eventos.length) { push(`❌ ${item.pasta.rotulo}: nenhuma aula no Teamup nessa data`, false); continue; }
      for (const ev of item.eventos) {
        let sobe = 0, ja = 0, erro = 0;
        for (const dest of destinos(ev, plano.data, unitsPorCurso)) {
          if (dest.erro) { erro++; continue; }
          for (const u of dest.atividades) for (const pdf of pdfs) (jaTemArquivo(u.anexos, pdf) ? ja++ : sobe++);
        }
        const partes = [];
        if (sobe) partes.push(`<b>anexaria ${sobe}</b>`);
        if (ja) partes.push(`${ja} já estavam`);
        if (!pdfs.length) partes.push('❌ sem PDF na pasta');
        if (!ev.turmas.length && ev.turmasPuladas) { push(`· só turma que ainda não começou: ${ev.titulo.split('|').slice(0, 2).join('|').trim()}`, true); continue; }
        if (!ev.turmas.length) partes.push('❌ sem link LW no Teamup');
        if (erro) partes.push(`❌ ${erro} atividade(s) não achada(s)`);
        if (fora.length) partes.push(`${fora.length} arquivo(s) fora da regra`);
        const ok = !sobe && !erro && pdfs.length && ev.turmas.length;
        push(`${sobe ? '➕' : ok ? '✅' : '❌'} ${ev.titulo.split('|').slice(0, 2).join('|').trim()} · ${ev.turmas.length} turma(s): ${partes.join(' · ')}`, ok);
      }
    }
    if (!passado) for (const ev of plano.eventosSemPasta) push(`· sem pasta de material: ${ev.titulo.split('|').slice(0, 2).join('|').trim()}`, false);
    if (bloco.length) L.push('', `<b>${dataBr(plano.data)}${plano.data === HOJE_ISO ? ' (hoje)' : passado ? ' (já passou: gravação)' : ''}</b>`, ...bloco);
  }
  return L.join('<br>');
}

async function avisarNoTeams(mensagem) {
  const { REVISOR_CSAT_TEAMS_WEBHOOK: webhook, REVISOR_CSAT_TEAMS_CHAT_ID: chatId, REVISOR_CSAT_TEAMS_HEADER_NOME: hn, REVISOR_CSAT_TEAMS_HEADER_VALOR: hv } = process.env;
  if (!webhook || !chatId || !hn || !hv) { console.log('faltam dados do Teams no .env: nao enviei.'); return; }
  const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', [hn]: hv }, body: JSON.stringify({ chatId, message: mensagem }), signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Teams respondeu ${r.status}`);
  console.log('aviso enviado pro Teams.');
}

// ---------- gravar (19/nov/2026, pedido do usuario: "liga o robo de materiais para gravar e me avisar") ----------
const GRAVAR = args.includes('--gravar');
const TRAVA = path.join(process.cwd(), '.materiais.lock');
const TRAVA_GRAVACOES = path.join(process.cwd(), '.troca-gravacao.lock');
const ESTADO = path.join(process.cwd(), '.materiais-estado.json');
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function pegarTrava() {
  const nova = JSON.stringify({ pid: process.pid, inicio: Date.now() });
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(TRAVA, nova, { flag: 'wx' }); return true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let atual = null;
    try { atual = fs.readFileSync(TRAVA, 'utf8'); } catch { /* sumiu */ }
    if (!podeAssumirTrava(atual, { pid: process.pid, agora: Date.now(), vivo })) return false;
    fs.rmSync(TRAVA, { force: true });
  }
  return false;
}
function soltarTrava() {
  try { if (JSON.parse(fs.readFileSync(TRAVA, 'utf8')).pid === process.pid) fs.rmSync(TRAVA, { force: true }); } catch { /* nao e minha */ }
}
// o Robo Gravacoes tambem reanexa material: rodando os dois juntos o mesmo PDF podia entrar 2 vezes ("2-<nome>")
function gravacoesRodando() {
  try { const t = JSON.parse(fs.readFileSync(TRAVA_GRAVACOES, 'utf8')); return vivo(t.pid); } catch { return false; }
}

function rodar(script, argumentos, env = {}) {
  try {
    return execFileSync(process.execPath, [path.join('scripts', script), ...argumentos], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15 * 60000 });
  } catch (e) {
    const ultimas = String((e.stdout || '') + (e.stderr || '')).trim().split(String.fromCharCode(10)).map((l) => l.trim()).slice(-3);
    throw new Error(ultimas.join(' | '));
  }
}

// Em cada turma relê a aula na hora e anexa so' o PDF que falta, pelo id da atividade (Zoom e Embed
// tem o mesmo titulo). Depois de anexar espera a sync levar para as peers antes de ler a proxima turma.
async function anexarFaltantes({ page, planos, materiais, raiz }) {
  const anexados = [];
  const problemas = [];
  const pasta = path.join(SAIDA, 'prints');
  fs.mkdirSync(pasta, { recursive: true });
  for (const plano of planos) for (const item of plano.itens) {
    if (!item.eventos.length) { problemas.push(`${item.pasta.rotulo}: nenhuma aula no Teamup nessa data`); continue; }
    const nomes = item.arquivos.filter((a) => a.sobe).map((a) => a.arquivo);
    if (!nomes.length) continue;
    const caminhoDe = (nome) => {
      const m = materiais.find((x) => x.data === plano.data && chaveDaPasta(x) === item.pasta.chave && x.arquivo === nome);
      return m ? path.join(raiz, m.caminho) : null;
    };
    for (const ev of item.eventos) {
      if (!ev.turmas.length) { if (!ev.turmasPuladas) problemas.push(`${ev.titulo}: sem link de turma da LW no Teamup`); continue; }
      const feitos = new Set();
      for (const t of ev.turmas) {
        const units = await unitsDoCurso(page, t.courseid);
        if (!units) { problemas.push(`${ev.titulo} · ${t.courseid}: nao consegui ler o curso`); continue; }
        // sem atividade (Zoom apagado e gravacao ainda nao entrou): fica para a proxima rodada
        const { atividades } = escolherAtividades(units, ev.titulo, plano.data, t.unit);
        let anexouAqui = false;
        for (const u of atividades) for (const nome of nomes) {
          if (jaTemArquivo(u.anexos, nome)) continue;
          const arq = caminhoDe(nome);
          if (!arq) continue;
          try {
            rodar('anexar-material.mjs', [t.courseid, u.titulo, arq, pasta], { SALVAR: '1', CONFIRMAR_SYNC: '1', UNIT_ID: u.id });
            feitos.add(nome);
            anexouAqui = true;
            console.log(`anexado: ${nome} em ${t.courseid} (${u.id})`);
          } catch (e) { problemas.push(`${ev.titulo} · ${t.courseid}: anexo de ${nome} falhou: ${e.message}`); }
        }
        if (anexouAqui) await new Promise((ok) => setTimeout(ok, 15000));
      }
      if (feitos.size) anexados.push({ titulo: ev.titulo, dataIso: plano.data, arquivos: [...feitos], turmas: ev.turmas.length, slugAdmin: ev.turmas[0].courseid });
    }
  }
  return { anexados, problemas };
}

// ---------- main ----------
const comTeams = args.includes('--teams');
if (GRAVAR && gravacoesRodando()) { console.log(new Date().toISOString(), 'Robo Gravacoes rodando agora: pulei esta rodada'); process.exit(0); }
if (GRAVAR && !pegarTrava()) { console.log(new Date().toISOString(), 'outra rodada do Robo Materiais em andamento, saindo'); process.exit(0); }
try {
  const listagem = arg('--listagem');
  const raiz = arg('--pasta') || process.env.MATERIAIS_PASTA || pastaShareNoOneDrive();
  const caminhos = listagem ? caminhosDaListagem(listagem) : caminhosDaPasta(raiz);
  const materiais = caminhos.map(lerCaminho).filter(Boolean);
  // turma que ainda nao comecou (ex. lote fev/2027) nao recebe material
  const { futuras, origem, erro: erroFuturas } = await turmasQueNaoComecaram();
  if (erroFuturas) console.log(`aviso: turmas futuras (${origem}): ${erroFuturas}`);
  const { eventos, pulados } = semTurmasFuturas(await eventosDoTeamup(datas[0], datas[datas.length - 1]), futuras);
  const planos = datas.map((d) => montarPlano(materiais, eventos, d));

  const slugs = new Set(planos.flatMap((p) => p.itens.flatMap((i) => i.eventos.flatMap((e) => e.turmas.map((t) => t.courseid)))));
  const unitsPorCurso = new Map();
  let resultado = { anexados: [], problemas: [] };
  if (GRAVAR && listagem) throw new Error('--gravar precisa da pasta de verdade (nao funciona com --listagem)');
  if (slugs.size && !args.includes('--sem-lw')) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await abrirLw(browser);
      if (GRAVAR) resultado = await anexarFaltantes({ page, planos, materiais, raiz });
      // relatorio com o estado DEPOIS de anexar
      for (const s of slugs) unitsPorCurso.set(s, await unitsDoCurso(page, s));
    } finally {
      await browser.close();
    }
  }

  const cabecalho = [`${GRAVAR ? `MATERIAIS · GRAVANDO (${resultado.anexados.reduce((n, a) => n + a.arquivos.length, 0)} PDF(s) anexado(s) nesta rodada)` : 'SIMULACAO de materiais (nada foi gravado na LW)'} · rodada ${new Date().toLocaleString('pt-BR')} · fonte: ${listagem || raiz}`];
  for (const a of resultado.anexados) cabecalho.push(`ANEXADO: ${a.titulo} (${dataBr(a.dataIso)}): ${a.arquivos.join(', ')}`);
  for (const p of resultado.problemas) cabecalho.push(`PROBLEMA: ${p}`);
  if (pulados.length) cabecalho.push(`Turmas que ainda nao comecaram, puladas: ${textoPuladas(pulados)}`);
  const texto = [cabecalho.join('\n'), ...planos.map((p) => relatorio(p, unitsPorCurso))].join('\n\n');
  console.log(texto);
  fs.mkdirSync(SAIDA, { recursive: true });
  const carimbo = `${isoLocal(hoje)}_${String(hoje.getHours()).padStart(2, '0')}${String(hoje.getMinutes()).padStart(2, '0')}`;
  fs.writeFileSync(path.join(SAIDA, `${carimbo}.txt`), texto, 'utf8');
  if (args.includes('--mostrar-teams')) console.log('\n--- mensagem do Teams ---\n' + resumoTeams(planos, unitsPorCurso).replace(/<br>/g, '\n'));
  if (comTeams && !GRAVAR) await avisarNoTeams(resumoTeams(planos, unitsPorCurso));
  if (comTeams && GRAVAR) {
    // anexados sempre; problema so' na 1a vez que aparece
    let estado = { problemas: {} };
    try { estado = { problemas: {}, ...JSON.parse(fs.readFileSync(ESTADO, 'utf8')) }; } catch { /* primeira vez */ }
    const novos = [...new Set(resultado.problemas)].filter((p) => !estado.problemas[p]);
    const msg = mensagemMateriais({ anexados: resultado.anexados, problemas: novos, baseUrl: process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '') });
    if (msg) {
      await avisarNoTeams(msg);
      for (const p of novos) estado.problemas[p] = new Date().toLocaleString('pt-BR');
      fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 1));
    }
  }
} catch (erro) {
  console.error(new Date().toISOString(), 'ERRO:', erro.message);
  // falha calada = ninguem percebe que o robo parou (licao do revisor de CSAT)
  if (comTeams) await avisarNoTeams(`❌ <b>📎 Robô Materiais</b> · a rodada NÃO rodou: ${erro.message}`).catch(() => {});
  process.exitCode = 1;
} finally {
  if (GRAVAR) soltarTrava();
}

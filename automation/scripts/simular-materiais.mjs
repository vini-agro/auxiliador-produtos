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
import { lerCaminho, montarPlano, dataBr, escolherAtividades } from '../src/materiaisAula.js';
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
            if (u.anexos.includes(pdf)) { L.push(`         ✔ ja tem ${pdf}`); contagem.jaTem++; }
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
          for (const u of dest.atividades) for (const pdf of pdfs) (u.anexos.includes(pdf) ? ja++ : sobe++);
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

// ---------- main ----------
const comTeams = args.includes('--teams');
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
  if (slugs.size && !args.includes('--sem-lw')) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await abrirLw(browser);
      for (const s of slugs) unitsPorCurso.set(s, await unitsDoCurso(page, s));
    } finally {
      await browser.close();
    }
  }

  const cabecalho = [`SIMULACAO de materiais (nada foi gravado na LW) · rodada ${new Date().toLocaleString('pt-BR')} · fonte: ${listagem || raiz}`];
  if (pulados.length) cabecalho.push(`Turmas que ainda nao comecaram, puladas: ${textoPuladas(pulados)}`);
  const texto = [cabecalho.join('\n'), ...planos.map((p) => relatorio(p, unitsPorCurso))].join('\n\n');
  console.log(texto);
  fs.mkdirSync(SAIDA, { recursive: true });
  const carimbo = `${isoLocal(hoje)}_${String(hoje.getHours()).padStart(2, '0')}${String(hoje.getMinutes()).padStart(2, '0')}`;
  fs.writeFileSync(path.join(SAIDA, `${carimbo}.txt`), texto, 'utf8');
  if (args.includes('--mostrar-teams')) console.log('\n--- mensagem do Teams ---\n' + resumoTeams(planos, unitsPorCurso).replace(/<br>/g, '\n'));
  if (comTeams) await avisarNoTeams(resumoTeams(planos, unitsPorCurso));
} catch (erro) {
  console.error(new Date().toISOString(), 'ERRO:', erro.message);
  // falha calada = ninguem percebe que o robo parou (licao do revisor de CSAT)
  if (comTeams) await avisarNoTeams(`❌ Simulação de materiais NÃO rodou: ${erro.message}`).catch(() => {});
  process.exitCode = 1;
}

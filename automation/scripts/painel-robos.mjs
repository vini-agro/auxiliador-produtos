// Painel dos robos: le o Agendador do Windows, os logs/relatorios e o n8n e grava
// painel/painel-robos.html. SO LEITURA: nunca roda, para ou altera robo, tarefa, LW ou n8n.
// Uso: node scripts/painel-robos.mjs   (a tarefa "Painel robos" roda a cada 5 min, oculta)
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  estadoDaTarefa, estadoDoRobo, faixaTopo, ultimaRodada, resumir, avisouTeams, INICIO_RODADA, montarHtml,
  ultimoHorarioAgendado, diasDaAgenda, avisoDoDia,
} from '../src/painelRobos.js';

const RAIZ = process.cwd();
const SAIDA = path.join(RAIZ, 'painel');
const arq = (...p) => path.join(RAIZ, ...p);

const ROBOS = [
  { id: 'troca', descricao: 'tarefas do Agendador do Windows (ter/qua/qui) que rodam scripts/troca-gravacao.mjs: trocam o Zoom da aula B2C pela gravação editada do Vimeo (Embed + CSAT + material), passam a presença do Zoom para o Embed e avisam no Teams; nunca apagam o Zoom',  nome: 'Troca de gravação', tarefas: ['Troca gravacao 0830', 'Troca gravacao 10h', 'Troca gravacao 13h', 'Troca gravacao 16h', 'Troca gravacao 18h'], log: arq('troca-gravacao.log'), pasta: arq('troca-gravacao') },
  { id: 'materiais', descricao: 'tarefa do Agendador do Windows (de 2 em 2h) que roda scripts/simular-materiais.mjs: anexa nas aulas da LW os PDFs da pasta Share do OneDrive e avisa no Teams',  nome: 'Materiais das aulas', tarefas: ['Robo Materiais'], log: arq('simular-materiais.log'), pasta: arq('simulacao-materiais') },
  { id: 'revisor', descricao: 'tarefas do Agendador do Windows (08h, 14h, 17h) que rodam scripts/revisor-csat-diario.mjs: conferem CSAT, tipo de atividade, Zoom esquecido, Teamup e materiais de cada aula da semana na LW e avisam no Teams (só leitura)',  nome: 'Revisor geral', tarefas: ['Revisor geral 08h', 'Revisor geral 14h', 'Revisor geral 17h'], log: arq('revisor-csat.log') },
  { id: 'divisor', descricao: 'tarefa do Agendador do Windows (06h) que roda scripts/descer-divisor.mjs: desce o divisor PRÓXIMAS AULAS para logo abaixo da próxima aula em cada curso da LW; avisa no Teams só em falha',  nome: 'Divisor próximas aulas', tarefas: ['Descer divisor 06h'], log: arq('descer-divisor.log'), pasta: arq('divisor') },
  { id: 'certificados', descricao: 'tarefa do Agendador do Windows (07:30) que roda scripts/traduzir-certificados-diario.mjs: traduz para português o certificado de conclusão dos cursos da LW alterados',  nome: 'Tradução de certificados', tarefas: ['Traduzir certificados LW'], log: arq('traduzir-certificados.log') },
];

// ---------- Agendador (datas em ISO para nao depender do formato pt-BR) ----------
function lerAgendador(nomes) {
  const lista = nomes.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
  // servico do Agendador (COM): ~0,3 s para todas; Get-ScheduledTask -TaskName leva ~4 s cada e estourava o tempo
  // gatilho COM: Type 2 = diario, 3 = semanal (DaysOfWeek e' o mesmo bitmask do CIM)
  const ps = `$ErrorActionPreference='SilentlyContinue'; $svc = New-Object -ComObject Schedule.Service; $svc.Connect(); $raiz = $svc.GetFolder('\\'); @(${lista}) | ForEach-Object { $t = $null; try { $t = $raiz.GetTask($_) } catch {}; if ($t) { [pscustomobject]@{ nome=$t.Name; ultima=$t.LastRunTime.ToString('o'); resultado=$t.LastTaskResult; proxima=$t.NextRunTime.ToString('o'); perdidas=$t.NumberOfMissedRuns; ativa=$t.Enabled; gatilhos=@($t.Definition.Triggers | Where-Object { $_.Enabled } | ForEach-Object { if ($_.Repetition.Interval) { @{ tipo='outro' } } elseif ($_.Type -eq 3) { @{ tipo='semanal'; inicio=$_.StartBoundary; dias=[int]$_.DaysOfWeek } } elseif ($_.Type -eq 2) { @{ tipo='diario'; inicio=$_.StartBoundary; intervalo=[int]$_.DaysInterval } } else { @{ tipo='outro' } } }) } } } | ConvertTo-Json -Compress -Depth 4`;
  const saida = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 120000, windowsHide: true }).trim();
  const j = saida ? JSON.parse(saida) : [];
  const data = (s) => { const d = s ? new Date(s) : null; return d && !Number.isNaN(d.getTime()) && d.getFullYear() > 2000 ? d : null; };
  const agora = new Date();
  return new Map((Array.isArray(j) ? j : [j]).map((t) => {
    const gatilhos = Array.isArray(t.gatilhos) ? t.gatilhos : (t.gatilhos ? [t.gatilhos] : []);
    return [t.nome, {
      nome: t.nome, ultima: data(t.ultima), resultado: Number(t.resultado), proxima: t.ativa ? data(t.proxima) : null, perdidas: Number(t.perdidas) || 0,
      // horario da agenda que ja passou: pega a rodada perdida mesmo quando o Windows zera o contador
      agendada: t.ativa ? ultimoHorarioAgendado(gatilhos, agora) : null,
      diasAgendados: diasDaAgenda(gatilhos),
    }];
  }));
}

// ---------- arquivos ----------
const mtime = (f) => { try { return fs.statSync(f).mtime; } catch { return null; } };
const ler = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
function maisNovo(pasta) {
  try {
    const fs2 = fs.readdirSync(pasta).filter((n) => n.endsWith('.txt')).map((n) => path.join(pasta, n));
    return fs2.sort((a, b) => mtime(b) - mtime(a))[0] || null;
  } catch { return null; }
}
// so o fim do log (os logs crescem sem parar)
const fimDoLog = (f) => { const t = ler(f); return t.length > 400000 ? t.slice(-400000) : t; };

// furos (erro/rodada perdida) guardados entre uma geracao e outra: o aviso fica so no dia do furo e a
// rodada seguinte que der certo mostra qual ela cobriu (avisoDoDia). Pasta painel/ e' ignorada no git.
const ARQ_FUROS = path.join(SAIDA, 'furos.json');
const furos = (() => { try { return JSON.parse(fs.readFileSync(ARQ_FUROS, 'utf8')); } catch { return {}; } })();

function montarRobo(cfg, agendador) {
  const relatorio = cfg.pasta ? maisNovo(cfg.pasta) : null;
  const relatorioEm = [mtime(cfg.log), relatorio && mtime(relatorio)].filter(Boolean).sort((a, b) => b - a)[0] || null;
  const tarefas = cfg.tarefas.map((n) => {
    const info = agendador.get(n);
    // sem leitura do Agendador nao da' para dizer que a tarefa sumiu: fica neutra e o aviso sai uma vez so' no topo
    if (!info && erroAgendador) return { nome: n, estado: 'nunca', texto: 'sem leitura do Agendador', ultima: null, proxima: null };
    if (!info) return { nome: n, estado: 'erro', texto: 'tarefa não existe no Agendador', ultima: null, proxima: null };
    const r = avisoDoDia({ nome: n, ...estadoDaTarefa(info, relatorioEm), ultima: info.ultima, proxima: info.proxima }, furos[n] || null, agora);
    if (r.furo) furos[n] = r.furo; else delete furos[n];
    return r.tarefa;
  });
  const log = fimDoLog(cfg.log);
  const bloco = cfg.id === 'materiais' ? ler(relatorio) : ultimaRodada(log, INICIO_RODADA[cfg.id]);
  const rodadaNoLog = cfg.id === 'materiais' ? log.slice(-20000) : bloco;
  return {
    nome: cfg.nome,
    descricao: cfg.descricao,
    estado: estadoDoRobo(tarefas.map((t) => t.estado)),
    tarefas,
    resumo: resumir(cfg.id, bloco),
    teams: avisouTeams(rodadaNoLog),
    fontes: [cfg.log, relatorio].filter(Boolean),
  };
}

// ---------- n8n: robo de Presenca Zoom (07:00) ----------
async function roboN8n(agora) {
  const base = { nome: 'Presença Zoom (n8n)', descricao: 'workflow do n8n na42taXeTMbq3IAv (LW - Presença Zoom 75%), todo dia 07:00: dá presença na LW a quem ficou 75% (MBA/Pós) ou 90% (B2B) do tempo do professor no Zoom da véspera; o robô de troca também dispara ele por webhook', tarefas: [], resumo: [], teams: null, fontes: ['n8n workflow na42taXeTMbq3IAv (LW - Presença Zoom 75%)'] };
  const proxima = new Date(agora); proxima.setHours(7, 0, 0, 0); if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);
  try {
    if (!process.env.N8N_API_KEY) throw new Error('sem N8N_API_KEY no .env');
    const r = await fetch('https://editor.agroadvance.com.br/api/v1/executions?workflowId=na42taXeTMbq3IAv&limit=20', { headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`n8n respondeu ${r.status}`);
    const lista = (await r.json()).data || [];
    // a rodada das 07:00 e' a de mode "trigger"; "webhook" = disparo do robo de troca ou teste
    const ex = lista.find((e) => e.mode === 'trigger');
    const extras = lista.filter((e) => e.mode === 'webhook' && new Date(e.startedAt).toDateString() === agora.toDateString());
    const ultima = ex ? new Date(ex.startedAt) : null;
    const hoje7 = new Date(agora); hoje7.setHours(7, 0, 0, 0);
    let estado = 'ok', texto = 'em dia';
    if (!ex) { estado = 'nunca'; texto = 'ainda não rodou'; }
    else if (ex.status === 'running' || ex.status === 'waiting') { estado = 'rodando'; texto = 'rodando agora'; }
    else if (ex.status === 'error' || ex.status === 'crashed') { estado = 'erro'; texto = `erro (execução ${ex.id})`; }
    else if (agora - hoje7 > 10 * 60000 && ultima < hoje7) { estado = 'perdida'; texto = 'não rodou hoje às 07:00'; }
    const tarefa = { nome: 'Presença Zoom 07:00', estado, texto, ultima, proxima };
    const resumo = [];
    if (ex) resumo.push(`Rodada agendada: execução ${ex.id}, ${ex.status === 'success' ? 'terminou sem erro' : ex.status}`);
    if (extras.length) resumo.push(`Hoje mais ${extras.length} disparo(s) pela troca de gravação (${extras.filter((e) => e.status !== 'success').length} com erro)`);
    return { ...base, estado, tarefas: [tarefa], resumo };
  } catch (e) {
    return { ...base, estado: 'erro', erroLeitura: `não consegui ler o n8n: ${e.message}`, tarefas: [{ nome: 'Presença Zoom 07:00', estado: 'nunca', texto: 'sem leitura', ultima: null, proxima }] };
  }
}

// ---------- principal ----------
const agora = new Date();
let agendador = new Map();
let erroAgendador = null;
for (let tentativa = 1; tentativa <= 2; tentativa++) {
  try { agendador = lerAgendador(ROBOS.flatMap((r) => r.tarefas)); erroAgendador = null; break; } catch (e) { erroAgendador = e.message.split('\n')[0]; }
}
const robos = ROBOS.map((cfg) => {
  try {
    const r = montarRobo(cfg, agendador);
    return erroAgendador ? { ...r, erroLeitura: `não consegui ler o Agendador: ${erroAgendador}` } : r;
  } catch (e) {
    return { nome: cfg.nome, estado: 'erro', tarefas: [], resumo: [], teams: null, fontes: [cfg.log], erroLeitura: `não consegui montar o cartão: ${e.message}` };
  }
});
robos.splice(1, 0, await roboN8n(agora));

fs.mkdirSync(SAIDA, { recursive: true });
try { fs.writeFileSync(ARQ_FUROS, JSON.stringify(furos, null, 2), 'utf8'); } catch (e) { console.error('não gravei os furos:', e.message); }
const destino = path.join(SAIDA, 'painel-robos.html');
const tmp = destino + '.tmp';
// simbolo da Agroadvance embutido na pagina (abre sem internet); sem o arquivo, a pagina sai sem ele
let logo = null;
try { logo = `data:image/png;base64,${fs.readFileSync(arq('painel-assets', 'logo-agroadvance-simbolo.png')).toString('base64')}`; } catch (e) { console.error('sem o simbolo da Agroadvance:', e.message); }
fs.writeFileSync(tmp, montarHtml({ geradoEm: agora, faixa: faixaTopo(robos), robos, logo }), 'utf8');
fs.renameSync(tmp, destino); // troca de uma vez: o navegador nunca le a pagina pela metade
console.log(destino);

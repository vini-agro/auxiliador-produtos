import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoDaTarefa, estadoDoRobo, faixaTopo, ultimaRodada, resumir, avisouTeams, INICIO_RODADA, montarHtml,
} from '../src/painelRobos.js';

const ult = new Date('2026-11-19T11:30:00Z');
const info = (over = {}) => ({ nome: 'Troca gravacao 0830', ultima: ult, resultado: 0, proxima: new Date('2026-11-24T11:30:00Z'), perdidas: 0, ...over });

// ---------- Task 1: estado ----------
test('estadoDaTarefa: codigo 0 com relatorio da rodada = ok', () => {
  assert.equal(estadoDaTarefa(info(), new Date(ult.getTime() + 30000)).estado, 'ok');
});

test('estadoDaTarefa: codigo 0 sem relatorio novo = sem-relatorio (nunca verde calado)', () => {
  assert.equal(estadoDaTarefa(info(), new Date(ult.getTime() - 2 * 3600000)).estado, 'sem-relatorio');
  assert.equal(estadoDaTarefa(info(), null).estado, 'sem-relatorio');
});

test('estadoDaTarefa: codigos de erro', () => {
  const e1 = estadoDaTarefa(info({ resultado: 1 }), ult);
  assert.equal(e1.estado, 'erro');
  assert.match(e1.texto, /erro na rodada de 19\/nov \d{2}:30: o robô terminou com erro/);
  const e2 = estadoDaTarefa(info({ resultado: 3221225786 }), ult);
  assert.equal(e2.estado, 'erro');
  assert.match(e2.texto, /rodada interrompida/);
  assert.match(estadoDaTarefa(info({ resultado: 42 }), ult).texto, /código 42/);
});

test('estadoDaTarefa: rodando e nunca rodou nao sao erro', () => {
  assert.equal(estadoDaTarefa(info({ resultado: 267009 }), null).estado, 'rodando');
  assert.equal(estadoDaTarefa(info({ resultado: 267011, ultima: null }), null).estado, 'nunca');
});

test('estadoDaTarefa: rodada perdida', () => {
  assert.equal(estadoDaTarefa(info({ perdidas: 1 }), new Date(ult.getTime() + 1000)).estado, 'perdida');
});

test('estadoDaTarefa: perdida hoje vem antes do erro da rodada anterior', () => {
  const e = estadoDaTarefa(info({ perdidas: 1, resultado: 1 }), ult);
  assert.equal(e.estado, 'perdida');
  assert.match(e.texto, /^rodada perdida; a anterior deu erro na rodada de 19\/nov/);
});

test('estadoDoRobo: pior estado vence', () => {
  assert.equal(estadoDoRobo(['ok', 'perdida', 'ok']), 'perdida');
  assert.equal(estadoDoRobo(['ok', 'erro', 'perdida']), 'erro');
  assert.equal(estadoDoRobo(['ok', 'nunca']), 'nunca');
  assert.equal(estadoDoRobo([]), 'nunca');
});

test('faixaTopo: cita a tarefa exata', () => {
  const troca = { nome: 'Troca de gravação', tarefas: [{ nome: 'Troca gravacao 0830', estado: 'ok', texto: '' }, { nome: 'Troca gravacao 10h', estado: 'perdida', texto: 'rodada perdida' }] };
  assert.deepEqual(faixaTopo([troca]), { ok: false, itens: ['Troca gravacao 10h: rodada perdida'] });
  assert.deepEqual(faixaTopo([{ nome: 'Divisor', tarefas: [{ nome: 'Descer divisor 06h', estado: 'ok', texto: '' }] }]), { ok: true, itens: [] });
});

test('faixaTopo: erro de leitura do robo entra na faixa', () => {
  const r = faixaTopo([{ nome: 'Presença Zoom (n8n)', tarefas: [], erroLeitura: 'não consegui ler o n8n' }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.itens, ['Presença Zoom (n8n): não consegui ler o n8n']);
});

// ---------- Task 2: resumo ----------
const divisor = [
  'Divisor PROXIMAS AULAS | hoje 18/11/2026 | GRAVANDO | 18/11/2026, 08:09:25',
  'Fim: 3 movidos, 9 acertados pela sync, 0 falhas, 0 avisos.',
  'Divisor PROXIMAS AULAS | hoje 19/11/2026 | GRAVANDO | 19/11/2026, 08:17:39',
  'MOVIDO       curso-x-4 | abaixo de [Ao vivo] 25/11/2026 | Aula X | total 53 -> 53',
  'Fim: 3 movidos, 7 acertados pela sync, 0 falhas, 0 avisos.',
].join('\n');

test('ultimaRodada: so o ultimo bloco', () => {
  const b = ultimaRodada(divisor, INICIO_RODADA.divisor);
  assert.match(b, /hoje 19\/11/);
  assert.doesNotMatch(b, /hoje 18\/11/);
  assert.equal(ultimaRodada('', /x/), '');
  assert.equal(ultimaRodada(null, /x/), '');
  assert.equal(ultimaRodada('sem cabecalho', /^NADA/m), 'sem cabecalho');
});

test('resumir divisor', () => {
  assert.deepEqual(resumir('divisor', ultimaRodada(divisor, INICIO_RODADA.divisor)), ['Fim: 3 movidos, 7 acertados pela sync, 0 falhas, 0 avisos.']);
});

const troca = [
  'TROCA DO ZOOM PELA GRAVACAO · GRAVANDO: embed, material, presenca · rodada 19/11/2026, 09:26:05',
  '',
  '🎬 GPA_16112026_FULANA_DE_TAL_PLANEJAMENTO_ED',
  '   Vimeo 1 · 80 min · https://player.vimeo.com/video/1',
  '   ✅ mba-x-7: 0 aluno(s) a passar, 0 ainda sem presenca no Embed',
  '   🟢 Zoom estaria SEGURO para apagar (nao foi apagado)',
  '',
  '🎬 VNA_16112026_CICRANO_VENDAS_ED',
  '   · ja concluida e avisada em 18/11/2026, 15:34:31, pulada',
  '',
  '🎬 BAYER_16112026_BELTRANO_DOENCAS_ED',
  '   · fora do escopo (B2B: B2B-Bayer)',
  '',
  '🎬 PFV_17112026_ALGUEM_SISTEMA_IMUNE_ED',
  '   🔴 Zoom NAO seguro para apagar: x',
  '',
  '🎬 PB_18112026_OUTRO_AULA_ED',
  '   ❌ nao achei o evento no Teamup',
  'aviso enviado pro Teams',
].join('\n');

test('resumir troca: uma linha por gravacao', () => {
  assert.deepEqual(resumir('troca', troca), [
    'GPA 16/nov: 🟢 seguro',
    'VNA 16/nov: já feita',
    'BAYER 16/nov: fora (B2B)',
    'PFV 17/nov: 🔴 não seguro',
    'PB 18/nov: erro',
  ]);
  assert.deepEqual(resumir('troca', 'TROCA DO ZOOM PELA GRAVACAO · x\n\nNenhuma gravacao editada (_ED) nova nessa janela.'), ['Nenhuma gravação nova']);
});

test('resumir revisor', () => {
  const r = resumir('revisor', '2026-11-19T11:11:54.652Z conferindo de 2026-11-16 a 2026-11-29\n<b>Revisor</b><br><i>Mudou desde a ultima conferida: 8 novo(s), 1 resolvido(s).</i><br>\n2026-11-19T11:17:05.144Z fim: 92 achado(s) em 100 aula(s)');
  assert.deepEqual(r, ['fim: 92 achado(s) em 100 aula(s)', 'Mudou desde a ultima conferida: 8 novo(s), 1 resolvido(s).']);
});

test('resumir certificados e materiais', () => {
  assert.deepEqual(resumir('certificados', '[19/11/2026, 08:17:42] olhando cursos\n[19/11/2026, 08:21:32] fim: 0 traduzido(s), 0 erro(s).'), ['fim: 0 traduzido(s), 0 erro(s).']);
  assert.deepEqual(resumir('materiais', ''), []);
  assert.deepEqual(resumir('materiais', 'x\nResumo 19/nov/2026: 0 anexo(s) a subir · 0 ja estavam · 0 problema(s) · 1 aula(s) sem pasta\ny'), ['Resumo 19/nov/2026: 0 anexo(s) a subir · 0 ja estavam · 0 problema(s) · 1 aula(s) sem pasta']);
});

test('resumir materiais: dia passado so com algo a fazer ou problema', () => {
  const rel = [
    'Resumo 12/nov/2026: 0 anexo(s) a subir · 0 ja estavam · 0 problema(s) · 2 aula(s) sem pasta',
    'Resumo 16/nov/2026: 0 anexo(s) a subir · 31 ja estavam · 3 problema(s) · 0 aula(s) sem pasta',
    'Resumo 17/nov/2026: 2 anexo(s) a subir · 0 ja estavam · 0 problema(s) · 0 aula(s) sem pasta',
    'Resumo 19/nov/2026: 0 anexo(s) a subir · 0 ja estavam · 0 problema(s) · 1 aula(s) sem pasta',
    'Resumo 20/nov/2026: 0 anexo(s) a subir · 0 ja estavam · 0 problema(s) · 0 aula(s) sem pasta',
  ].join('\n');
  const r = resumir('materiais', rel, { hoje: new Date(2026, 10, 19, 10) });
  assert.deepEqual(r.map((l) => l.slice(7, 13)), ['16/nov', '17/nov', '19/nov', '20/nov']);
});

test('avisouTeams', () => {
  assert.equal(avisouTeams('...\naviso enviado pro Teams.'), true);
  assert.equal(avisouTeams('nada'), false);
  assert.equal(avisouTeams(null), false);
});

// ---------- Task 3: HTML ----------
const roboBase = (over = {}) => ({
  nome: 'Troca de gravação', estado: 'perdida', resumo: ['Aula <A&B> "x"'], teams: true,
  fontes: ['C:\\x\\troca-gravacao.log'],
  tarefas: [
    { nome: 'Troca gravacao 0830', estado: 'ok', texto: 'ok', ultima: new Date('2026-11-19T11:30:00Z'), proxima: new Date('2026-11-24T11:30:00Z') },
    { nome: 'Troca gravacao 13h', estado: 'ok', texto: 'ok', ultima: null, proxima: new Date('2026-11-19T16:00:00Z') },
  ],
  ...over,
});
const gerado = new Date(2026, 10, 19, 10, 45);

test('montarHtml: faixa e data', () => {
  const ok = montarHtml({ geradoEm: gerado, faixa: { ok: true, itens: [] }, robos: [roboBase({ estado: 'ok' })] });
  assert.match(ok, /Tudo rodou/);
  assert.match(ok, /19\/nov\/2026/);
  assert.doesNotMatch(ok, /—/);
  const ruim = montarHtml({ geradoEm: gerado, faixa: { ok: false, itens: ['Troca gravacao 10h: rodada perdida'] }, robos: [roboBase()] });
  assert.match(ruim, /Troca gravacao 10h: rodada perdida/);
});

test('montarHtml: escapa texto do relatorio', () => {
  const h = montarHtml({ geradoEm: gerado, faixa: { ok: true, itens: [] }, robos: [roboBase()] });
  assert.match(h, /Aula &lt;A&amp;B&gt; &quot;x&quot;/);
  assert.doesNotMatch(h, /Aula <A&B>/);
});

test('montarHtml: barra vai da ultima rodada a proxima mais cedo', () => {
  const h = montarHtml({ geradoEm: gerado, faixa: { ok: true, itens: [] }, robos: [roboBase()] });
  assert.match(h, /data-ultima="2026-11-19T11:30:00.000Z"/);
  assert.match(h, /data-proxima="2026-11-19T16:00:00.000Z"/);
});

test('montarHtml: sem proxima rodada nao tem barra', () => {
  const r = roboBase({ tarefas: [{ nome: 'X', estado: 'ok', texto: '', ultima: null, proxima: null }] });
  const h = montarHtml({ geradoEm: gerado, faixa: { ok: true, itens: [] }, robos: [r] });
  assert.match(h, /sem próxima rodada/);
  assert.doesNotMatch(h, /data-proxima=/);
});

test('montarHtml: contexto da pergunta leva o que e o robo, cada tarefa e o resumo', () => {
  const r = roboBase({
    descricao: 'Tarefa do Agendador do Windows que troca o Zoom pela gravação',
    tarefas: [
      { nome: 'Troca gravacao 10h', estado: 'perdida', texto: 'rodada perdida', ultima: new Date('2026-11-18T18:03:00Z'), proxima: new Date('2026-11-24T13:00:00Z') },
    ],
  });
  const h = montarHtml({ geradoEm: gerado, faixa: { ok: true, itens: [] }, robos: [r] });
  const ctx = (h.match(/data-contexto="([^"]*)"/) || [])[1] || '';
  assert.match(ctx, /O que é: Tarefa do Agendador do Windows que troca o Zoom pela gravação/);
  assert.match(ctx, /- Troca gravacao 10h: rodada perdida \(rodou 18\/nov \d{2}:03 · próxima 24\/nov \d{2}:00\)/);
  assert.match(ctx, /Última rodada:&#10;- Aula &lt;A&amp;B&gt;/);
});

test('montarHtml: tarefa com nome em negrito e check so se ja rodou hoje', () => {
  const agora = new Date(2026, 10, 19, 11, 0);
  const r = roboBase({ tarefas: [
    { nome: 'Troca gravacao 0830', estado: 'ok', texto: 'em dia', ultima: new Date(2026, 10, 19, 8, 30), proxima: new Date(2026, 10, 24, 8, 30) },
    { nome: 'Troca gravacao 16h', estado: 'ok', texto: 'em dia', ultima: new Date(2026, 10, 18, 16, 0), proxima: new Date(2026, 10, 19, 16, 0) },
    { nome: 'Troca gravacao 18h', estado: 'ok', texto: 'em dia', ultima: new Date(2026, 10, 17, 18, 0), proxima: new Date(2026, 10, 24, 18, 0) },
    { nome: 'Troca gravacao 13h', estado: 'erro', texto: 'erro x', ultima: new Date(2026, 10, 18, 15, 3), proxima: new Date(2026, 10, 19, 13, 0) },
  ] });
  const h = montarHtml({ geradoEm: agora, faixa: { ok: true, itens: [] }, robos: [r] });
  const li = (nome) => (h.match(new RegExp(`<li[^>]*>[^<]*<b>${nome}:</b>.*?</li>`)) || [''])[0];
  assert.match(li('Troca gravacao 0830'), /✅/);
  assert.match(li('Troca gravacao 0830'), /concluída hoje 08:30/);
  assert.doesNotMatch(li('Troca gravacao 16h'), /✅/);
  assert.match(li('Troca gravacao 16h'), /aguarda 19\/nov 16:00/);
  assert.match(li('Troca gravacao 16h'), /class="t-aguarda"/);
  assert.doesNotMatch(li('Troca gravacao 18h'), /✅/);
  assert.match(li('Troca gravacao 18h'), /sem rodada hoje · última 17\/nov 18:00/);
  assert.match(li('Troca gravacao 13h'), /❌/);
});

test('montarHtml: rodada atrasada de ontem que rodou hoje cedo nao conta como a de hoje', () => {
  // caso real 19/nov: a 18h de 18/nov nao rodou, o Windows soltou as 08:17 de 19/nov; a de hoje ainda e' as 18:00
  const agora = new Date(2026, 10, 19, 11, 40);
  const r = roboBase({ tarefas: [
    { nome: 'Troca gravacao 18h', estado: 'ok', texto: 'em dia', ultima: new Date(2026, 10, 19, 8, 17), proxima: new Date(2026, 10, 19, 18, 0) },
    { nome: 'Troca gravacao 0830', estado: 'ok', texto: 'em dia', ultima: new Date(2026, 10, 19, 8, 30), proxima: new Date(2026, 10, 24, 8, 30) },
  ] });
  const h = montarHtml({ geradoEm: agora, faixa: { ok: true, itens: [] }, robos: [r] });
  const li = (nome) => (h.match(new RegExp(`<li[^>]*>[^<]*<b>${nome}:</b>.*?</li>`)) || [''])[0];
  assert.doesNotMatch(li('Troca gravacao 18h'), /✅/);
  assert.match(li('Troca gravacao 18h'), /aguarda 19\/nov 18:00/);
  assert.match(li('Troca gravacao 0830'), /✅ <b>Troca gravacao 0830:<\/b> concluída hoje 08:30/);
});

test('montarHtml: cartoes na ordem do proximo a disparar; sem proxima vai pro fim', () => {
  const t = (proxima) => [{ nome: 'x', estado: 'ok', texto: '', ultima: null, proxima }];
  const robos = [
    roboBase({ nome: 'Divisor', tarefas: t(new Date(2026, 10, 20, 6, 0)) }),
    roboBase({ nome: 'Sem agenda', tarefas: t(null) }),
    roboBase({ nome: 'Troca', tarefas: [...t(new Date(2026, 10, 24, 8, 30)), ...t(new Date(2026, 10, 19, 13, 0))] }),
    roboBase({ nome: 'Materiais', tarefas: t(new Date(2026, 10, 19, 12, 0)) }),
  ];
  const h = montarHtml({ geradoEm: gerado, faixa: { ok: true, itens: [] }, robos });
  const ordem = [...h.matchAll(/data-robo="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ordem, ['Materiais', 'Troca', 'Divisor', 'Sem agenda']);
});

test('montarHtml: identidade Agroadvance (cores, fonte, simbolo opcional)', () => {
  const com = montarHtml({ geradoEm: gerado, faixa: { ok: true, itens: [] }, robos: [], logo: 'data:image/png;base64,AAA' });
  assert.match(com, /--navy:#012B4B/);
  assert.match(com, /--verde:#00A256/);
  assert.match(com, /Montserrat/);
  assert.match(com, /<img class="simbolo" src="data:image\/png;base64,AAA"/);
  const sem = montarHtml({ geradoEm: gerado, faixa: { ok: true, itens: [] }, robos: [] });
  assert.doesNotMatch(sem, /class="simbolo"/);
  assert.match(sem, /onerror="this.remove\(\)"/);
});

test('montarHtml: erro de leitura e perguntar ao Claude', () => {
  const h = montarHtml({ geradoEm: gerado, faixa: { ok: false, itens: [] }, robos: [roboBase({ erroLeitura: 'não consegui ler o n8n' })] });
  assert.match(h, /não consegui ler o n8n/);
  assert.match(h, /Copiar pergunta/);
  assert.match(h, /data-fontes="Log: C:\\x\\troca-gravacao.log"/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerGravacao, escolherGravacao, eventoDaGravacao, ehB2C, aulaCompartilhada,
  linkCsat, eventoDaAula, planoDaAula, veredito,
} from '../src/trocaGravacao.js';

test('lerGravacao: so video editado com duracao', () => {
  assert.deepEqual(lerGravacao('AGRICHEM_13112026_ANDRE REIS_O PAPEL DA NUTRICAO_ED', 5400), { sigla: 'AGRICHEM', dataIso: '2026-11-13' });
  assert.equal(lerGravacao('AGRICHEM_13112026_ANDRE REIS_O PAPEL DA NUTRICAO', 5400), null);
  assert.equal(lerGravacao('GPA_16112026_MELINA_PLANEJAMENTO_ED', 0), null);
  assert.equal(lerGravacao('MBAs_16112026_ADELINO THOMAZINI_SEGMENTACAO_ED.mp4', 7000).sigla, 'MBAS');
  assert.equal(lerGravacao('sem padrao nenhum_ED', 100), null);
  // aula conjunta dos MBAs as vezes vem sem o "s" (Pricing 09/nov/2026)
  assert.equal(lerGravacao('MBA_09112026_ROGERIO_DIACOV_PRICING_ED', 9960).sigla, 'MBAS');
});

test('escolherGravacao: uma por aula, a mais recente', () => {
  const m = escolherGravacao([
    { id: '1', nome: 'GPA_16112026_MELINA_X_ED', duracao: 100, criado: '2026-11-17T10:00:00Z' },
    { id: '2', nome: 'GPA_16112026_MELINA_X_ED', duracao: 100, criado: '2026-11-17T12:00:00Z' },
    { id: '3', nome: 'GPA_16112026_MELINA_X', duracao: 100, criado: '2026-11-17T13:00:00Z' },
  ]);
  assert.equal(m.size, 1);
  assert.equal(m.get('GPA|2026-11-16').id, '2');
});

test('eventoDaGravacao: casa sigla e data, MBAs vira LGE/GTC/MEA, ambiguo vira erro', () => {
  const eventos = [
    { titulo: 'GPA | Planejamento Sucessorio | Melina', data: '2026-11-16', turmas: [] },
    { titulo: 'LGE, GTC, MEA | Segmentacao | Adelino', data: '2026-11-16', turmas: [] },
  ];
  assert.equal(eventoDaGravacao(eventos, 'GPA', '2026-11-16').evento.titulo, eventos[0].titulo);
  assert.equal(eventoDaGravacao(eventos, 'MBAS', '2026-11-16').evento.titulo, eventos[1].titulo);
  assert.match(eventoDaGravacao([...eventos, eventos[0]], 'GPA', '2026-11-16').erro, /mais de um evento/);
  assert.match(eventoDaGravacao(eventos, 'VNA', '2026-11-16').erro, /sem evento/);
});

test('ehB2C: categoria MBA/Pos ou slug mba-/pos- sem categoria', () => {
  assert.equal(ehB2C({ categorias: ['MBA'], slug: 'x' }), true);
  assert.equal(ehB2C({ categorias: ['Pós-graduação'], slug: 'x' }), true);
  assert.equal(ehB2C({ categorias: [], slug: 'pos-graduacao-soja-milho-4' }), true);
  assert.equal(ehB2C({ categorias: [], slug: 'mba-gestao-propriedade-agricolas-7' }), true);
  assert.equal(ehB2C({ categorias: ['B2B-Sanjo'], slug: 'sanjo' }), false);
  assert.equal(ehB2C({ categorias: [], slug: 'uni-agro-bayer' }), false);
});

test('aulaCompartilhada: mais de uma sigla na cabeca do titulo', () => {
  assert.equal(aulaCompartilhada('LGE, GTC, MEA | Segmentacao | Adelino'), true);
  assert.equal(aulaCompartilhada('GPA | Planejamento | Melina'), false);
});

test('linkCsat: link do pesquisa so com tipo valido, curso unico e nao cancelado', () => {
  const ev = { id: 'rectjZOHcFC99Dzta', tipoEntrega: 'Ao vivo', status: 'Pagamento', siglas: ['GPA'] };
  assert.equal(linkCsat(ev, false), 'https://pesquisa.agroadvance.com.br/rectjZOHcFC99Dzta');
  assert.equal(linkCsat({ ...ev, tipoEntrega: 'Gravada' }, false), null);
  assert.equal(linkCsat({ ...ev, status: 'CANCELADO' }, false), null);
  assert.equal(linkCsat({ ...ev, siglas: ['GTC', 'LGE', 'MEA'] }, false), null);
  assert.equal(linkCsat(ev, true), null);
  assert.equal(linkCsat(null, false), null);
});

test('eventoDaAula: mesma data e mesmo nome de aula do Teamup', () => {
  const eventos = [
    { id: 'recA', data: '2026-11-16', aula: 'Planejamento Sucessório e Continuidade do Negócio Rural', siglas: ['GPA'] },
    { id: 'recB', data: '2026-11-17', aula: 'Planejamento Sucessório e Continuidade do Negócio Rural', siglas: ['GPA'] },
  ];
  assert.equal(eventoDaAula(eventos, '2026-11-16', 'GPA | Planejamento Sucessório e Continuidade do Negócio Rural | Melina Lobo Dantas').id, 'recA');
  assert.equal(eventoDaAula(eventos, '2026-11-18', 'GPA | Planejamento Sucessório e Continuidade do Negócio Rural | Melina'), null);
});

const TITULO_LW = '[Ao vivo] 16/11/2026 | Planejamento Sucessorio | Melina';
const TEAMUP = 'GPA | Planejamento Sucessorio | Melina';

test('planoDaAula: so Zoom = criar embed', () => {
  const units = new Map([['z', { titulo: TITULO_LW, tipo: 'zoomMeeting', anexos: [] }]]);
  const p = planoDaAula(units, TEAMUP, '2026-11-16', 'z');
  assert.equal(p.acao, 'criar-embed');
  assert.equal(p.zoom.id, 'z');
});

test('planoDaAula: Zoom + Embed gravado = ja feito; Embed vazio ou evento ao vivo = trocar video', () => {
  const zoom = ['z', { titulo: TITULO_LW, tipo: 'zoomMeeting', anexos: [] }];
  const gravado = new Map([zoom, ['e', { titulo: TITULO_LW, tipo: 'embed', anexos: [], html: '<iframe src="https://player.vimeo.com/video/123">' }]]);
  assert.equal(planoDaAula(gravado, TEAMUP, '2026-11-16').acao, 'ja-feito');
  const vazio = new Map([zoom, ['e', { titulo: TITULO_LW, tipo: 'embed', anexos: [], html: '' }]]);
  assert.equal(planoDaAula(vazio, TEAMUP, '2026-11-16').acao, 'trocar-video');
  const vmix = new Map([['e', { titulo: TITULO_LW, tipo: 'embed', anexos: [], html: '<iframe src="https://vimeo.com/event/6317116/embed/abc/interaction">' }]]);
  const p = planoDaAula(vmix, TEAMUP, '2026-11-16');
  assert.equal(p.acao, 'trocar-video');
  assert.equal(p.embed.id, 'e');
  assert.equal(p.zoom, null);
});

test('planoDaAula: nada com essa data e nome = nao achada; titulo diferente cai no link do Teamup', () => {
  const units = new Map([['x', { titulo: '[Ao vivo] 23/11/2026 | Outra | Fulano', tipo: 'zoomMeeting', anexos: [] }]]);
  assert.equal(planoDaAula(units, TEAMUP, '2026-11-16').acao, 'nao-achada');
  assert.equal(planoDaAula(units, TEAMUP, '2026-11-16', 'x').acao, 'criar-embed');
});

test('veredito: seguro so com paridade zerada e presenca Zoom sem erro nem revisao', () => {
  assert.deepEqual(veredito({ paridade: [{ turma: 'gpa-7', faltando: 0 }], presencaZoom: { revisar: [] } }), { seguro: true, motivos: [] });
  const r = veredito({ paridade: [{ turma: 'gpa-7', faltando: 2 }], presencaZoom: { revisar: [] } });
  assert.equal(r.seguro, false);
  assert.match(r.motivos[0], /gpa-7/);
  assert.equal(veredito({ paridade: [], presencaZoom: { revisar: ['Fulano'] } }).seguro, false);
  assert.equal(veredito({ paridade: [], presencaZoom: { erro: 'timeout', revisar: [] } }).seguro, false);
});

test('decidirCsat: compartilhada pelo Teamup ou pelo Agrotable fica sem botao; curso unico precisa de link', async () => {
  const { decidirCsat } = await import('../src/trocaGravacao.js');
  const unico = { id: 'rectjZOHcFC99Dzta', tipoEntrega: 'Ao vivo', status: 'Pagamento', siglas: ['GPA'] };
  assert.deepEqual(decidirCsat('GPA | Planejamento | Melina', unico), { tipo: 'link', link: 'https://pesquisa.agroadvance.com.br/rectjZOHcFC99Dzta' });
  assert.equal(decidirCsat('LGE, GTC, MEA | Pricing | Rogerio', null).tipo, 'compartilhada');
  // PFS 10/nov: Teamup so cita PFS, Agrotable diz PFS + PSS
  assert.equal(decidirCsat('PFS | Dinamica do Nitrogenio | Rafael Otto', { ...unico, siglas: ['PFS', 'PSS'] }).tipo, 'compartilhada');
  assert.equal(decidirCsat('GPA | Planejamento | Melina', null).tipo, 'sem-link');
  assert.equal(decidirCsat('GPA | Planejamento | Melina', { ...unico, tipoEntrega: 'Gravada' }).tipo, 'sem-link');
});

test('compararEstrutura: exige exatamente 1 Embed novo com o titulo em cada turma e nada sumido', async () => {
  const { compararEstrutura } = await import('../src/trocaGravacao.js');
  const T = '[Ao vivo] 16/11/2026 | Planejamento | Melina';
  const sec = (units) => [{ id: 's1', title: '[Obrigatório] Modulo', units }];
  const base = [['z', 'zoomMeeting', T], ['a', 'embed', 'Outra aula']];
  const antes = { t7: sec(base), t8: sec(base) };
  const ok = { t7: sec([...base, ['n7', 'embed', T]]), t8: sec([...base, ['n8', 'embed', T]]) };
  assert.deepEqual(compararEstrutura(antes, ok, T), { ok: true, problemas: [], novos: { t7: 'n7', t8: 'n8' } });
  const sumiu = { t7: sec([['z', 'zoomMeeting', T], ['n7', 'embed', T]]), t8: sec([...base, ['n8', 'embed', T]]) };
  assert.match(compararEstrutura(antes, sumiu, T).problemas[0], /t7: sumiu a 'a'/);
  const naoChegou = { t7: sec([...base, ['n7', 'embed', T]]), t8: sec(base) };
  assert.match(compararEstrutura(antes, naoChegou, T).problemas[0], /t8: 0 Embed\(s\) novo\(s\)/);
  const dois = { t7: sec([...base, ['n7', 'embed', T], ['m7', 'embed', T]]), t8: sec([...base, ['n8', 'embed', T]]) };
  assert.equal(compararEstrutura(antes, dois, T).ok, false);
});

test('planoDaAula: pelo link do Teamup tambem acha o Embed de mesmo titulo (nao cria de novo)', () => {
  const units = new Map([
    ['z', { titulo: 'teste [Ao vivo]', tipo: 'zoomMeeting', anexos: [] }],
    ['e', { titulo: 'teste [Ao vivo]', tipo: 'embed', anexos: [], html: '<iframe src="https://player.vimeo.com/video/1">' }],
  ]);
  const p = planoDaAula(units, 'TESTE | outro nome | Claude', '2026-11-17', 'z');
  assert.equal(p.acao, 'ja-feito');
  assert.equal(p.embed.id, 'e');
});

test('presencaDaAula: acha a aula no relatorio do robo de Presenca Zoom pelo titulo', async () => {
  const { presencaDaAula } = await import('../src/trocaGravacao.js');
  const saida = { dryRun: false, relatorio: [
    { aula: '[Ao vivo] 16/11/2026 | Planejamento Sucessório e Continuidade do Negócio Rural| Melina Lobo Dantas', revisar: ['João Paulo (125 min): João A / João B'], semAluno: [] },
    { aula: '[Ao vivo] 16/11/2026 | Arquitetura e Agentes de IA  | Guilherme', revisar: [], semAluno: [] },
  ] };
  assert.deepEqual(presencaDaAula(saida, '[Ao vivo] 16/11/2026 | Planejamento Sucessório e Continuidade do Negócio Rural| Melina Lobo Dantas'), { revisar: ['João Paulo (125 min): João A / João B'] });
  assert.deepEqual(presencaDaAula(saida, '[Ao vivo] 16/11/2026 | Arquitetura e Agentes de IA | Guilherme'), { revisar: [] });
  assert.match(presencaDaAula(saida, '[Ao vivo] 17/11/2026 | Sistema imune | Debona').erro, /nao apareceu/);
  assert.match(presencaDaAula(null, 'x').erro, /sem resultado/);
  assert.match(presencaDaAula({ ...saida, dryRun: true }, 'x').erro, /simulacao/);
});

const AULA_PZ = '[Ao vivo] 16/11/2026 | Planejamento Sucessorio | Melina';
test('presencaDaAula: erro do robo na aula, professor nao achado e gravacao falha viram erro', async () => {
  const { presencaDaAula } = await import('../src/trocaGravacao.js');
  const ok = { data: '16/11/2026', dryRun: false, relatorio: [{ aula: AULA_PZ, base: '120 min (professor)', revisar: [] }], aGravar: [{ aula: AULA_PZ, resultado: 'presença dada' }] };
  assert.deepEqual(presencaDaAula(ok, AULA_PZ, '2026-11-16'), { revisar: [] });
  assert.match(presencaDaAula({ ...ok, relatorio: [{ aula: AULA_PZ, erro: 'Zoom 500' }] }, AULA_PZ, '2026-11-16').erro, /Zoom 500/);
  assert.match(presencaDaAula({ ...ok, relatorio: [{ aula: AULA_PZ, base: '90 min (PROFESSOR NÃO ACHADO)', revisar: [] }] }, AULA_PZ, '2026-11-16').erro, /professor/i);
  assert.match(presencaDaAula({ ...ok, aGravar: [{ aula: AULA_PZ, resultado: 'ERRO 500' }, { aula: AULA_PZ, resultado: 'pulado (limite)' }] }, AULA_PZ, '2026-11-16').erro, /2 gravac/);
  assert.match(presencaDaAula({ ...ok, data: '15/11/2026' }, AULA_PZ, '2026-11-16').erro, /outra data/);
});

test('podeAssumirTrava: so assume se o dono morreu (ou passou de 8 h) ou a trava esta corrompida', async () => {
  const { podeAssumirTrava } = await import('../src/trocaGravacao.js');
  const agora = Date.parse('2026-11-18T16:00:00Z');
  const vivo = (pid) => pid === 111;
  const t = (pid, horas) => JSON.stringify({ pid, inicio: agora - horas * 3600000 });
  assert.equal(podeAssumirTrava(null, { pid: 222, agora, vivo }), true);
  assert.equal(podeAssumirTrava('{lixo', { pid: 222, agora, vivo }), true);
  assert.equal(podeAssumirTrava(t(111, 3), { pid: 222, agora, vivo }), false); // 13h ainda rodando as 16h
  assert.equal(podeAssumirTrava(t(333, 3), { pid: 222, agora, vivo }), true); // dono morreu
  assert.equal(podeAssumirTrava(t(111, 9), { pid: 222, agora, vivo }), true); // orfa demais (pid reaproveitado)
});

test('eventoDaAula: com aulas de mesmo nome no dia, casa pela sigla e exige uma so', () => {
  const eventos = [
    { id: 'recGPA', data: '2026-11-16', aula: 'Gestao de Riscos', siglas: ['GPA'] },
    { id: 'recPCA', data: '2026-11-16', aula: 'Gestao de Riscos', siglas: ['PCA'] },
    { id: 'recPFS', data: '2026-11-17', aula: 'Dinamica do Calcio', siglas: ['PFS', 'PSS'] },
  ];
  assert.equal(eventoDaAula(eventos, '2026-11-16', 'GPA | Gestao de Riscos | Fulano').id, 'recGPA');
  assert.equal(eventoDaAula(eventos, '2026-11-16', 'VNA | Gestao de Riscos | Fulano'), null);
  assert.equal(eventoDaAula(eventos, '2026-11-17', 'PFS | Dinamica do Calcio | Pavinato').id, 'recPFS');
  assert.equal(eventoDaAula([...eventos, { ...eventos[0], id: 'recGPA2' }], '2026-11-16', 'GPA | Gestao de Riscos | Fulano'), null);
});

test('mensagemTeams: aula concluida com link de admin e problemas novos; nada novo = null', async () => {
  const { mensagemTeams } = await import('../src/trocaGravacao.js');
  const base = 'https://plataforma.agroadvance.com.br';
  const c = { titulo: 'GPA | Planejamento Sucessorio | Melina', dataIso: '2026-11-16', turmas: 4, csat: 'link', pdfs: 1, veredito: { seguro: true, motivos: [] }, slugAdmin: 'mba-gestao-propriedade-agricolas-7' };
  const m = mensagemTeams({ concluidas: [c], problemas: ['PFS | X: sem link de CSAT no Agrotable'], baseUrl: base });
  assert.match(m, /GPA \| Planejamento Sucessorio/);
  assert.match(m, /16\/nov\/2026/);
  assert.match(m, /href="https:\/\/plataforma\.agroadvance\.com\.br\/author\/course\?courseid=mba-gestao-propriedade-agricolas-7&tab=contents"/);
  assert.match(m, /apagar o Zoom/i);
  assert.match(m, /Precisa de voc/);
  assert.match(m, /<br>/);
  const semPresenca = mensagemTeams({ concluidas: [{ ...c, veredito: null, csat: 'compartilhada', pdfs: 0 }], problemas: [], baseUrl: base });
  assert.match(semPresenca, /sem CSAT/);
  assert.match(semPresenca, /presen.a ainda n.o conferida/i);
  assert.equal(mensagemTeams({ concluidas: [], problemas: [], baseUrl: base }), null);
});

test('mensagemTeams: aula sem Zoom (VMIX) nao fala em apagar Zoom', async () => {
  const { mensagemTeams } = await import('../src/trocaGravacao.js');
  const m = mensagemTeams({ concluidas: [{ titulo: 'LGE, GTC, MEA | Segmentacao | Adelino', dataIso: '2026-11-16', turmas: 12, csat: 'compartilhada', pdfs: 1, veredito: { seguro: true, motivos: [], semZoom: true }, slugAdmin: 'mba-x-11' }], problemas: [], baseUrl: 'https://x' });
  assert.match(m, /sem atividade Zoom/i);
  assert.doesNotMatch(m, /apagar o Zoom manualmente/);
});

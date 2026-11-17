import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataDoNome, dataBr, lerCaminho, classificarArquivo, cabecaDoEvento, pastaCasaComEvento, montarPlano, nomeDaAula, escolherAtividades } from '../src/materiaisAula.js';

test('nomeDaAula iguala titulo do Teamup e da LW', () => {
  assert.equal(nomeDaAula('PFV | Sistema imune | Daniel Debona'), nomeDaAula('[Ao vivo] 17/11/2026 | Sistema imune | Daniel Debona'));
  assert.equal(nomeDaAula('GPA | Planejamento Sucessório e Continuidade | Melina'), nomeDaAula('[Ao vivo] 16/11/2026 | Planejamento Sucessório e Continuidade| Melina'));
});

test('escolherAtividades: depois da troca, vai na gravacao nova e ignora o Zoom', () => {
  const units = new Map([
    ['zoom1', { titulo: '[Ao vivo] 16/11/2026 | Planejamento Sucessorio | Melina', tipo: 'zoomMeeting', anexos: ['a.pdf'] }],
    ['grav1', { titulo: '[Ao vivo] 16/11/2026 | Planejamento Sucessorio | Melina', tipo: 'embed', anexos: [] }],
    ['outra', { titulo: '[Ao vivo] 23/11/2026 | Governanca | Ronaldo', tipo: 'embed', anexos: [] }],
  ]);
  const r = escolherAtividades(units, 'GPA | Planejamento Sucessorio | Melina', '2026-11-16', 'zoom1');
  assert.deepEqual(r.atividades.map((u) => u.id), ['grav1']);
});

test('escolherAtividades: antes da aula usa o Zoom; Zoom apagado sem gravacao = nada', () => {
  const antes = new Map([['zoom1', { titulo: '[Ao vivo] 16/11/2026 | Planejamento Sucessorio | Melina', tipo: 'zoomMeeting', anexos: [] }]]);
  assert.deepEqual(escolherAtividades(antes, 'GPA | Planejamento Sucessorio | Melina', '2026-11-16').atividades.map((u) => u.id), ['zoom1']);
  assert.equal(escolherAtividades(new Map(), 'GPA | Planejamento Sucessorio | Melina', '2026-11-16', 'zoom1').atividades.length, 0);
});

test('dataDoNome aceita os formatos da pasta Share', () => {
  assert.equal(dataDoNome('17.11.2026'), '2026-11-17');
  assert.equal(dataDoNome('16.11.26 - Bayer HF'), '2026-11-16');
  assert.equal(dataDoNome('171126_Sistema imune.pdf'), '2026-11-17');
  assert.equal(dataDoNome('091126'), '2026-11-09');
  assert.equal(dataDoNome('11.11.26 - Competitividade.pdf'), '2026-11-11');
  assert.equal(dataDoNome('Dinamica_Bayer_Arena3_Case4.docx'), null);
  assert.equal(dataDoNome('31_IA_Setembro_2026.pdf'), null);
  assert.equal(dataDoNome('1711260_x.pdf'), null);
});

test('dataBr usa dd/mmm/aaaa', () => {
  assert.equal(dataBr('2026-11-17'), '17/nov/2026');
});

test('lerCaminho: subpasta com sufixo, PNV na raiz e arquivo solto', () => {
  const bayer = lerCaminho('B2B/Bayer/16.11.26 - Bayer HF/Case1.docx');
  assert.equal(bayer.data, '2026-11-16');
  assert.equal(bayer.sufixo, 'Bayer HF');
  assert.equal(bayer.curso, 'Bayer');
  const pnv = lerCaminho('PNV/16.11.26/161126_Cafe.pdf');
  assert.equal(pnv.grupo, null);
  assert.equal(pnv.curso, 'PNV');
  assert.equal(pnv.data, '2026-11-16');
  const solto = lerCaminho('B2C/GPA/191026_Lideranca.pdf');
  assert.equal(solto.subpasta, null);
  assert.equal(solto.data, '2026-10-19');
});

test('classificarArquivo: so PDF sobe', () => {
  assert.equal(classificarArquivo('a.pdf').sobe, true);
  assert.equal(classificarArquivo('171126_Sistema imune.pptx', ['171126_Sistema imune.pdf']).motivo, 'slides: vai o PDF');
  assert.match(classificarArquivo('x.pptx', []).motivo, /SEM PDF/);
  assert.match(classificarArquivo('Case.docx').motivo, /decidir/);
  assert.match(classificarArquivo('v.mp4').motivo, /video/);
});

test('cabecaDoEvento separa siglas da aula conjunta', () => {
  assert.deepEqual(cabecaDoEvento('LGE, GTC, MEA | Segmentacao | Adelino'), ['LGE', 'GTC', 'MEA']);
  assert.deepEqual(cabecaDoEvento('Bayer HF | Doencas | Adelino'), ['BAYER HF']);
});

test('pastaCasaComEvento usa apelidos (MBAs, PSS, Bayer Milho)', () => {
  assert.equal(pastaCasaComEvento('MBAS', 'LGE, GTC, MEA | Segmentacao'), true);
  assert.equal(pastaCasaComEvento('PSS', 'PFS | Dinamica do Calcio'), true);
  assert.equal(pastaCasaComEvento('BAYER MILHO', 'Bayer | Interpretacao'), true);
  assert.equal(pastaCasaComEvento('BAYER MILHO', 'Bayer HF | Doencas'), false);
  assert.equal(pastaCasaComEvento('BAYER HF', 'Bayer HF | Doencas'), true);
  assert.equal(pastaCasaComEvento('PFV', 'PSM | Ecofisiologia'), false);
});

test('montarPlano: casa pasta com evento e lista o que sobrou dos dois lados', () => {
  const materiais = [
    'B2C/PFV/17.11.2026/171126_Sistema imune.pdf',
    'B2C/PFV/17.11.2026/171126_Sistema imune.pptx',
    'B2B/Sanjo/18.11.26/181126_Riscos.pdf',
  ].map(lerCaminho);
  const eventos = [
    { titulo: 'PFV | Sistema imune | Debona', data: '2026-11-17', turmas: [] },
    { titulo: 'PSM | Ecofisiologia | Mazzafera', data: '2026-11-17', turmas: [] },
  ];
  const plano = montarPlano(materiais, eventos, '2026-11-17');
  assert.equal(plano.itens.length, 1);
  assert.equal(plano.itens[0].eventos.length, 1);
  assert.deepEqual(plano.itens[0].arquivos.filter((a) => a.sobe).map((a) => a.arquivo), ['171126_Sistema imune.pdf']);
  assert.deepEqual(plano.eventosSemPasta.map((e) => e.titulo), ['PSM | Ecofisiologia | Mazzafera']);
});

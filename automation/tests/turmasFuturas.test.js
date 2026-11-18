import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { turmasFuturas, semTurmasFuturas, textoPuladas, turmasQueNaoComecaram } from '../src/turmasFuturas.js';

const turmas = [
  { nome: 'PCA t7', slug: 'pos-graduacao-cana-de-acucar-7', inicio: '2026-03-02' },
  { nome: 'PCA t8', slug: 'pos-graduacao-em-cana-de-acucar-8', inicio: '2027-02-03' },
  { nome: 'GPA t12', slug: null, inicio: '2027-04-26' },
  { nome: 'X t1', slug: 'x-1', inicio: null },
  { nome: 'Hoje t1', slug: 'hoje-1', inicio: '2026-11-18' },
];

test('turmasFuturas: so slug com inicio depois de hoje', () => {
  const m = turmasFuturas(turmas, '2026-11-18');
  assert.deepEqual([...m.keys()], ['pos-graduacao-em-cana-de-acucar-8']);
  assert.deepEqual(m.get('pos-graduacao-em-cana-de-acucar-8'), { nome: 'PCA t8', inicio: '2027-02-03' });
});

test('turmasFuturas: turma que comeca hoje conta como comecada', () => {
  assert.equal(turmasFuturas(turmas, '2026-11-17').has('hoje-1'), true);
  assert.equal(turmasFuturas(turmas, '2026-11-18').has('hoje-1'), false);
});

test('semTurmasFuturas: tira a turma futura e mantem as outras', () => {
  const futuras = turmasFuturas(turmas, '2026-11-18');
  const eventos = [
    { titulo: 'PCA | Drones', turmas: [{ courseid: 'pos-graduacao-cana-de-acucar-7' }, { courseid: 'pos-graduacao-em-cana-de-acucar-8' }] },
    { titulo: 'So futura', turmas: [{ courseid: 'pos-graduacao-em-cana-de-acucar-8' }] },
    { titulo: 'Sem link', turmas: [] },
  ];
  const { eventos: ficam, pulados } = semTurmasFuturas(eventos, futuras);
  assert.deepEqual(ficam.map((e) => [e.titulo, e.turmas.map((t) => t.courseid), e.turmasPuladas || 0]), [
    ['PCA | Drones', ['pos-graduacao-cana-de-acucar-7'], 1],
    ['So futura', [], 1],
    ['Sem link', [], 0],
  ]);
  assert.equal(pulados.length, 2);
  assert.equal(eventos[0].turmas.length, 2, 'nao muda o evento original');
  assert.equal(textoPuladas(pulados), 'PCA t8 (pos-graduacao-em-cana-de-acucar-8, comeca 03/02/2027)');
});

test('turmasQueNaoComecaram: Airtable fora do ar usa a leitura salva; sem ela, nao pula nada', async () => {
  const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-')), 'c.json');
  const ok = async () => ({ ok: true, json: async () => ({ records: [{ fields: { fldmDhNzR9bi2MdNR: 'PCA t8', fld0H0VcqEjToaisK: 'cana-8', fldGIcwhiNucphzWl: '2027-02-03' } }] }) });
  const falha = async () => ({ ok: false, status: 503 });
  const sem = await turmasQueNaoComecaram({ hojeIso: '2026-11-18', fetchFn: falha, cache });
  assert.equal(sem.origem, 'nenhuma');
  assert.equal(sem.futuras.size, 0);
  const a = await turmasQueNaoComecaram({ hojeIso: '2026-11-18', fetchFn: ok, cache });
  assert.equal(a.origem, 'airtable');
  assert.equal(a.futuras.has('cana-8'), true);
  const c = await turmasQueNaoComecaram({ hojeIso: '2026-11-18', fetchFn: falha, cache });
  assert.equal(c.origem, 'cache');
  assert.equal(c.futuras.has('cana-8'), true);
  assert.match(c.erro, /503/);
});

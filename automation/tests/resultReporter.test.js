// automation/tests/resultReporter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResultLine } from '../src/resultReporter.js';

test('formata status ok sem detalhes', () => {
  assert.equal(formatResultLine('ok'), 'RESULT_JSON: {"status":"ok"}');
});

test('formata manual_review com motivo', () => {
  const line = formatResultLine('manual_review', { reason: 'nenhum evento em Op 4.0' });
  assert.equal(line, 'RESULT_JSON: {"status":"manual_review","reason":"nenhum evento em Op 4.0"}');
});

test('a linha gerada é JSON válido depois de remover o prefixo', () => {
  const line = formatResultLine('error', { message: 'algo falhou' });
  const jsonPart = line.replace('RESULT_JSON: ', '');
  const parsed = JSON.parse(jsonPart);
  assert.deepEqual(parsed, { status: 'error', message: 'algo falhou' });
});

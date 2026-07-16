import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoName } from '../src/parseVideoName.js';

test('formato com underscore e código específico', () => {
  const r = parseVideoName('GPA_01062026_MARCOS NASCIMBEM FERRAZ_GESTÃO POR INDICADORES E USO DE DADOS NO AGRO');
  assert.deepEqual(r, {
    code: 'GPA',
    date: '01062026',
    rest: 'MARCOS NASCIMBEM FERRAZ_GESTÃO POR INDICADORES E USO DE DADOS NO AGRO',
  });
});

test('formato com espaço e sufixo Ed', () => {
  const r = parseVideoName('Agro 07052026 Leonardo Godinho Case Ed');
  assert.deepEqual(r, {
    code: 'Agro',
    date: '07052026',
    rest: 'Leonardo Godinho Case Ed',
  });
});

test('código genérico MBAs (aula compartilhada)', () => {
  const r = parseVideoName('MBAs_04052026_TATIANA BATISTELA_CULTURA ORGANIZACIONAL: ALINHANDO VALORES A RESULTADOS SUSTENTÁVEIS');
  assert.equal(r.code, 'MBAs');
  assert.equal(r.date, '04052026');
});

test('nome fora do padrão retorna null', () => {
  const r = parseVideoName('gravacao_sem_padrao_nenhum.mp4');
  assert.equal(r, null);
});

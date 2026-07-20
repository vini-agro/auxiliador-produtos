import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCourseAllowed } from '../src/lwRobot.js';

test('permite courseTitleId presente na lista CSV', () => {
  assert.equal(isCourseAllowed('curso-a', 'curso-a,curso-b'), true);
});

test('permite courseTitleId com espaços em volta das vírgulas', () => {
  assert.equal(isCourseAllowed('curso-b', 'curso-a, curso-b , curso-c'), true);
});

test('recusa courseTitleId fora da lista', () => {
  assert.equal(isCourseAllowed('curso-z', 'curso-a,curso-b'), false);
});

test('recusa qualquer courseTitleId quando a allowlist está vazia ou indefinida', () => {
  assert.equal(isCourseAllowed('curso-a', ''), false);
  assert.equal(isCourseAllowed('curso-a', undefined), false);
});

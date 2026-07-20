import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProcessed } from '../src/vimeoWatcher.js';

test('retorna true quando o vídeo tem a tag automacao-ok', () => {
  const video = { tags: [{ canonical: 'automacao-ok' }] };
  assert.equal(isProcessed(video), true);
});

test('retorna false quando o vídeo tem outras tags mas não automacao-ok', () => {
  const video = { tags: [{ canonical: 'outra-tag' }] };
  assert.equal(isProcessed(video), false);
});

test('retorna false quando tags é um array vazio', () => {
  assert.equal(isProcessed({ tags: [] }), false);
});

test('retorna false quando tags está ausente', () => {
  assert.equal(isProcessed({}), false);
});

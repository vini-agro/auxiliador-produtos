import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEmbedHtml } from '../src/generateEmbedHtml.js';

test('gera o HTML substituindo os dois placeholders', () => {
  const html = generateEmbedHtml({
    vimeoEmbedUrl: 'https://vimeo.com/event/5786015/embed/067d183d30/interaction',
    csatLink: 'https://airtable.com/appdXh6tqtPxRpebn/pagbEYRl5TYR2FltN/form?prefill_EventoCursoID=recABC123',
  });
  assert.match(html, /https:\/\/vimeo\.com\/event\/5786015\/embed\/067d183d30\/interaction/);
  assert.match(html, /prefill_EventoCursoID=recABC123/);
  assert.match(html, /Avalie a aula de hoje!/);
});

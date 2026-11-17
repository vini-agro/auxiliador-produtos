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

test('com link do pesquisa mostra o botao apontando para ele', () => {
  const html = generateEmbedHtml({ vimeoEmbedUrl: 'https://player.vimeo.com/video/123', csatLink: 'https://pesquisa.agroadvance.com.br/rec1abcdef' });
  assert.match(html, /href="https:\/\/pesquisa\.agroadvance\.com\.br\/rec1abcdef"/);
  assert.match(html, /Avalie a aula de hoje/);
});

test('sem csat (aula compartilhada) so o player, sem botao', () => {
  const html = generateEmbedHtml({ vimeoEmbedUrl: 'https://player.vimeo.com/video/123', csatLink: null });
  assert.doesNotMatch(html, /Avalie/);
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /player\.vimeo\.com\/video\/123/);
  assert.match(html, /height: 720px; width: 1280px/);
});

# Vigia do Vimeo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir as CLIs Node que o workflow do n8n (`automation/n8n/vigia-vimeo.workflow.json`, já desenhado e aprovado) vai chamar: listar vídeos novos da pasta "MBA - LW" do Vimeo, marcar um vídeo como tratado, e fazer `process-video.js` emitir um resultado estruturado que o n8n consegue interpretar pra decidir o próximo passo (marcar como tratado ou avisar no Teams).

**Architecture:** Toda lógica com chance de erro sutil (paginação recursiva de pastas, filtro por tag) mora em `automation/src/vimeoWatcher.js`, testável sem bater em API real onde é lógica pura. As CLIs em `automation/scripts/` são finas: leem `.env`, chamam os módulos, imprimem o resultado. `process-video.js` ganha uma linha final `RESULT_JSON: {...}` em cada ponto de saída existente, sem remover os logs legíveis já existentes.

**Tech Stack:** Node.js (ESM, `"type": "module"`), `node:test` + `node:assert/strict`, `fetch` nativo do Node (sem dependência HTTP extra), API REST do Vimeo v3.4.

## Global Constraints

- Testes automatizados rodam via `node --test tests/*.test.js` (comando já configurado em `automation/package.json` — não usar `node --test tests/` com barra, que falha neste ambiente; ver commit `10c79e6`).
- Módulo ESM: todo arquivo novo usa `import`/`export`, nunca `require`.
- Pasta raiz do Vimeo "MBA - LW" = `/me/projects/16743590` (confirmado contra a API real em 2026-07-20).
- Listagem de conteúdo de uma pasta: `GET https://api.vimeo.com{projectUri}/items?per_page=100&page=N&fields=...` — paginado, mistura itens `type: "folder"` (`item.folder.uri`, `item.folder.name`) e `type: "video"` (`item.video`) no mesmo nível. Confirmado: `fields=type,folder.uri,folder.name,video.uri,video.name,video.player_embed_url,video.tags` funciona com notação de ponto. Confirmado: `body.paging.next` é `null` na última página, senão é o path da próxima.
- Formato de vídeo confirmado: `video.uri` (ex: `/videos/1188068233`), `video.name`, `video.player_embed_url`, `video.tags` (array, `[]` quando sem tags; cada tag tem `.canonical`).
- Tag de "já processado": `automacao-ok`. Marcar via `PUT https://api.vimeo.com{videoUri}/tags/automacao-ok` (confirmado com `OPTIONS`: o token atual tem permissão de `PUT` e `DELETE` nesse endpoint).
- Todas as chamadas à API do Vimeo usam o header `Authorization: Bearer {VIMEO_TOKEN}` (mesmo padrão já usado em `automation/scripts/test-matcher.js` e nas checagens desta sessão).
- Prefixo da linha estruturada de resultado: `RESULT_JSON: ` seguido de uma única linha de JSON válido — é o contrato que o n8n usa para decidir o próximo nó (ver `automation/n8n/vigia-vimeo.workflow.json`, nó "Parsear resultado").

---

### Task 1: `isProcessed()` — filtro de vídeo já tratado

**Files:**
- Create: `automation/src/vimeoWatcher.js`
- Test: `automation/tests/vimeoWatcher.test.js`

**Interfaces:**
- Produces: `isProcessed(video: { tags?: Array<{ canonical?: string }> }) => boolean` — usada pelas Tasks 2 e 5 (indiretamente, via `findNewVideos`).

- [ ] **Step 1: Escrever os testes que falham**

```javascript
// automation/tests/vimeoWatcher.test.js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd automation && node --test tests/vimeoWatcher.test.js`
Expected: FAIL — `Cannot find module '../src/vimeoWatcher.js'` (o arquivo ainda não existe)

- [ ] **Step 3: Criar `automation/src/vimeoWatcher.js` com a implementação mínima**

```javascript
// automation/src/vimeoWatcher.js

/**
 * @param {{ tags?: Array<{ canonical?: string }> }} video - objeto de vídeo retornado pela API do Vimeo
 * @returns {boolean}
 */
export function isProcessed(video) {
  const tags = video?.tags || [];
  return tags.some((tag) => tag.canonical === 'automacao-ok');
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd automation && node --test tests/vimeoWatcher.test.js`
Expected: `pass 4`, `fail 0`

- [ ] **Step 5: Rodar a suíte completa pra confirmar que nada quebrou**

Run: `cd automation && npm test`
Expected: todos os testes existentes (6, antes desta task) + os 4 novos = 10 passam, 0 falhas

- [ ] **Step 6: Commit**

```bash
git add automation/src/vimeoWatcher.js automation/tests/vimeoWatcher.test.js
git commit -m "feat: isProcessed() para filtrar video do Vimeo ja marcado"
```

---

### Task 2: `listFolderVideosRecursive()` e `findNewVideos()` — busca real na API do Vimeo

**Files:**
- Modify: `automation/src/vimeoWatcher.js` (adiciona ao arquivo criado na Task 1)
- Create: `automation/scripts/test-vimeo-watcher.js` (validação manual contra a API real)
- Modify: `automation/.env`
- Modify: `automation/.env.example`

**Interfaces:**
- Consumes: `isProcessed(video)` da Task 1.
- Produces:
  - `listFolderVideosRecursive({ vimeoToken: string, projectUri: string }) => Promise<Array<{ uri: string, name: string, player_embed_url: string, tags: Array<{ canonical?: string }> }>>` — usada pela Task 3.
  - `findNewVideos({ vimeoToken: string, projectUri: string }) => Promise<Array<{ name: string, embedUrl: string, videoUri: string }>>` — usada pela Task 3.

Sem teste de unidade nesta task — é código de I/O contra uma API externa real (mesmo padrão de `automation/src/airtableClient.js`, que também não tem teste de unidade, só validação manual em `automation/scripts/test-matcher.js`). A validação é o Step 4 abaixo, rodando contra o Vimeo real.

- [ ] **Step 1: Adicionar `VIMEO_MBA_LW_PROJECT_URI` ao `.env` e ao `.env.example`**

Em `automation/.env`, adicionar a linha (após `VIMEO_TOKEN=...`):

```
VIMEO_MBA_LW_PROJECT_URI=/me/projects/16743590
```

Em `automation/.env.example`, adicionar (após `VIMEO_TOKEN=`):

```
VIMEO_MBA_LW_PROJECT_URI=/me/projects/16743590
```

- [ ] **Step 2: Implementar `listFolderVideosRecursive` e `findNewVideos`**

Adicionar ao final de `automation/src/vimeoWatcher.js` (mantendo o `isProcessed` já existente no arquivo):

```javascript
const VIMEO_API_BASE = 'https://api.vimeo.com';
const ITEM_FIELDS =
  'type,folder.uri,folder.name,video.uri,video.name,video.player_embed_url,video.tags';

async function fetchItemsPage({ vimeoToken, projectUri, page }) {
  const url = `${VIMEO_API_BASE}${projectUri}/items?per_page=100&page=${page}&fields=${ITEM_FIELDS}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${vimeoToken}` } });
  if (!res.ok) {
    throw new Error(`Vimeo API retornou status ${res.status} para ${projectUri}/items (página ${page})`);
  }
  return res.json();
}

/**
 * Lista recursivamente todos os vídeos dentro de uma pasta do Vimeo,
 * descendo em qualquer subpasta encontrada (ex: uma subpasta por professor).
 * @param {{ vimeoToken: string, projectUri: string }} opts - projectUri ex: "/me/projects/16743590"
 * @returns {Promise<object[]>} lista de objetos de vídeo (formato bruto da API do Vimeo)
 */
export async function listFolderVideosRecursive({ vimeoToken, projectUri }) {
  const videos = [];
  let page = 1;
  while (true) {
    const body = await fetchItemsPage({ vimeoToken, projectUri, page });
    for (const item of body.data || []) {
      if (item.type === 'video' && item.video) {
        videos.push(item.video);
      } else if (item.type === 'folder' && item.folder) {
        const nested = await listFolderVideosRecursive({ vimeoToken, projectUri: item.folder.uri });
        videos.push(...nested);
      }
    }
    if (!body.paging || !body.paging.next) break;
    page += 1;
  }
  return videos;
}

/**
 * @param {{ vimeoToken: string, projectUri: string }} opts
 * @returns {Promise<Array<{ name: string, embedUrl: string, videoUri: string }>>}
 */
export async function findNewVideos({ vimeoToken, projectUri }) {
  const all = await listFolderVideosRecursive({ vimeoToken, projectUri });
  return all
    .filter((video) => !isProcessed(video))
    .map((video) => ({
      name: video.name,
      embedUrl: video.player_embed_url,
      videoUri: video.uri,
    }));
}
```

- [ ] **Step 3: Criar o script de validação manual**

```javascript
// automation/scripts/test-vimeo-watcher.js
import 'dotenv/config';
import { findNewVideos } from '../src/vimeoWatcher.js';

const vimeoToken = process.env.VIMEO_TOKEN;
const projectUri = process.env.VIMEO_MBA_LW_PROJECT_URI;

if (!vimeoToken || !projectUri) {
  console.error('VIMEO_TOKEN e VIMEO_MBA_LW_PROJECT_URI precisam estar definidos no .env');
  process.exit(1);
}

const videos = await findNewVideos({ vimeoToken, projectUri });
console.log(`Encontrados ${videos.length} vídeo(s) sem a tag "automacao-ok":`);
for (const v of videos) {
  console.log(`- ${v.name}\n  embed: ${v.embedUrl}\n  uri: ${v.videoUri}`);
}
```

- [ ] **Step 4: Rodar contra o Vimeo real e confirmar visualmente**

Run: `cd automation && node scripts/test-vimeo-watcher.js`
Expected: sai sem erro, imprime "Encontrados N vídeo(s)..." — como nenhum vídeo real tem a tag `automacao-ok` ainda (a automação nunca marcou nenhum até agora), N deve ser igual ao total de vídeos reais nas 113 subpastas de professor dentro de "MBA - LW". Confirme visualmente que pelo menos um vídeo conhecido aparece na lista (ex: procure por "TATIANA BATISTELA" na saída — deve aparecer, já que esse vídeo real foi usado como exemplo durante a criação do spec).

- [ ] **Step 5: Commit**

```bash
git add automation/src/vimeoWatcher.js automation/scripts/test-vimeo-watcher.js automation/.env.example
git commit -m "feat: busca recursiva de videos novos na pasta MBA - LW do Vimeo"
```

(`.env` não entra no commit — está no `.gitignore`.)

---

### Task 3: `scripts/list-new-videos.js` — CLI que o n8n chama pra listar vídeos novos

**Files:**
- Create: `automation/scripts/list-new-videos.js`

**Interfaces:**
- Consumes: `findNewVideos({ vimeoToken, projectUri })` da Task 2.

Sem teste de unidade — é uma CLI fina (parse de env + 1 chamada + print). Validada manualmente no Step 2.

- [ ] **Step 1: Implementar a CLI**

```javascript
// automation/scripts/list-new-videos.js
import 'dotenv/config';
import { findNewVideos } from '../src/vimeoWatcher.js';

const vimeoToken = process.env.VIMEO_TOKEN;
const projectUri = process.env.VIMEO_MBA_LW_PROJECT_URI;

if (!vimeoToken || !projectUri) {
  console.error('VIMEO_TOKEN e VIMEO_MBA_LW_PROJECT_URI precisam estar definidos no .env');
  process.exit(1);
}

try {
  const videos = await findNewVideos({ vimeoToken, projectUri });
  console.log(JSON.stringify(videos));
} catch (err) {
  console.error('Erro ao listar vídeos novos:', err.message);
  process.exit(1);
}
```

- [ ] **Step 2: Rodar e confirmar que a saída é JSON válido**

Run: `cd automation && node scripts/list-new-videos.js`
Expected: uma única linha de stdout contendo um array JSON válido (ex: `[{"name":"...","embedUrl":"...","videoUri":"/videos/..."}, ...]`). Confirme rodando `node scripts/list-new-videos.js | node -e "JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log('JSON válido')"` — deve imprimir `JSON válido` sem lançar erro.

- [ ] **Step 3: Commit**

```bash
git add automation/scripts/list-new-videos.js
git commit -m "feat: CLI list-new-videos.js para o n8n listar videos novos"
```

---

### Task 4: `scripts/mark-video-processed.js` — CLI que marca um vídeo como tratado

**Files:**
- Create: `automation/scripts/mark-video-processed.js`
- Create: `automation/scripts/test-mark-video-processed.js` (validação manual: marca, confirma persistência, desfaz)

**Interfaces:**
- Nenhuma dependência das tasks anteriores — chamada HTTP direta.
- Produces: CLI `node scripts/mark-video-processed.js "<videoUri>"`, usada pelo workflow do n8n (nó "Marcar vídeo como tratado").

- [ ] **Step 1: Implementar a CLI**

```javascript
// automation/scripts/mark-video-processed.js
import 'dotenv/config';

const [videoUri] = process.argv.slice(2);

if (!videoUri) {
  console.error('Uso: node mark-video-processed.js "<videoUri>" (ex: /videos/1188068233)');
  process.exit(1);
}

const vimeoToken = process.env.VIMEO_TOKEN;
const url = `https://api.vimeo.com${videoUri}/tags/automacao-ok`;

const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${vimeoToken}` },
});

if (!res.ok) {
  console.error(`Erro ao marcar vídeo ${videoUri} como processado: status ${res.status}`);
  process.exit(1);
}

console.log(`Vídeo ${videoUri} marcado como processado (tag automacao-ok).`);
```

- [ ] **Step 2: Criar o script de validação de ponta a ponta (marca, confirma, desfaz)**

Roda contra um vídeo real, mas desfaz a marcação no final — não deixa resíduo em conteúdo de produção.

```javascript
// automation/scripts/test-mark-video-processed.js
import 'dotenv/config';

const [videoUri] = process.argv.slice(2);
if (!videoUri) {
  console.error('Uso: node test-mark-video-processed.js "<videoUri>" (ex: /videos/1188068233)');
  process.exit(1);
}

const vimeoToken = process.env.VIMEO_TOKEN;
const tagUrl = `https://api.vimeo.com${videoUri}/tags/automacao-ok`;
const headers = { Authorization: `Bearer ${vimeoToken}` };

console.log('1. Marcando...');
const putRes = await fetch(tagUrl, { method: 'PUT', headers });
console.log('   PUT status:', putRes.status);

console.log('2. Confirmando persistência com uma leitura independente...');
const getRes = await fetch(`https://api.vimeo.com${videoUri}?fields=tags`, { headers });
const body = await getRes.json();
const persisted = (body.tags || []).some((t) => t.canonical === 'automacao-ok');
console.log('   Tag persistiu:', persisted);

console.log('3. Desfazendo (removendo a tag de teste, sem deixar resíduo)...');
const deleteRes = await fetch(tagUrl, { method: 'DELETE', headers });
console.log('   DELETE status:', deleteRes.status);

if (!persisted) {
  console.error('FALHA: a tag não persistiu depois do PUT.');
  process.exit(1);
}
console.log('OK: tag marcada, confirmada e removida com sucesso.');
```

- [ ] **Step 3: Rodar contra um vídeo real e confirmar**

Primeiro, ache um `videoUri` real pra testar (reaproveite a saída da Task 2, Step 4, ou rode `node scripts/test-vimeo-watcher.js` de novo e copie um `uri` da lista).

Run: `cd automation && node scripts/test-mark-video-processed.js "/videos/<id-real-encontrado>"`
Expected: `Tag persistiu: true` e `OK: tag marcada, confirmada e removida com sucesso.` — sem status de erro em nenhuma das 3 chamadas.

- [ ] **Step 4: Commit**

```bash
git add automation/scripts/mark-video-processed.js automation/scripts/test-mark-video-processed.js
git commit -m "feat: CLI mark-video-processed.js para marcar video tratado no Vimeo"
```

---

### Task 5: `RESULT_JSON` estruturado em `process-video.js`

**Files:**
- Create: `automation/src/resultReporter.js`
- Test: `automation/tests/resultReporter.test.js`
- Modify: `automation/scripts/process-video.js`

**Interfaces:**
- Produces: `formatResultLine(status: 'ok' | 'manual_review' | 'error', details?: object) => string` — retorna a linha completa (com o prefixo `RESULT_JSON: `) pronta pra passar direto pra `console.log`.
- Consumes (em `process-video.js`): nenhuma interface nova — só adiciona chamadas a `formatResultLine` nos pontos de saída já existentes (ver `automation/scripts/process-video.js` atual, com 7 pontos de saída: nome fora do padrão, 0 eventos, eventos ambíguos, evento sem Aula, Aula sem LW Unit URL, evento sem Evento×Curso, sem LINK CSAT, courseTitleId não extraído, e o resultado final de `updateEmbedUnit`).

- [ ] **Step 1: Escrever o teste que falha**

```javascript
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd automation && node --test tests/resultReporter.test.js`
Expected: FAIL — `Cannot find module '../src/resultReporter.js'`

- [ ] **Step 3: Implementar `automation/src/resultReporter.js`**

```javascript
// automation/src/resultReporter.js

/**
 * Formata a linha final de resultado estruturado que process-video.js imprime
 * em cada ponto de saída, pro n8n conseguir decidir o próximo passo do workflow
 * (ver automation/n8n/vigia-vimeo.workflow.json, nó "Parsear resultado").
 * @param {'ok' | 'manual_review' | 'error'} status
 * @param {object} [details]
 * @returns {string}
 */
export function formatResultLine(status, details = {}) {
  return `RESULT_JSON: ${JSON.stringify({ status, ...details })}`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd automation && node --test tests/resultReporter.test.js`
Expected: `pass 3`, `fail 0`

- [ ] **Step 5: Rodar a suíte completa**

Run: `cd automation && npm test`
Expected: 10 (de antes desta task) + 3 novos = 13 passam, 0 falhas

- [ ] **Step 6: Commit da Task 5, parte 1**

```bash
git add automation/src/resultReporter.js automation/tests/resultReporter.test.js
git commit -m "feat: formatResultLine() para resultado estruturado do process-video.js"
```

- [ ] **Step 7: Adicionar `RESULT_JSON` em cada ponto de saída de `process-video.js`**

Reescrever `automation/scripts/process-video.js` (conteúdo completo — o arquivo atual tem 79 linhas; esta é a versão final com o import e as 8 chamadas a `formatResultLine` adicionadas):

```javascript
// automation/scripts/process-video.js
import 'dotenv/config';
import { parseVideoName } from '../src/parseVideoName.js';
import { ddmmyyyyToIso } from '../src/formatDate.js';
import { generateEmbedHtml } from '../src/generateEmbedHtml.js';
import { findOpEventoByDate, getAulaLwUnitUrl, getLinkCsat } from '../src/airtableClient.js';
import { updateEmbedUnit } from '../src/lwRobot.js';
import { formatResultLine } from '../src/resultReporter.js';

const [videoName, vimeoEmbedUrl] = process.argv.slice(2);

if (!videoName || !vimeoEmbedUrl) {
  console.error('Uso: node process-video.js "<nome do video>" "<url de embed do vimeo>"');
  process.exit(1);
}

const parsed = parseVideoName(videoName);
if (!parsed) {
  const reason = `nome de vídeo fora do padrão esperado: ${videoName}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const iso = ddmmyyyyToIso(parsed.date);
const eventos = await findOpEventoByDate(iso);

if (eventos.length === 0) {
  const reason = `nenhum evento em "Op 4.0" pra data ${iso} (vídeo: ${videoName})`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}
if (eventos.length > 1) {
  const reason = `${eventos.length} eventos ambíguos pra data ${iso} — desambiguação por professor ainda não implementada`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const evento = eventos[0];
const aulaIds = evento.fields['Aula'] || [];
const eventoCursoIds = evento.fields['Evento × Curso (espelho)'] || [];

if (aulaIds.length === 0) {
  const reason = `evento sem Aula vinculada: ${evento.id}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const lwUnitUrl = await getAulaLwUnitUrl(aulaIds[0]);
if (!lwUnitUrl) {
  const reason = `Aula sem "LW Unit URL" cadastrado ainda: ${aulaIds[0]}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

if (eventoCursoIds.length === 0) {
  const reason = `evento sem "Evento × Curso" vinculado: ${evento.id}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const csatLink = await getLinkCsat(eventoCursoIds[0]);
if (!csatLink) {
  const reason = `sem LINK CSAT pra Evento × Curso: ${eventoCursoIds[0]}`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

const html = generateEmbedHtml({ vimeoEmbedUrl, csatLink });

const courseTitleId = lwUnitUrl.split('/courses/')[1]?.split('/')[0];
if (!courseTitleId) {
  const reason = `não foi possível extrair courseTitleId de "${lwUnitUrl}"`;
  console.log(`REVISÃO MANUAL: ${reason}`);
  console.log(formatResultLine('manual_review', { reason }));
  process.exit(0);
}

console.log('Colando embed na LW, unit URL:', lwUnitUrl);
const result = await updateEmbedUnit({
  adminUrl: process.env.LW_ADMIN_URL,
  email: process.env.LW_ADMIN_EMAIL,
  password: process.env.LW_ADMIN_PASSWORD,
  courseTitleId,
  unitName: 'Aula Teste',
  html,
});

console.log(result);
if (result.ok) {
  console.log(formatResultLine('ok'));
} else {
  console.log(formatResultLine('error', { message: result.error }));
}
```

- [ ] **Step 8: Rodar a suíte completa de novo (nada nesta CLI tem teste automatizado próprio, mas confirma que nenhum import quebrou)**

Run: `cd automation && npm test`
Expected: mesmos 13 testes, 0 falhas (process-video.js não tem teste de unidade — é integração, validada manualmente no próximo step)

- [ ] **Step 9: Validação manual — confirmar que a linha RESULT_JSON aparece nos dois caminhos**

Rode um caso que cai em revisão manual (nome de vídeo fora do padrão):

Run: `cd automation && node scripts/process-video.js "video_sem_padrao.mp4" "https://player.vimeo.com/video/123"`
Expected: última linha do stdout é `RESULT_JSON: {"status":"manual_review","reason":"nome de vídeo fora do padrão esperado: video_sem_padrao.mp4"}`

- [ ] **Step 10: Commit**

```bash
git add automation/scripts/process-video.js
git commit -m "feat: process-video.js emite RESULT_JSON estruturado em cada saida"
```

---

## Self-Review (already performed)

**Cobertura do spec:** Task 1+2 cobrem `src/vimeoWatcher.js` (isProcessed, listFolderVideosRecursive, findNewVideos). Task 3 cobre `scripts/list-new-videos.js`. Task 4 cobre `scripts/mark-video-processed.js`. Task 5 cobre o ajuste em `process-video.js`. Os 4 componentes do spec estão todos cobertos. A configuração do workflow do n8n em si e a migração de credencial da LW ficam explicitamente fora de escopo (ambas já documentadas assim no spec).

**Placeholders:** nenhum "TBD"/"endpoint equivalente" — todos os endpoints, formatos de payload e valores de config (`/me/projects/16743590`, `automacao-ok`, campos de `fields=`) foram confirmados contra a API real do Vimeo durante o brainstorm (chamadas de leitura + `OPTIONS`, sem mutação).

**Consistência de tipos:** `findNewVideos` (Task 2) retorna `{ name, embedUrl, videoUri }` — mesmo formato consumido por `list-new-videos.js` (Task 3, via `JSON.stringify` direto) e pelo nó "Parsear lista de vídeos" do workflow do n8n (que espera exatamente essas 3 chaves, ver `automation/n8n/vigia-vimeo.workflow.json`). `formatResultLine` (Task 5) usa os mesmos 3 valores de `status` (`ok`/`manual_review`/`error`) que o nó "Deu certo?" do workflow do n8n compara.

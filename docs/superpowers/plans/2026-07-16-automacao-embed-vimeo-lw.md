# Automação de embed Vimeo → LearnWorlds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validar, com scripts isolados (fora do n8n), que é possível detectar um vídeo novo no Vimeo, achar a aula certa no Airtable, montar o HTML de embed e colar automaticamente na aula "mestre" da LearnWorlds via automação de navegador.

**Arquitetura:** Node.js + Playwright (automação de navegador contra o admin da LW, já que a API pública bloqueia escrita de conteúdo embed) + API do Vimeo (leitura) + API do Airtable (leitura). Cada peça é uma função pura testável isoladamente; um script CLI liga tudo no final. A integração com n8n é um passo **fora deste plano** — só entra depois que tudo aqui estiver provado.

**Tech Stack:** Node.js (>=18, `node:test` embutido para testes — sem framework extra), Playwright (Chromium), pacote `airtable` (cliente oficial), `dotenv`.

## Global Constraints

- Credenciais reais (Airtable, Vimeo, LW admin) vivem só em `automation/.env`, nunca commitadas — `automation/.gitignore` deve conter `.env`.
- Nenhum script escreve em dados reais de produção: os testes de ponta a ponta usam o curso de teste já existente na LW (`teste-automacao-claude-apagar`) e, no Airtable, só fazem leitura (nunca escrevem/apagam registros reais).
- Toda função de parsing/geração de HTML tem teste automatizado (`node:test`) rodando sem rede. Scripts que dependem de API viva (Playwright contra a LW, leitura no Airtable/Vimeo) são scripts de validação manual, não parte da suíte automatizada.
- Cada task termina com commit.

---

### Task 1: Scaffold do projeto Node + git

**Files:**
- Create: `automation/package.json`
- Create: `automation/.gitignore`
- Create: `automation/.env.example`

**Interfaces:**
- Produces: pasta `automation/` como raiz de todo o código deste plano; convenção `automation/src/*.js` para funções puras, `automation/scripts/*.js` para scripts executáveis.

- [ ] **Step 1: Inicializar git no projeto LW (ainda não é um repositório)**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git init
git add learnworlds-api-agroadvance.md docs
git commit -m "docs: spec e plano da automação Vimeo -> LW"
```

Nota: `APIS.md` (credenciais) vive em `C:\Users\User212\Documents\Dev\APIS.md`, um nível acima da raiz deste repo — não deve ser adicionado aqui.

- [ ] **Step 2: Criar a pasta do projeto e o package.json**

```bash
mkdir -p automation/src automation/scripts automation/tests
cd automation
npm init -y
npm install playwright airtable dotenv
npx playwright install chromium
```

- [ ] **Step 3: Criar `.gitignore`**

```gitignore
node_modules/
.env
*.png
```

- [ ] **Step 4: Criar `.env.example` (template, sem valores reais)**

```
LW_ADMIN_EMAIL=
LW_ADMIN_PASSWORD=
LW_ADMIN_URL=https://plataforma.agroadvance.com.br/admin
AIRTABLE_TOKEN=
AIRTABLE_BASE_ID=appdXh6tqtPxRpebn
VIMEO_TOKEN=
```

- [ ] **Step 5: Ajustar `package.json` para módulos ES e script de teste**

Editar `automation/package.json`, adicionando:

```json
{
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add automation/package.json automation/package-lock.json automation/.gitignore automation/.env.example
git commit -m "chore: scaffold do projeto de automação (Node + Playwright)"
```

---

### Task 2: Obter e configurar credenciais reais

**Files:**
- Create: `automation/.env` (não commitado)

**Interfaces:**
- Produces: variáveis de ambiente `LW_ADMIN_EMAIL`, `LW_ADMIN_PASSWORD`, `LW_ADMIN_URL`, `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `VIMEO_TOKEN`, consumidas por todos os scripts das tasks seguintes via `import 'dotenv/config'`.

- [ ] **Step 1: Pedir ao usuário uma conta de admin dedicada à automação na LW**

Perguntar: "Existe (ou pode criar) uma conta de admin na LW dedicada só pra essa automação (não a pessoal), com email e senha? É ela que o robô vai usar pra logar." Se não houver, seguir com a conta existente documentada em `C:\Users\User212\Documents\Dev\CLAUDE.md`, mas registrar como risco (credencial pessoal usada por automação).

- [ ] **Step 2: Copiar `.env.example` para `.env` e preencher com os valores reais**

```bash
cp automation/.env.example automation/.env
```

Editar `automation/.env` preenchendo:
- `LW_ADMIN_EMAIL` / `LW_ADMIN_PASSWORD`: da conta decidida no Step 1
- `AIRTABLE_TOKEN`: copiar o valor em `C:\Users\User212\Documents\Dev\APIS.md` (seção Airtable)
- `VIMEO_TOKEN`: copiar o valor em `APIS.md` (seção Vimeo, "Personal Access Token (funcional)")

- [ ] **Step 3: Verificar que `.env` não está rastreado pelo git**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git status --porcelain automation/.env
```

Esperado: nenhuma saída (arquivo ignorado). Se aparecer, o `.gitignore` do Task 1 está errado — corrigir antes de continuar.

Este task não termina com commit (nada novo pra commitar — `.env` é ignorado de propósito).

---

### Task 3: Explorar a UI de edição de unit na LW e confirmar seletores

**Files:**
- Create: `automation/scripts/explore-unit-page.js`
- Create: `automation/SELECTORS.md`

**Interfaces:**
- Consumes: variáveis de ambiente do Task 2.
- Produces: `automation/SELECTORS.md` documentando as URLs e seletores reais confirmados por screenshot — consumido como referência pelo Task 4.

- [ ] **Step 1: Descobrir a URL de login e a URL do curso de teste no painel admin**

```bash
cd automation
node -e "console.log(process.env.LW_ADMIN_URL || 'https://plataforma.agroadvance.com.br/admin')"
```

Abrir manualmente no navegador `https://plataforma.agroadvance.com.br/admin` pra confirmar a URL exata da tela de login, e navegar até `Courses → Course Manager → TESTE AUTOMACAO CLAUDE - APAGAR` pra confirmar a URL da página de conteúdo do curso (algo como `/admin/courses/teste-automacao-claude-apagar/content` — anotar a URL real observada).

- [ ] **Step 2: Escrever o script de exploração**

```javascript
// automation/scripts/explore-unit-page.js
import 'dotenv/config';
import { chromium } from 'playwright';

const LW_ADMIN_URL = process.env.LW_ADMIN_URL;
const LW_ADMIN_EMAIL = process.env.LW_ADMIN_EMAIL;
const LW_ADMIN_PASSWORD = process.env.LW_ADMIN_PASSWORD;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(LW_ADMIN_URL);
  await page.screenshot({ path: 'automation/screenshots/01-login-page.png', fullPage: true });

  await page.getByLabel(/email/i).fill(LW_ADMIN_EMAIL);
  await page.getByLabel(/password|senha/i).fill(LW_ADMIN_PASSWORD);
  await page.getByRole('button', { name: /log ?in|entrar/i }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'automation/screenshots/02-after-login.png', fullPage: true });

  await browser.close();
}

main().catch((err) => {
  console.error('Falhou:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Rodar e inspecionar o screenshot de login**

```bash
mkdir -p automation/screenshots
node automation/scripts/explore-unit-page.js
```

Ler `automation/screenshots/01-login-page.png` (usar a ferramenta de leitura de imagem) e confirmar visualmente os textos exatos dos labels de email/senha e do botão de login. Se `getByLabel`/`getByRole` no Step 2 não encontrarem os campos (erro no console), ajustar os seletores com base no que aparece no screenshot e rodar de novo até funcionar.

- [ ] **Step 4: Confirmar login bem-sucedido**

Ler `automation/screenshots/02-after-login.png`. Esperado: não está mais na tela de login (ex: mostra o dashboard admin). Se ainda mostrar a tela de login ou uma mensagem de erro, corrigir o Step 2 (seletores ou credenciais) antes de continuar.

- [ ] **Step 5: Navegar até o unit de teste e tirar screenshot do modal de embed**

Adicionar ao final da função `main()` (antes do `await browser.close()`):

```javascript
  // Substituir pela URL real confirmada no Step 1
  await page.goto(`${LW_ADMIN_URL.replace('/admin', '')}/admin/courses/teste-automacao-claude-apagar/content`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'automation/screenshots/03-course-content.png', fullPage: true });

  await page.getByText('Aula Teste').first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'automation/screenshots/04-unit-modal.png', fullPage: true });
```

Rodar novamente:

```bash
node automation/scripts/explore-unit-page.js
```

Ler `automation/screenshots/03-course-content.png` e `04-unit-modal.png`. Ajustar a URL do Step 5 e o texto buscado em `getByText` até o modal "Update Embed learning activity" (o mesmo da captura de tela compartilhada durante o design) aparecer no screenshot 04.

- [ ] **Step 6: Documentar os seletores confirmados**

Criar `automation/SELECTORS.md` com o que foi confirmado nos steps anteriores, por exemplo:

```markdown
# Seletores confirmados — painel admin LW

- URL de login: `https://plataforma.agroadvance.com.br/admin`
- Campo email: `page.getByLabel(/email/i)`
- Campo senha: `page.getByLabel(/password|senha/i)`
- Botão login: `page.getByRole('button', { name: /log ?in|entrar/i })`
- URL de conteúdo do curso: `https://plataforma.agroadvance.com.br/admin/courses/{titleId}/content`
- Abrir unit: `page.getByText('{nome da aula}').first().click()`
- Modal de embed abre automaticamente ao clicar na aula (confirmado no screenshot 04)
```

(Preencher com os valores reais observados, não os exemplos acima — os exemplos são só o formato esperado.)

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git add automation/scripts/explore-unit-page.js automation/SELECTORS.md automation/package.json automation/package-lock.json
git commit -m "feat: script de exploração da UI admin da LW + seletores documentados"
```

---

### Task 4: Robô — preencher e salvar o embed no unit de teste

**Files:**
- Create: `automation/src/lwRobot.js`
- Create: `automation/scripts/test-lw-robot.js`

**Interfaces:**
- Consumes: seletores confirmados em `automation/SELECTORS.md` (Task 3).
- Produces: `updateEmbedUnit({ courseTitleId, unitName, html })` em `automation/src/lwRobot.js`, uma função `async` que faz login, navega, cola o HTML e salva — consumida pelo Task 9 (orquestrador).

- [ ] **Step 1: Escrever `lwRobot.js` usando os seletores confirmados**

```javascript
// automation/src/lwRobot.js
import { chromium } from 'playwright';

/**
 * Loga no admin da LW, abre o unit indicado e substitui o conteúdo de embed.
 * @param {object} opts
 * @param {string} opts.adminUrl
 * @param {string} opts.email
 * @param {string} opts.password
 * @param {string} opts.courseTitleId
 * @param {string} opts.unitName - texto visível da aula no painel (ex: "Aula Teste")
 * @param {string} opts.html - HTML final a colar no campo de embed
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function updateEmbedUnit({ adminUrl, email, password, courseTitleId, unitName, html }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    await page.goto(adminUrl);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password|senha/i).fill(password);
    await page.getByRole('button', { name: /log ?in|entrar/i }).click();
    await page.waitForLoadState('networkidle');

    const baseUrl = adminUrl.replace('/admin', '');
    await page.goto(`${baseUrl}/admin/courses/${courseTitleId}/content`);
    await page.waitForLoadState('networkidle');

    await page.getByText(unitName).first().click();
    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').last();
    await textarea.click();
    await textarea.fill('');
    await textarea.fill(html);

    await page.getByRole('button', { name: /save|salvar|update/i }).click();
    await page.waitForTimeout(1000);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: Escrever o script manual de teste**

```javascript
// automation/scripts/test-lw-robot.js
import 'dotenv/config';
import { updateEmbedUnit } from '../src/lwRobot.js';

const testHtml = `<div style="height: 60px;"></div>
<div style="text-align: center; margin-bottom: 20px;">
  <a href="https://airtable.com/appdXh6tqtPxRpebn/pagbEYRl5TYR2FltN/form?prefill_EventoCursoID=TESTE_ROBO" target="_blank" style="background-color: #007BFF; color: white; padding: 14px 28px; text-decoration: none; font-size: 18px; border-radius: 6px; display: inline-block; font-family: sans-serif;">
    ➜ Avalie a aula de hoje!
  </a>
</div>
<div style="height: 720px; width: 1280px"><iframe src="https://vimeo.com/event/5786015/embed/067d183d30/interaction" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen frameborder="0" style="width:100%;height:100%;"></iframe></div>`;

const result = await updateEmbedUnit({
  adminUrl: process.env.LW_ADMIN_URL,
  email: process.env.LW_ADMIN_EMAIL,
  password: process.env.LW_ADMIN_PASSWORD,
  courseTitleId: 'teste-automacao-claude-apagar',
  unitName: 'Aula Teste',
  html: testHtml,
});

console.log(result);
```

- [ ] **Step 3: Rodar e verificar visualmente**

```bash
cd automation
node scripts/test-lw-robot.js
```

Esperado no terminal: `{ ok: true }`. Se `ok: false`, ler `error` e ajustar `lwRobot.js` (seletor de textarea ou botão de salvar) até funcionar — usar o padrão do Task 3 (adicionar screenshots temporários pra depurar visualmente se necessário).

- [ ] **Step 4: Confirmar manualmente no navegador (fora do script) que o conteúdo foi salvo**

Abrir `https://plataforma.agroadvance.com.br/admin/courses/teste-automacao-claude-apagar/content` no navegador normal, logado como admin, abrir "Aula Teste", e confirmar visualmente que o campo de embed contém o HTML de teste (o botão azul e o player). Isso é a prova de que a Abordagem B' funciona de ponta a ponta.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git add automation/src/lwRobot.js automation/scripts/test-lw-robot.js
git commit -m "feat: robo Playwright confirmado escrevendo embed na LW"
```

---

### Task 5: Parser do nome de vídeo do Vimeo

**Files:**
- Create: `automation/src/parseVideoName.js`
- Test: `automation/tests/parseVideoName.test.js`

**Interfaces:**
- Produces: `parseVideoName(name: string): {code: string|null, date: string|null, rest: string} | null` — usado pelo Task 7 (matcher).

- [ ] **Step 1: Escrever o teste com os exemplos reais encontrados no Vimeo**

```javascript
// automation/tests/parseVideoName.test.js
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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
cd automation
npm test
```

Esperado: falha com "Cannot find module '../src/parseVideoName.js'" ou similar.

- [ ] **Step 3: Implementar `parseVideoName.js`**

```javascript
// automation/src/parseVideoName.js

/**
 * Extrai código do curso, data (DDMMYYYY) e o restante (professor+título)
 * do nome de um vídeo do Vimeo, no padrão observado na pasta "MBA - LW":
 *   {CÓDIGO}[_ ]{DDMMYYYY}[_ ]{resto}
 * @param {string} name
 * @returns {{code: string, date: string, rest: string} | null}
 */
export function parseVideoName(name) {
  const match = name.match(/^([A-Za-zÀ-ÿ]+)[_ ](\d{8})[_ ](.+)$/);
  if (!match) return null;
  const [, code, date, rest] = match;
  return { code, date, rest };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
npm test
```

Esperado: 4 testes passando.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git add automation/src/parseVideoName.js automation/tests/parseVideoName.test.js
git commit -m "feat: parser do nome de video do Vimeo com testes"
```

---

### Task 6: Converter data DDMMYYYY para formato do Airtable

**Files:**
- Create: `automation/src/formatDate.js`
- Test: `automation/tests/formatDate.test.js`

**Interfaces:**
- Produces: `ddmmyyyyToIso(date: string): string` (retorna `YYYY-MM-DD`) — usado pelo Task 7 (matcher) pra consultar o Airtable, cujo campo `Data` é do tipo `date` (ISO).

- [ ] **Step 1: Escrever o teste**

```javascript
// automation/tests/formatDate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddmmyyyyToIso } from '../src/formatDate.js';

test('converte DDMMYYYY para YYYY-MM-DD', () => {
  assert.equal(ddmmyyyyToIso('01062026'), '2026-06-01');
  assert.equal(ddmmyyyyToIso('31122025'), '2025-12-31');
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd automation
npm test
```

- [ ] **Step 3: Implementar**

```javascript
// automation/src/formatDate.js

/**
 * @param {string} ddmmyyyy - ex: "01062026"
 * @returns {string} formato ISO "YYYY-MM-DD"
 */
export function ddmmyyyyToIso(ddmmyyyy) {
  const dd = ddmmyyyy.slice(0, 2);
  const mm = ddmmyyyy.slice(2, 4);
  const yyyy = ddmmyyyy.slice(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}
```

- [ ] **Step 4: Rodar e confirmar passa**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git add automation/src/formatDate.js automation/tests/formatDate.test.js
git commit -m "feat: conversor de data DDMMYYYY para ISO com testes"
```

---

### Task 7: Gerador do HTML final de embed

**Files:**
- Create: `automation/src/generateEmbedHtml.js`
- Test: `automation/tests/generateEmbedHtml.test.js`

**Interfaces:**
- Produces: `generateEmbedHtml({ vimeoEmbedUrl, csatLink }): string` — usado pelo Task 9 (orquestrador).

- [ ] **Step 1: Escrever o teste**

```javascript
// automation/tests/generateEmbedHtml.test.js
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
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd automation
npm test
```

- [ ] **Step 3: Implementar, usando o template real já em uso**

```javascript
// automation/src/generateEmbedHtml.js

/**
 * @param {object} opts
 * @param {string} opts.vimeoEmbedUrl - URL de embed do Vimeo (iframe src)
 * @param {string} opts.csatLink - valor do campo "LINK CSAT" do Airtable
 * @returns {string} HTML final pronto para colar na LW
 */
export function generateEmbedHtml({ vimeoEmbedUrl, csatLink }) {
  return `<div style="height: 60px;"></div>
<div style="text-align: center; margin-bottom: 20px;">
  <a href="${csatLink}" target="_blank" style="background-color: #007BFF; color: white; padding: 14px 28px; text-decoration: none; font-size: 18px; border-radius: 6px; display: inline-block; font-family: sans-serif;">
    ➜ Avalie a aula de hoje!
  </a>
</div>
<div style="height: 720px; width: 1280px"><iframe src="${vimeoEmbedUrl}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen frameborder="0" style="width:100%;height:100%;"></iframe></div>`;
}
```

- [ ] **Step 4: Rodar e confirmar passa**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git add automation/src/generateEmbedHtml.js automation/tests/generateEmbedHtml.test.js
git commit -m "feat: gerador de HTML final de embed com testes"
```

---

### Task 8: Matcher do Airtable (leitura real, validação manual)

**Files:**
- Create: `automation/src/airtableClient.js`
- Create: `automation/scripts/test-matcher.js`

**Interfaces:**
- Consumes: `ddmmyyyyToIso` (Task 6).
- Produces: `findOpEventoByDate(iso: string): Promise<object[]>` e `getAulaLwUnitUrl(aulaRecordId: string): Promise<string|null>` e `getLinkCsat(eventoCursoRecordId: string): Promise<string|null>`, todas em `automation/src/airtableClient.js` — consumidas pelo Task 9.

- [ ] **Step 1: Escrever o cliente do Airtable**

```javascript
// automation/src/airtableClient.js
import Airtable from 'airtable';

function getBase() {
  return new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(process.env.AIRTABLE_BASE_ID);
}

/**
 * Busca registros de "Op 4.0 (Calendário Operacional)" numa data específica.
 * @param {string} iso - formato "YYYY-MM-DD"
 * @returns {Promise<object[]>} registros crus do Airtable (com .fields)
 */
export async function findOpEventoByDate(iso) {
  const base = getBase();
  const records = await base('Op 4.0 (Calendário Operacional)')
    .select({ filterByFormula: `{Data} = '${iso}'` })
    .all();
  return records.map((r) => ({ id: r.id, fields: r.fields }));
}

/**
 * @param {string} aulaRecordId
 * @returns {Promise<string|null>}
 */
export async function getAulaLwUnitUrl(aulaRecordId) {
  const base = getBase();
  const record = await base('Aulas').find(aulaRecordId);
  return record.fields['LW Unit URL'] || null;
}

/**
 * @param {string} eventoCursoRecordId
 * @returns {Promise<string|null>}
 */
export async function getLinkCsat(eventoCursoRecordId) {
  const base = getBase();
  const record = await base('Evento × Curso').find(eventoCursoRecordId);
  return record.fields['LINK CSAT'] || null;
}
```

- [ ] **Step 2: Escrever o script manual de validação contra dados reais**

```javascript
// automation/scripts/test-matcher.js
import 'dotenv/config';
import { findOpEventoByDate } from '../src/airtableClient.js';
import { ddmmyyyyToIso } from '../src/formatDate.js';

// Data real confirmada no vídeo "GPA_01062026_MARCOS NASCIMBEM FERRAZ_..."
const iso = ddmmyyyyToIso('01062026');
const records = await findOpEventoByDate(iso);

console.log(`Encontrados ${records.length} registro(s) em Op 4.0 pra data ${iso}:`);
for (const r of records) {
  console.log('-', r.id, '|', r.fields['Nome do Evento'], '| Professor:', r.fields['Professor']);
}
```

- [ ] **Step 3: Rodar e verificar manualmente**

```bash
cd automation
node scripts/test-matcher.js
```

Esperado: pelo menos um registro retornado, com "Professor" contendo "Marcos" ou "Ferraz" (o vídeo real que encontramos no Vimeo pra essa data). Se vier vazio, confirmar no próprio Airtable (pela interface web) se existe mesmo um evento nessa data — pode ser que o evento ainda não tenha sido cadastrado em "Op 4.0" pra esse dia específico, o que é esperado (cai na fila de revisão manual no design real).

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git add automation/src/airtableClient.js automation/scripts/test-matcher.js
git commit -m "feat: cliente Airtable para matching de eventos, validado contra dados reais"
```

---

### Task 9: Orquestrador CLI — ligar tudo, ponta a ponta

**Files:**
- Create: `automation/scripts/process-video.js`

**Interfaces:**
- Consumes: `parseVideoName` (Task 5), `ddmmyyyyToIso` (Task 6), `generateEmbedHtml` (Task 7), `findOpEventoByDate`/`getAulaLwUnitUrl`/`getLinkCsat` (Task 8), `updateEmbedUnit` (Task 4).
- Produces: script `node scripts/process-video.js "<nome do video>" "<url de embed do vimeo>"` — este é o "produto final" deste plano de validação.

- [ ] **Step 1: Escrever o orquestrador**

```javascript
// automation/scripts/process-video.js
import 'dotenv/config';
import { parseVideoName } from '../src/parseVideoName.js';
import { ddmmyyyyToIso } from '../src/formatDate.js';
import { generateEmbedHtml } from '../src/generateEmbedHtml.js';
import { findOpEventoByDate, getAulaLwUnitUrl, getLinkCsat } from '../src/airtableClient.js';
import { updateEmbedUnit } from '../src/lwRobot.js';

const [videoName, vimeoEmbedUrl] = process.argv.slice(2);

if (!videoName || !vimeoEmbedUrl) {
  console.error('Uso: node process-video.js "<nome do video>" "<url de embed do vimeo>"');
  process.exit(1);
}

const parsed = parseVideoName(videoName);
if (!parsed) {
  console.log('REVISÃO MANUAL: nome de vídeo fora do padrão esperado:', videoName);
  process.exit(0);
}

const iso = ddmmyyyyToIso(parsed.date);
const eventos = await findOpEventoByDate(iso);

if (eventos.length === 0) {
  console.log(`REVISÃO MANUAL: nenhum evento em "Op 4.0" pra data ${iso} (vídeo: ${videoName})`);
  process.exit(0);
}
if (eventos.length > 1) {
  console.log(`REVISÃO MANUAL: ${eventos.length} eventos ambíguos pra data ${iso} — desambiguação por professor ainda não implementada`);
  process.exit(0);
}

const evento = eventos[0];
const aulaIds = evento.fields['Aula'] || [];
const eventoCursoIds = evento.fields['Evento × Curso (espelho)'] || [];

if (aulaIds.length === 0) {
  console.log('REVISÃO MANUAL: evento sem Aula vinculada:', evento.id);
  process.exit(0);
}

const lwUnitUrl = await getAulaLwUnitUrl(aulaIds[0]);
if (!lwUnitUrl) {
  console.log('REVISÃO MANUAL: Aula sem "LW Unit URL" cadastrado ainda:', aulaIds[0]);
  process.exit(0);
}

if (eventoCursoIds.length === 0) {
  console.log('REVISÃO MANUAL: evento sem "Evento × Curso" vinculado:', evento.id);
  process.exit(0);
}

const csatLink = await getLinkCsat(eventoCursoIds[0]);
if (!csatLink) {
  console.log('REVISÃO MANUAL: sem LINK CSAT pra Evento × Curso:', eventoCursoIds[0]);
  process.exit(0);
}

const html = generateEmbedHtml({ vimeoEmbedUrl, csatLink });

console.log('Colando embed na LW, unit URL:', lwUnitUrl);
const result = await updateEmbedUnit({
  adminUrl: process.env.LW_ADMIN_URL,
  email: process.env.LW_ADMIN_EMAIL,
  password: process.env.LW_ADMIN_PASSWORD,
  courseTitleId: lwUnitUrl.split('/courses/')[1]?.split('/')[0],
  unitName: 'Aula Teste',
  html,
});

console.log(result);
```

Nota: a extração de `courseTitleId` a partir de `lwUnitUrl` e o `unitName` fixo (`'Aula Teste'`) são simplificações válidas só pra esta validação contra o curso de teste — numa versão de produção, `getAulaLwUnitUrl` precisaria devolver também o nome da aula, não só a URL. Isso fica registrado como próximo passo (ver seção final do plano), não resolvido aqui.

- [ ] **Step 2: Rodar contra o vídeo real de teste "Marcos Ferraz" encontrado no Vimeo**

```bash
cd automation
node scripts/process-video.js "GPA_01062026_MARCOS NASCIMBEM FERRAZ_GESTÃO POR INDICADORES E USO DE DADOS NO AGRO" "https://vimeo.com/1196395139/4df201d5c1"
```

Esperado: ou `REVISÃO MANUAL: ...` (se essa data/evento real ainda não tiver `Aula` com `LW Unit URL` cadastrado — o que é o caso hoje, já que esse campo não existe ainda) ou `{ ok: true }` se você já tiver cadastrado manualmente o campo `LW Unit URL` na Aula certa apontando pro curso de teste (`teste-automacao-claude-apagar`), como um teste ponta-a-ponta completo.

- [ ] **Step 3: Confirmar o fluxo completo pelo menos uma vez, cadastrando manualmente o campo de teste**

Se o Step 2 caiu em "REVISÃO MANUAL" por falta do campo: adicionar manualmente o campo `LW Unit URL` na tabela `Aulas` do Airtable (só o campo, tipo texto/URL) e, num registro de Aula de teste (ou o mesmo evento do Step 2), preencher com a URL do curso de teste. Rodar o Step 2 de novo e confirmar `{ ok: true }`, depois confirmar visualmente na LW (como no Task 4, Step 4) que o embed foi atualizado.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\User212\Documents\Dev\Dev - Produtos\LW"
git add automation/scripts/process-video.js
git commit -m "feat: orquestrador ponta a ponta (video Vimeo -> aula na LW), validado manualmente"
```

---

## Próximos passos (fora deste plano)

> Atualizado após a revisão final de todo o branch (2026-07-16). O robô de escrita na LW (`updateEmbedUnit`) está validado ponta a ponta contra dados reais. O caminho Airtable → matching → geração do HTML **não** foi validado com um evento real ainda (toda execução real caiu em "sem evento pra essa data" no primeiro passo) — os itens abaixo bloqueiam essa validação completa, não o merge desta fase de POC.

1. **Cadastro real do `LW Unit URL`:** adicionar esse campo em `Aulas` e popular pelo menos um registro real (isso é o Task 9/Step 3 que ficou deferido). Definir antes disso **o formato exato do campo** — hoje `process-video.js` assume uma URL contendo `/courses/{slug}/`, mas o `SELECTORS.md` confirmou que a URL real do editor é `/author/course?courseid={slug}&tab=contents` (sem `/courses/`). Como o robô só precisa do slug pra buscar o curso, o mais simples é o campo guardar direto o `courseTitleId` (slug), não uma URL completa.
2. **Identidade da aula não vem do Airtable:** hoje o robô sempre procura uma unit chamada literalmente "Aula Teste" (hardcoded em `process-video.js`) e pega a primeira em caso de duplicata (`.first()` em `lwRobot.js`). Resolver isso junto com o item 1 — `getAulaLwUnitUrl` (ou uma função irmã) devolver também o nome real da aula.
3. **Guarda de allowlist está na camada errada:** `LW_ALLOWED_COURSE_IDS` hoje só é checado em `process-video.js`, não dentro de `updateEmbedUnit` (`lwRobot.js`). Qualquer chamador futuro (novo script, integração n8n) pode ignorar essa checagem. Mover a checagem pra dentro de `updateEmbedUnit` ou um wrapper compartilhado, pra a garantia viajar junto com a escrita, não com quem a chama.
4. **Filtro de data no Airtable é frágil:** `findOpEventoByDate` usa `{Data} = '${iso}'` (comparação de string), que é conhecido por dar falso-negativo por fuso horário/formatação. Trocar por `IS_SAME({Data}, '${iso}', 'day')` e confirmar contra um registro real conhecido antes de confiar no resultado "0 registros" como significando "sem evento" (hoje não dá pra distinguir isso de "a fórmula nunca bateu").
5. **Validar o caminho de sucesso completo** (itens 1-4 resolvidos): rodar `process-video.js` contra um evento real que tenha `LW Unit URL` cadastrado e confirmar `{ok: true}` — só depois disso o pipeline Airtable→LW pode ser considerado provado, não só o robô isoladamente.
6. Desambiguação por professor quando houver múltiplos eventos na mesma data (hoje cai em revisão manual — comportamento seguro, mas nunca resolve automaticamente).
7. Mover a execução de `process-video.js` para dentro do n8n — **só depois dos itens 1-5 acima**.
8. Apagar manualmente o curso de teste `teste-automacao-claude-apagar` na LW quando a validação estiver concluída.

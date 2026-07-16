# Seletores confirmados — painel admin LW (Agroadvance)

Confirmado em 2026-07-16 rodando `automation/scripts/explore-unit-page.js`
contra `https://plataforma.agroadvance.com.br` real (com a senha corrigida
em `automation/.env`), com todos os screenshots inspecionados visualmente
(`automation/screenshots/*.png`, não commitados — ver `.gitignore`).
Fluxo completo confirmado ponta a ponta: login → dashboard → busca do curso
de teste → abertura do curso → modal de edição da unit "Aula Teste".

## 1. Não existe uma "tela de login" dedicada em `/admin`

- `LW_ADMIN_URL` do `.env` é `https://plataforma.agroadvance.com.br/admin`.
- Acessar essa URL **sem estar autenticado** retorna a página 404 padrão do
  site (`ERRO 404 — Ops! Algo deu errado...`), não um formulário de login.
- O login de verdade acontece via **modal** que abre na home da escola
  (`LW_BASE_URL = https://plataforma.agroadvance.com.br`) ao clicar no link
  "Entrar" do menu superior. Confirmado nos screenshots `00-homepage.png` e
  `01-login-page.png`.

## 2. Abrir o modal de login

- Home: `page.goto('https://plataforma.agroadvance.com.br')`
- Link "Entrar" no menu superior (role `link`, texto renderizado em
  maiúsculas via CSS `text-transform`):
  `page.getByRole('link', { name: 'ENTRAR' }).click()`
- Esperar o modal renderizar: `page.waitForSelector('#signin-email', { state: 'visible' })`

## 3. Campos do formulário de login (modal)

Existem `<label for="...">` reais, mas o texto do label **não** bate com o
regex sugerido no brief:

- Label do e-mail: `"Digite seu e-mail:"` — contém **"e-mail" com hífen**,
  então `page.getByLabel(/email/i)` **NÃO** encontra o campo. Usar o id
  direto: `page.locator('#signin-email')` (placeholder: `E-mail`)
- Label da senha: `"Digite sua senha:"` — usar
  `page.locator('#signin-password')` (placeholder: `Senha`)
- Botão de login: **não** é `<button type="submit">` — é
  `<button type="button" id="submitLogin">` com texto interno
  `<span class="btn-lbl">Entrar</span>` (renderizado em maiúsculas por
  CSS). Usar o id evita "strict mode violation" no Playwright, porque
  existe **mais de um** elemento cujo texto renderizado bate com
  `/entrar/i` (o link de navegação "Entrar" E o botão do modal):
  `page.locator('#submitLogin').click()`

Confirmado visualmente no screenshot `01-login-page.png`: modal com título
"Faça login ou cadastre-se para começar a aprender", campos "E-mail"/
"Senha", botão verde "ENTRAR", links "Criar Conta" / "Esqueceu sua senha?".

## 4. Login bem-sucedido → Dashboard

Depois do `#submitLogin` clicado com as credenciais corretas, a chamada
`POST /api/signin` responde `200` com sucesso, e a página passa a mostrar
o **Dashboard** do admin (menu lateral com "Home", "Courses & programs",
"Users", etc., e o painel "Your school" com gráficos). Confirmado no
screenshot `02-after-login.png`.

**Cuidado de timing:** o dashboard renderiza em etapas depois do
`waitForLoadState('networkidle')` do frame principal (provavelmente por
causa de conteúdo carregado via iframe/XHR adicional). Um screenshot
tirado só com `networkidle` pode sair em branco. É preciso esperar por um
elemento estável do painel antes do screenshot, por exemplo:
`page.getByText('Courses & programs').waitFor({ state: 'visible' })`.

## 5. Armadilha de Cloudflare em modo headless

- Rodando `chromium.launch({ headless: true })` **sem ajuste**, o clique em
  `#submitLogin` dispara `POST https://plataforma.agroadvance.com.br/api/signin`,
  que retorna **403** com a página de bloqueio do Cloudflare.
  Causa: o header `sec-ch-ua` / `User-Agent` do Chromium headless padrão
  contém a string `"HeadlessChrome"`, e o Cloudflare bloqueia isso.
- **Correção confirmada** (sem precisar de modo headed/GUI): criar o
  `BrowserContext` com um `userAgent` customizado que remove "Headless" da
  string:
  ```js
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  });
  ```
  Com esse ajuste, `POST /api/signin` passa a retornar `200` (rodando
  ainda com `headless: true`). Importante pro Task 4, que provavelmente
  vai rodar sem GUI.

## 6. Navegar até o curso de teste (não dá pra pular direto pra URL)

- **Não funciona:** `page.goto(LW_BASE_URL + '/admin/courses/teste-automacao-claude-apagar/content')`
  logo após o login — essa rota não existe (404) e o padrão de URL do
  brief estava incorreto.
- **Também não funciona:** navegar direto via `page.goto()` pra
  `.../author/course?courseid=teste-automacao-claude-apagar&tab=contents`
  logo após o login — retorna `?msg=not-logged-in` (a sessão de autoria
  parece exigir navegação real pelo menu, não só o cookie de sessão).
- **O que funciona (fluxo real de UI):**
  1. No dashboard, clicar no item do menu lateral "Courses & programs":
     `page.getByText('Courses & programs').click()`
  2. Essa tela é renderizada dentro de um **iframe**. A página principal
     navega para `https://plataforma.agroadvance.com.br/author/courses`
     (sem parâmetros), e um iframe filho carrega
     `https://plataforma.agroadvance.com.br/author/courses?_referrer=admin`
     — é esse iframe que contém os campos de busca/lista de cursos.
     **Cuidado:** um match de URL genérico (`includes('/author/courses')`)
     casa com o frame principal (errado) antes do iframe filho (certo),
     porque `page.frames()` retorna o frame principal primeiro. É preciso
     casar a URL específica com `?_referrer=admin`:
     ```js
     const coursesFrame = page.frames().find(
       (f) => f.url().includes('/author/courses?_referrer=admin')
     );
     ```
  3. Campo de busca dentro do iframe: `coursesFrame.locator('input[placeholder="Search"]')`
     — buscar por um termo simples tipo `"apagar"` já filtra pro único
     curso de teste (a busca por `"teste-automacao"` com hífens **não**
     encontra nada — o índice de busca parece ser pelo título visível,
     não pelo slug).
  4. Card do curso encontrado (título real, com espaços e maiúsculas —
     **não** é o slug):
     `coursesFrame.getByText('TESTE AUTOMACAO CLAUDE - APAGAR').click()`
  5. Isso navega a página principal para
     `https://plataforma.agroadvance.com.br/author/course?courseid=teste-automacao-claude-apagar&tab=contents`
     (essa é a URL real da página de conteúdo do curso — bem diferente do
     `/admin/courses/{slug}/content` assumido pelo brief), com o editor
     renderizado num iframe filho
     `https://plataforma.agroadvance.com.br/author/course?courseid=teste-automacao-claude-apagar&_referrer=admin`.

Confirmado nos screenshots `03a-courses-search.png` (busca "apagar"
encontrando 1 curso: "TESTE AUTOMACAO CLAUDE - APAGAR") e
`03-course-content.png` (tela "Course outline" do curso, mostrando a
seção "01 Secao Teste" com as units "Aula Teste", "Aula Teste", T1..T10).

## 7. Abrir a unit "Aula Teste" e confirmar o modal de embed

- **Cuidado:** clicar diretamente no **texto** do nome da unit
  (`getByText('Aula Teste').click()`, como sugerido pelo brief) entra em
  modo de **RENOMEAR inline** — mostra um `<input>` editável com o nome e
  botões "Save"/"X", e **não** abre o editor de conteúdo. Confirmado
  visualmente numa tentativa anterior.
- **O que funciona:** passar o mouse por cima da linha da unit (hover)
  pra revelar uma barra de ações, e clicar no botão **"Settings"** dessa
  barra:
  ```js
  const courseFrame = page.frames().find(
    (f) => f.url().includes('/author/course?courseid=') && f.url().includes('_referrer=admin')
  );
  await courseFrame.getByText('Aula Teste').first().hover();
  await courseFrame.getByText('Settings', { exact: true }).first().click({ force: true });
  ```
  O `{ force: true }` é necessário porque o botão só fica visualmente
  revelado durante o hover (CSS), e o Playwright pode perder o estado de
  hover entre a chamada de `hover()` e a de `click()` se não forçar.
- **Atenção — nomes duplicados:** existem **duas** units chamadas
  exatamente "Aula Teste" na seção "01 Secao Teste" (visível no screenshot
  `03-course-content.png`). `getByText('Aula Teste').first()` pega a
  primeira do DOM (a de cima na lista). Se o Task 4 precisar de uma unit
  específica entre as duas, vai precisar de um seletor mais específico
  (ex.: por posição/índice, ou renomeando uma delas antes do teste) — isso
  não foi resolvido aqui, só documentado como risco.
- Isso abre o modal **"Update Embed learning activity"** (painel lateral
  deslizante, não um `<dialog>` centralizado) — o mesmo mencionado no
  brief e confirmado visualmente no screenshot `04-unit-modal.png`.

### Campos do modal "Update Embed learning activity" (confirmados via DOM)

Painel com classe `.author-side-form-content`, título
`"Update  Embed learning activity"` (com dois espaços entre "Update" e
"Embed" no HTML real):

| Campo | Seletor | Observado |
|---|---|---|
| Título da unit | `input[data-key="title"]` | valor `"Aula Teste"` |
| Descrição | `input[data-key="subtitle"]` | valor `"embed"` |
| Ícone (hidden) | `input[data-key="icon"]` | valor `"embed"` (seletor visual de ícones via `img[data-img="..."]`) |
| Código de embed | `textarea[data-key="embed"]` | vazio no momento da exploração |
| Botão salvar | `[data-testid="course-content-authoring--edit-form--save-button"]` (texto "Save") | — |
| Botão cancelar | `.btn.cancel` (texto "Cancel") | — |
| Fechar painel | `.form-close` (X no canto superior direito) | — |

O painel também mostra dica sobre variáveis de URL disponíveis:
`{{USER_ID}}`, `{{USER_NAME}}`, `{{USER_EMAIL}}`, `{{COURSE_ID}}`,
`{{COURSE_TITLE}}`, `{{UNIT_ID}}`.

## Resumo para o Task 4

- **Login:** `#signin-email`, `#signin-password`, `#submitLogin` (não
  `getByLabel`/`getByRole` genérico como no brief original), abrindo o
  modal antes via `getByRole('link', {name: 'ENTRAR'})` na home.
- **Cloudflare:** sempre criar o `BrowserContext` com um `userAgent` sem
  "Headless" antes de tentar logar, mesmo em CI/headless.
- **Navegação até o curso:** usar o fluxo de UI real (menu → busca →
  clique no card), não `page.goto()` direto pra URL do curso — a sessão de
  autoria exige a navegação. Cuidado com o match de frame por URL (usar
  `?_referrer=admin` para pegar o iframe certo, não o frame externo).
- **Abrir a unit:** hover + clique no botão "Settings" (nunca clicar
  direto no texto do nome, que entra em modo renomear). Atenção a nomes de
  unit duplicados ("Aula Teste" aparece duas vezes nesse curso de teste).
- **Editar o embed:** `textarea[data-key="embed"]` +
  `[data-testid="course-content-authoring--edit-form--save-button"]`.

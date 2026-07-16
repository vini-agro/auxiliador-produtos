// automation/src/lwRobot.js
//
// Robô Playwright que loga no admin da LearnWorlds (escola Agroadvance),
// navega até uma unit ("aula") do tipo Embed dentro de um curso, e
// substitui o HTML do campo de embed.
//
// Os seletores/fluxo usados aqui foram confirmados contra o painel admin
// real (ver `automation/SELECTORS.md`, escrito pelo Task 3) e re-validados
// neste Task 4 rodando `automation/scripts/test-lw-robot.js` de ponta a
// ponta (escrita + persistência). Não são os seletores "adivinhados" do
// brief original — em particular:
//
// - O login é um MODAL aberto clicando em "ENTRAR" na home, não uma página
//   dedicada de login.
// - A navegação até o curso precisa ser feita via UI real (menu lateral →
//   busca → clique no card), porque a sessão de autoria não aceita
//   `page.goto()` direto pra URL do curso.
// - A listagem de cursos e o editor de conteúdo do curso são renderizados
//   dentro de <iframe>s próprios — não no `page` de nível superior.
// - Clicar no texto do nome da unit entra em modo de RENOMEAR inline; o
//   jeito certo de abrir o editor é hover na linha + clique no botão
//   "Settings" revelado pelo hover.
// - O botão de salvar do painel de embed é um <div data-testid="...">, não
//   um <button> — por isso os seletores usam `locator(...)`, que funciona
//   com qualquer tag, em vez de `getByRole('button', ...)`.
import { chromium } from 'playwright';

// Chromium headless "clássico" (headless: true sem ajuste) é bloqueado pelo
// Cloudflare da LearnWorlds com 403 em POST /api/signin, porque o header
// sec-ch-ua/User-Agent padrão contém "HeadlessChrome". Sobrescrever o
// userAgent do contexto (removendo "Headless" da string) é suficiente pra
// passar pelo Cloudflare mesmo rodando headless: true — confirmado no
// Task 3 e novamente aqui no Task 4.
const NON_HEADLESS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const SAVE_BUTTON_SELECTOR =
  '[data-testid="course-content-authoring--edit-form--save-button"]';
const EMBED_TEXTAREA_SELECTOR = 'textarea[data-key="embed"]';

function deriveBaseUrl(adminUrl) {
  return adminUrl.replace(/\/admin\/?$/, '');
}

/**
 * `page.waitForLoadState('networkidle')` pode nunca resolver nesse painel
 * (observado na prática): parece haver polling/analytics contínuo em
 * segundo plano que mantém requisições em voo mesmo depois da navegação
 * relevante já ter terminado. Usar isso como best-effort (com timeout curto
 * e sem propagar erro) evita travar o robô inteiro por 30s+ esperando um
 * estado que talvez nunca chegue — os waits explícitos em elementos
 * específicos feitos depois é que garantem que a página está de fato
 * pronta pro próximo passo.
 */
async function settleNetwork(page, timeoutMs = 8000) {
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
}

/**
 * Procura, dentro de `page.frames()`, o primeiro frame cuja URL bate com o
 * predicado — com polling e timeout, em vez de uma checagem única sem
 * null-check (risco apontado pela revisão do Task 3).
 */
async function waitForFrame(page, predicate, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let frame = null;
  do {
    frame = page.frames().find(predicate);
    if (frame) return frame;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  throw new Error(`Frame não encontrado (timeout ${timeoutMs}ms): ${description}`);
}

async function login(page, { baseUrl, email, password }) {
  await page.goto(baseUrl);
  await settleNetwork(page);

  await page.getByRole('link', { name: 'ENTRAR' }).click();
  await page.waitForSelector('#signin-email', { state: 'visible', timeout: 15000 });

  await page.locator('#signin-email').fill(email);
  await page.locator('#signin-password').fill(password);

  const signinResponsePromise = page
    .waitForResponse((resp) => resp.url().includes('/api/signin'), { timeout: 15000 })
    .catch(() => null);
  await page.locator('#submitLogin').click();
  const signinResponse = await signinResponsePromise;

  if (signinResponse) {
    const body = await signinResponse.json().catch(() => null);
    if (body && body.success === false) {
      throw new Error(`Login rejeitado pela LearnWorlds: ${JSON.stringify(body.errors || body)}`);
    }
  }

  await settleNetwork(page);
  const dashboardLoaded = await page
    .getByText('Courses & programs')
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!dashboardLoaded) {
    throw new Error(
      'Dashboard não carregou após o login (elemento "Courses & programs" não apareceu) — ' +
        'credenciais podem estar erradas ou o layout do admin mudou.'
    );
  }
}

/**
 * Navega até o curso indicado pelo slug/id via UI real (menu → busca →
 * clique no card) e deixa o `page` de nível superior na URL de conteúdo do
 * curso (`/author/course?courseid=...`).
 *
 * A busca da LearnWorlds indexa pelo TÍTULO visível do curso, não pelo
 * slug/id completo (confirmado explorando manualmente: buscar o slug
 * inteiro com hifens, ou com hifens trocados por espaço, não encontra
 * nada). Por isso tentamos cada palavra do slug isoladamente (as mais
 * longas primeiro, por serem mais específicas) até achar e abrir o card
 * certo.
 */
async function openCourse(page, courseTitleId) {
  await page.getByText('Courses & programs').click();
  await settleNetwork(page);

  let coursesFrame = await waitForFrame(
    page,
    (f) => f.url().includes('/author/courses?_referrer=admin'),
    'listagem de cursos (iframe ?_referrer=admin)'
  );

  const words = courseTitleId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const searchCandidates = [...words, courseTitleId, courseTitleId.replace(/[-_]+/g, ' ')];

  for (const term of searchCandidates) {
    const searchInput = coursesFrame.locator('input[placeholder="Search"]');
    await searchInput.fill('');
    await searchInput.fill(term);
    await page.waitForTimeout(1200);

    const noMatches = await coursesFrame
      .getByText('No matches found')
      .isVisible()
      .catch(() => false);
    if (noMatches) continue;

    const cardCount = await coursesFrame.locator('.course-box').count();
    if (cardCount === 0) continue;

    // Best effort: tenta cada card retornado por esse termo até um navegar
    // pra URL com o courseid esperado. Se o termo for ambíguo (bate em
    // vários cursos não relacionados), pode precisar de mais de uma
    // tentativa — comportamento não exercitado em produção porque o curso
    // de teste único usado neste projeto não tem esse problema.
    for (let i = 0; i < cardCount; i++) {
      await coursesFrame.locator('.course-box').nth(i).click();
      await settleNetwork(page);
      if (page.url().includes(`courseid=${courseTitleId}`)) {
        return;
      }
      await page.goBack();
      await settleNetwork(page);
      coursesFrame = await waitForFrame(
        page,
        (f) => f.url().includes('/author/courses?_referrer=admin'),
        'listagem de cursos (iframe ?_referrer=admin) após goBack'
      );
      await coursesFrame.locator('input[placeholder="Search"]').fill(term);
      await page.waitForTimeout(1200);
    }
  }

  throw new Error(
    `Curso não encontrado para courseTitleId="${courseTitleId}" — nenhum termo de busca ` +
      'derivado do id encontrou/abriu o card certo.'
  );
}

/**
 * Abre o painel "Update Embed learning activity" da unit indicada.
 *
 * ATENÇÃO — limitação conhecida (documentada, não resolvida): se existir
 * mais de uma unit com o mesmo `unitName` visível no curso, esta função
 * sempre abre a PRIMEIRA (`.first()`), na ordem em que aparecem no DOM.
 */
async function openUnitSettings(page, unitName) {
  const courseFrame = await waitForFrame(
    page,
    (f) => f.url().includes('/author/course?courseid=') && f.url().includes('_referrer=admin'),
    'editor de conteúdo do curso (iframe ?_referrer=admin)'
  );

  const unitLocator = courseFrame.getByText(unitName, { exact: true }).first();
  const unitFound = await unitLocator
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!unitFound) {
    throw new Error(`Unit "${unitName}" não encontrada na página de conteúdo do curso.`);
  }

  await unitLocator.hover();
  await page.waitForTimeout(300);

  const settingsButton = courseFrame.getByText('Settings', { exact: true }).first();
  const settingsVisible = await settingsButton
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!settingsVisible) {
    throw new Error(
      `Botão "Settings" não apareceu após hover na unit "${unitName}" — ` +
        'o layout da linha da unit pode ter mudado.'
    );
  }
  // { force: true } é necessário porque o botão só é revelado via CSS
  // durante o hover, e o Playwright pode perder esse estado entre o
  // hover() e o click() se não forçar (ver SELECTORS.md).
  await settingsButton.click({ force: true });

  const embedTextarea = courseFrame.locator(EMBED_TEXTAREA_SELECTOR);
  const panelOpened = await embedTextarea
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!panelOpened) {
    throw new Error(
      `Painel "Update Embed learning activity" não abriu para a unit "${unitName}" ` +
        `(${EMBED_TEXTAREA_SELECTOR} não encontrada) — a unit pode não ser do tipo Embed.`
    );
  }

  return { courseFrame, embedTextarea };
}

async function saveEmbed(page, courseFrame, embedTextarea, html) {
  await embedTextarea.click();
  await embedTextarea.fill('');
  await embedTextarea.fill(html);

  const saveButton = courseFrame.locator(SAVE_BUTTON_SELECTOR);
  const saveButtonCount = await saveButton.count();
  if (saveButtonCount === 0) {
    throw new Error(`Botão de salvar não encontrado (${SAVE_BUTTON_SELECTOR}).`);
  }

  const saveResponsePromise = page
    .waitForResponse(
      (resp) => resp.url().includes('/api/author/products') && resp.request().method() === 'POST',
      { timeout: 15000 }
    )
    .catch(() => null);
  await saveButton.click();
  const saveResponse = await saveResponsePromise;
  if (saveResponse && !saveResponse.ok()) {
    throw new Error(`A chamada de salvar retornou status ${saveResponse.status()}.`);
  }
  // Mesmo com a resposta confirmada, dar um respiro pro painel/DOM
  // terminar de re-renderizar antes do browser.close().
  await page.waitForTimeout(1000);
}

async function withRobotSession(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: NON_HEADLESS_UA });
    const page = await context.newPage();
    try {
      return await fn(page);
    } catch (err) {
      if (process.env.LW_ROBOT_DEBUG) {
        await page
          .screenshot({ path: `screenshots/_debug-failure-${Date.now()}.png`, fullPage: true })
          .catch(() => {});
        console.error('[lwRobot debug] URL no momento da falha:', page.url());
      }
      throw err;
    }
  } finally {
    await browser.close();
  }
}

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
  try {
    const baseUrl = deriveBaseUrl(adminUrl);
    await withRobotSession(async (page) => {
      await login(page, { baseUrl, email, password });
      await openCourse(page, courseTitleId);
      const { courseFrame, embedTextarea } = await openUnitSettings(page, unitName);
      await saveEmbed(page, courseFrame, embedTextarea, html);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Lê o valor atual do campo de embed de uma unit, usando uma sessão de
 * browser totalmente nova (login + navegação do zero). Não faz parte da
 * interface consumida pelo Task 9 — existe pra permitir verificar
 * persistência de forma independente da sessão que fez a escrita (ver
 * `automation/scripts/test-lw-robot.js`).
 * @param {object} opts
 * @param {string} opts.adminUrl
 * @param {string} opts.email
 * @param {string} opts.password
 * @param {string} opts.courseTitleId
 * @param {string} opts.unitName
 * @returns {Promise<{ok: boolean, html?: string, error?: string}>}
 */
export async function readEmbedUnit({ adminUrl, email, password, courseTitleId, unitName }) {
  try {
    const baseUrl = deriveBaseUrl(adminUrl);
    const html = await withRobotSession(async (page) => {
      await login(page, { baseUrl, email, password });
      await openCourse(page, courseTitleId);
      const { embedTextarea } = await openUnitSettings(page, unitName);
      return embedTextarea.inputValue();
    });
    return { ok: true, html };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

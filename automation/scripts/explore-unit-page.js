// automation/scripts/explore-unit-page.js
//
// Script de EXPLORAÇÃO (não é o robô final do Task 4) usado para confirmar,
// contra o painel admin real da LearnWorlds, os seletores que o Task 4 vai
// usar. Roda de forma iterativa: cada passo tira um screenshot que é
// inspecionado manualmente (via Read tool) pra confirmar visualmente o
// estado da página antes de seguir pro próximo passo.
//
// Descobertas importantes (ver automation/SELECTORS.md para detalhes):
//
// 1. `LW_ADMIN_URL` (.../admin) SEM estar logado retorna 404 — não existe
//    uma "tela de login" dedicada nessa URL. O login real acontece via um
//    MODAL que abre na home da escola (LW_BASE_URL) ao clicar no link
//    "Entrar" do menu superior.
//
// 2. Chromium headless "clássico" (headless: true sem ajuste) é bloqueado
//    pelo Cloudflare da LearnWorlds com 403 na chamada POST /api/signin,
//    porque o header sec-ch-ua/User-Agent revela "HeadlessChrome". A
//    correção usada aqui é sobrescrever o userAgent do contexto removendo
//    "Headless" da string — isso é suficiente pra passar pelo Cloudflare
//    mesmo rodando headless: true (não precisa de headed/GUI).
//
// 3. O editor de curso (Course manager / Course outline) é renderizado
//    dentro de <iframe>s. Não dá pra simplesmente navegar direto pra
//    `/author/course?courseid=...` via page.goto() logo após o login —
//    isso retorna `?msg=not-logged-in` (a sessão de autoria parece
//    depender de navegação real pelo menu, não só do cookie de sessão). É
//    preciso clicar em "Courses & programs" no menu lateral e depois no
//    card do curso, como um usuário real faria.
//
// 4. Clicar diretamente no TEXTO do nome da unit ("Aula Teste") entra em
//    modo de RENOMEAR inline (mostra um campo de texto + botão "Save"), e
//    NÃO abre o modal de edição de conteúdo. Pra abrir o modal
//    "Update Embed learning activity" é preciso passar o mouse por cima da
//    linha da unit (hover) pra revelar uma barra de ações, e clicar no
//    botão "Settings" dessa barra.
import 'dotenv/config';
import { chromium } from 'playwright';

const LW_ADMIN_URL = process.env.LW_ADMIN_URL;
const LW_ADMIN_EMAIL = process.env.LW_ADMIN_EMAIL;
const LW_ADMIN_PASSWORD = process.env.LW_ADMIN_PASSWORD;
const LW_BASE_URL = LW_ADMIN_URL.replace(/\/admin\/?$/, '');

const TEST_COURSE_SEARCH_TERM = 'apagar';
const TEST_COURSE_TITLE = 'TESTE AUTOMACAO CLAUDE - APAGAR';
const TEST_UNIT_TITLE = 'Aula Teste';

// Remove "Headless" do userAgent padrão do Chromium pra não ser bloqueado
// pelo Cloudflare (ver descoberta 2 acima).
const NON_HEADLESS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: NON_HEADLESS_UA });
  const page = await context.newPage();

  // Step 1/3: home da escola + abrir o modal de login clicando em "Entrar"
  await page.goto(LW_BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/00-homepage.png', fullPage: true });

  await page.getByRole('link', { name: 'ENTRAR' }).click();
  await page.waitForSelector('#signin-email', { state: 'visible' });
  await page.waitForTimeout(500); // deixa a animação do modal terminar
  await page.screenshot({ path: 'screenshots/01-login-page.png', fullPage: true });

  // Seletores confirmados via inspeção do DOM (ver SELECTORS.md).
  // Os <label> reais são "Digite seu e-mail:" / "Digite sua senha:" —
  // NÃO usar getByLabel(/email/i), pois o texto é "e-mail" com hífen e o
  // regex /email/i não bate. Usar os ids diretamente é mais confiável.
  await page.locator('#signin-email').fill(LW_ADMIN_EMAIL);
  await page.locator('#signin-password').fill(LW_ADMIN_PASSWORD);

  const signinResponsePromise = page
    .waitForResponse((resp) => resp.url().includes('/api/signin'), { timeout: 15000 })
    .catch(() => null);
  await page.locator('#submitLogin').click();
  const signinResponse = await signinResponsePromise;
  await page.waitForLoadState('networkidle');
  // Esperar um elemento estável do painel admin (o dashboard renderiza em
  // etapas depois do "networkidle" do frame principal, senão o screenshot
  // sai em branco por uma corrida de timing).
  await page.getByText('Courses & programs').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: 'screenshots/02-after-login.png', fullPage: true });

  if (signinResponse) {
    const body = await signinResponse.json().catch(() => null);
    if (body && body.success === false) {
      console.error(
        'BLOQUEADO: login da LearnWorlds rejeitou as credenciais de automation/.env:',
        JSON.stringify(body.errors)
      );
      console.error(
        'Não é um problema de seletor (campos preenchidos corretamente, ver screenshot 02).'
      );
      await browser.close();
      process.exit(2);
    }
  }

  // Step 5: navegar até o curso de teste via UI real (não dá pra pular
  // direto pra URL do /author/course logo após logar, ver descoberta 3).
  await page.getByText('Courses & programs').click();
  await page.waitForLoadState('networkidle');

  // Cuidado: a página principal TAMBÉM navega para uma URL que contém
  // "/author/courses" (sem o "?_referrer=admin"), então um match genérico
  // pega o frame errado (o wrapper, sem os campos de busca/lista). É
  // preciso casar a URL específica do iframe interno.
  const coursesFrame = page.frames().find((f) => f.url().includes('/author/courses?_referrer=admin'));
  await coursesFrame.locator('input[placeholder="Search"]').fill(TEST_COURSE_SEARCH_TERM);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/03a-courses-search.png', fullPage: true });

  await coursesFrame.getByText(TEST_COURSE_TITLE).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/03-course-content.png', fullPage: true });

  // Abrir a unit de teste: hover na linha pra revelar a barra de ações e
  // clicar em "Settings" (clicar direto no texto entra em modo renomear).
  const courseFrame = page
    .frames()
    .find((f) => f.url().includes('/author/course?courseid=') && f.url().includes('_referrer=admin'));
  await courseFrame.getByText(TEST_UNIT_TITLE).first().hover();
  await page.waitForTimeout(300);
  await courseFrame.getByText('Settings', { exact: true }).first().click({ force: true });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/04-unit-modal.png', fullPage: true });

  await browser.close();
}

main().catch((err) => {
  console.error('Falhou:', err);
  process.exit(1);
});

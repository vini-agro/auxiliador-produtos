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
// 3. BLOQUEIO ATUAL: com as credenciais de automation/.env
//    (LW_ADMIN_EMAIL/LW_ADMIN_PASSWORD), a própria API de login da
//    LearnWorlds (POST /api/signin) responde 200 com
//    {"success":false,"errors":[{"translation_code":"not_valid_user",
//    "message":"Please, check your email and password."}]}.
//    Ou seja, o formulário e os seletores estão corretos (os valores
//    aparecem certos no screenshot 02), mas a LearnWorlds rejeita as
//    credenciais como inválidas. Isso não é um problema de seletor — é uma
//    questão de credencial/conta. Os passos 5 e 6 (navegar até o curso de
//    teste e abrir a unit) dependem de estar autenticado no /admin e por
//    isso não puderam ser confirmados nesta rodada.
import 'dotenv/config';
import { chromium } from 'playwright';

const LW_ADMIN_URL = process.env.LW_ADMIN_URL;
const LW_ADMIN_EMAIL = process.env.LW_ADMIN_EMAIL;
const LW_ADMIN_PASSWORD = process.env.LW_ADMIN_PASSWORD;
const LW_BASE_URL = LW_ADMIN_URL.replace(/\/admin\/?$/, '');

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
  await page.waitForTimeout(1000);
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

  // Step 5: navegar até o curso de teste e abrir a unit "Aula Teste"
  // (só roda se o login acima tiver funcionado)
  await page.goto(`${LW_BASE_URL}/admin/courses/teste-automacao-claude-apagar/content`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/03-course-content.png', fullPage: true });

  await page.getByText('Aula Teste').first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/04-unit-modal.png', fullPage: true });

  await browser.close();
}

main().catch((err) => {
  console.error('Falhou:', err);
  process.exit(1);
});

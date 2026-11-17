// Preenche o codigo de uma atividade Embed que JA EXISTE (vazia) num curso LW e confirma o dialogo de sync.
// Uso: node scripts/claude-embed-preencher.mjs <slug> "<titulo exato>" <arquivoHtml> <pastaPrints>
// SALVAR=1 salva (sem ele so abre, mostra o valor atual e preenche). Aborta se a Embed ja tiver conteudo (FORCAR=1 ignora).
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
const [, , SLUG, TITULO, ARQ, OUT] = process.argv;
const HTML = fs.readFileSync(ARQ, 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const baseUrl = process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '');
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1000 } })).newPage();
await page.route('**/*getbeamer.com/**', (r) => r.abort());
try {
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.getByRole('link', { name: 'ENTRAR' }).first().click();
  await page.locator('#signin-email').fill(process.env.LW_ADMIN_EMAIL);
  await page.locator('#signin-password').fill(process.env.LW_ADMIN_PASSWORD);
  await page.locator('#submitLogin').click();
  await page.getByText('Courses & programs').waitFor({ timeout: 20000 });
  await page.goto(`${baseUrl}/author/course?courseid=${SLUG}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const fr = page.frames().find((f) => f.url().includes('/author/course?courseid=') && f.url().includes('_referrer=admin'));
  // UNIT_ID: Zoom e Embed da mesma aula tem o mesmo titulo (robo troca-gravacao)
  const us = process.env.UNIT_ID
    ? fr.locator(`li[id="${process.env.UNIT_ID}"]`).getByText(TITULO, { exact: true })
    : fr.getByText(TITULO, { exact: true });
  const n = await us.count();
  console.log('ocorrencias do titulo:', n);
  if (n !== 1) throw new Error('esperava 1 atividade com esse titulo, achei ' + n);
  await us.first().scrollIntoViewIfNeeded(); await us.first().hover(); await page.waitForTimeout(500);
  await us.first().locator('xpath=ancestor::*[.//*[normalize-space(text())="Settings"]][1]').getByText('Settings', { exact: true }).first().click({ force: true });
  const ta = fr.locator('textarea[data-key="embed"]');
  await ta.waitFor({ state: 'visible', timeout: 15000 });
  const atual = await ta.inputValue();
  console.log('VALOR ATUAL', JSON.stringify(atual).slice(0, 300));
  // TROCAR=1 (robo troca-gravacao): so substitui embed vazio ou com o evento ao vivo do Vimeo; nunca outra gravacao
  if (process.env.TROCAR) {
    if (/player\.vimeo\.com\/video\//.test(atual)) throw new Error('embed ja tem video gravado, nao mexo');
    if (atual.trim() && !/vimeo\.com\/event\//.test(atual)) throw new Error('embed tem outro conteudo (nao e evento ao vivo do Vimeo), nao mexo');
  } else if (atual.trim() && !process.env.FORCAR) throw new Error('embed ja tem conteudo, nao mexo');
  await ta.click(); await ta.fill(HTML); await ta.press('Tab'); await page.waitForTimeout(500);
  if (process.env.SALVAR) {
    await fr.locator('[data-testid="course-content-authoring--edit-form--save-button"]').click();
    await page.waitForTimeout(2500);
    const sync = fr.getByText('I understand that this action will affect all synchronized peers');
    if (await sync.isVisible().catch(() => false)) {
      await sync.click({ force: true }); await page.waitForTimeout(400);
      const modal = sync.locator('xpath=ancestor::*[.//*[normalize-space(text())="Save"]][1]');
      await modal.getByText('Save', { exact: true }).first().click();
      console.log('SYNC confirmado');
    } else console.log('sem dialogo de sync');
    await page.waitForTimeout(6000);
    await page.screenshot({ path: OUT + '/e-salvo.png' });
    console.log('SALVO');
  }
} catch (e) { console.error('ERRO', e.message); await page.screenshot({ path: OUT + '/e-erro.png' }).catch(() => {}); process.exitCode = 1; }
await browser.close();

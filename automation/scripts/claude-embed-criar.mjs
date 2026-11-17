// Cria uma atividade Embed NOVA no fim de uma secao e cola o HTML. Use so quando a Embed nao existe (se existe vazia: claude-embed-preencher.mjs).
// Uso: node scripts/claude-embed-criar.mjs <slug> <indiceSecao(1..)> "<titulo>" <arquivoHtml> <pastaPrints>
// SEC_TXT="[Obrigatório] ..." trava: aborta se o "Add activity" N nao for dessa secao. Sem SALVAR=1 para antes do Save & Edit (nada gravado).
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
const [, , SLUG, SEC, TITULO, ARQ, OUT] = process.argv;
const HTML = fs.readFileSync(ARQ, 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const baseUrl = process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '');
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1000 } })).newPage();
await page.route('**/*getbeamer.com/**', (r) => r.abort());
const antes = new Set();
try {
  await page.goto(baseUrl); await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.getByRole('link', { name: 'ENTRAR' }).first().click();
  await page.locator('#signin-email').fill(process.env.LW_ADMIN_EMAIL);
  await page.locator('#signin-password').fill(process.env.LW_ADMIN_PASSWORD);
  await page.locator('#submitLogin').click();
  await page.getByText('Courses & programs').waitFor({ timeout: 20000 });
  await page.goto(`${baseUrl}/author/course?courseid=${SLUG}`); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(4000);
  let fr = page.frames().find((f) => f.url().includes('/author/course?courseid=') && f.url().includes('_referrer=admin'));
  (await fr.evaluate(() => [...document.querySelectorAll('li.obj-cont')].map((l) => l.id))).forEach((i) => antes.add(i));
  async function confirmarSync(botao) {
    await page.waitForTimeout(2500);
    const sync = fr.getByText('I understand that this action will affect all synchronized peers');
    if (!(await sync.isVisible().catch(() => false))) { console.log('sem dialogo de sync (' + botao + ')'); return; }
    await sync.click({ force: true }); await page.waitForTimeout(400);
    const modal = sync.locator(`xpath=ancestor::*[.//*[normalize-space(text())="${botao}"]][1]`);
    await modal.getByText(botao, { exact: true }).first().click();
    console.log('SYNC confirmado com', botao);
  }
  const adds = fr.locator('xpath=//*[normalize-space(text())="Add activity"]');
  const vis = [];
  for (let i = 0; i < await adds.count(); i++) if (await adds.nth(i).isVisible().catch(() => false)) vis.push(adds.nth(i));
  console.log('Add activity visiveis:', vis.length);
  const alvo = vis[+SEC - 1]; if (!alvo) throw new Error('secao nao achada');
  if (!process.env.SEC_TXT) throw new Error('SEC_TXT obrigatorio');
  const tam = await Promise.all(vis.map((v) => v.evaluate((el, t) => { for (let e = el; e; e = e.parentElement) if ((e.innerText || '').includes(t)) return e.querySelectorAll('*').length; return 1e9; }, process.env.SEC_TXT)));
  console.log('SEC_TXT menor ancestral no indice', tam.indexOf(Math.min(...tam)) + 1);
  if (tam.indexOf(Math.min(...tam)) !== +SEC - 1) throw new Error('secao errada: o "Add activity" ' + SEC + ' nao e da secao ' + process.env.SEC_TXT);
  await alvo.scrollIntoViewIfNeeded(); await alvo.click(); await page.waitForTimeout(1500);
  const abas = fr.getByText('Embed', { exact: true });
  let ok = false;
  for (let i = 0; i < await abas.count(); i++) if (await abas.nth(i).isVisible().catch(() => false)) { await abas.nth(i).click(); ok = true; break; }
  if (!ok) throw new Error('aba Embed nao achada');
  await page.waitForTimeout(800);
  await fr.getByText('Add content in your course by pasting embed codes.', { exact: true }).locator('xpath=preceding::*[normalize-space(text())="Embed"][1]').click();
  await page.waitForTimeout(1500);
  const nome = fr.locator('.ProseMirror.tiptap-content:visible').first();
  await nome.click(); await page.keyboard.type(TITULO, { delay: 5 });
  await page.screenshot({ path: OUT + '/ec1-nome.png' });
  if (!process.env.SALVAR) { console.log('SEM SALVAR: parei antes do Save & Edit'); throw new Error('dry'); }
  await fr.getByText('Save & Edit', { exact: true }).first().click();
  await confirmarSync('OK');
  const ta = fr.locator('textarea[data-key="embed"]');
  await ta.waitFor({ state: 'visible', timeout: 20000 });
  await ta.click(); await ta.fill(HTML); await ta.press('Tab'); await page.waitForTimeout(500);
  await fr.locator('[data-testid="course-content-authoring--edit-form--save-button"]').click();
  await confirmarSync('Save');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: OUT + '/ec2-salvo.png' });
  await page.goto(`${baseUrl}/author/course?courseid=${SLUG}`); await page.waitForTimeout(6000);
  fr = page.frames().find((f) => f.url().includes('/author/course?courseid=') && f.url().includes('_referrer=admin'));
  const novos = (await fr.evaluate(() => [...document.querySelectorAll('li.obj-cont')].map((l) => l.id))).filter((i) => !antes.has(i));
  console.log('UNIT', novos.join(','));
} catch (e) { if (e.message !== 'dry') { console.error('ERRO', e.message); process.exitCode = 1; } await page.screenshot({ path: OUT + '/ec-erro.png' }).catch(() => {}); }
await browser.close();

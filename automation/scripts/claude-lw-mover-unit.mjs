// Arrasta uma unit (pelo id) pra logo DEPOIS de outra unit (pelo id) no editor do curso e confirma o dialogo de sync.
// Uso: node scripts/claude-lw-mover-unit.mjs <slug> <idQueMove> <idAlvo> <pastaPrints>
import 'dotenv/config';
import { chromium } from 'playwright';
const [, , SLUG, MOVE, ALVO, OUT] = process.argv;
const baseUrl = process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '');
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36', viewport: { width: 1440, height: 1000 } })).newPage();
await page.route('**/*getbeamer.com/**', (r) => r.abort());
page.on('response', (r) => { const q = r.request(); if (q.method() !== 'GET' && /\/api\//.test(r.url()) && !/acheron|signin|notifications|learner/.test(r.url())) console.log('REQ', q.method(), r.url().slice(0, 160), r.status(), (q.postData() || '').slice(0, 300)); });
try {
  await page.goto(baseUrl); await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.getByRole('link', { name: 'ENTRAR' }).first().click();
  await page.locator('#signin-email').fill(process.env.LW_ADMIN_EMAIL);
  await page.locator('#signin-password').fill(process.env.LW_ADMIN_PASSWORD);
  await page.locator('#submitLogin').click();
  await page.getByText('Courses & programs').waitFor({ timeout: 20000 });
  await page.goto(`${baseUrl}/author/course?courseid=${SLUG}`); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(4000);
  const fr = page.frames().find((f) => f.url().includes('/author/course?courseid=') && f.url().includes('_referrer=admin'));
  const mv = fr.locator(`li[id="${MOVE}"]`), alvo = fr.locator(`li[id="${ALVO}"]`);
  if (!(await mv.count()) || !(await alvo.count())) throw new Error('unit nao achada no editor');
  await alvo.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  await mv.hover(); await page.waitForTimeout(400);
  const h = await mv.locator('.js-move-handle').boundingBox();
  const a = await alvo.boundingBox();
  console.log('handle', JSON.stringify(h), 'alvo', JSON.stringify(a));
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  const yFim = a.y + a.height - 3;
  for (let i = 1; i <= 25; i++) { await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + ((yFim - h.y - h.height / 2) * i) / 25); await page.waitForTimeout(40); }
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '/mv1.png' });
  const sync = fr.getByText('I understand that this action will affect all synchronized peers');
  if (await sync.isVisible().catch(() => false)) {
    await sync.click({ force: true }); await page.waitForTimeout(400);
    const txt = await fr.locator('body').innerText();
    const botao = ['OK', 'Save', 'Confirm', 'Continue'].find((b) => new RegExp('\\n' + b + '\\n').test('\n' + txt + '\n')) || 'OK';
    const modal = sync.locator(`xpath=ancestor::*[.//*[normalize-space(text())="${botao}"]][1]`);
    await modal.getByText(botao, { exact: true }).first().click();
    console.log('SYNC confirmado com', botao);
  } else console.log('sem dialogo de sync');
  await page.waitForTimeout(5000);
  const ordem = await fr.evaluate((ids) => { const lis = [...document.querySelectorAll('li.obj-cont')].map((l) => l.id); return ids.map((i) => lis.indexOf(i)); }, [MOVE, ALVO]);
  console.log('posicoes no editor [move, alvo]', ordem);
  await page.screenshot({ path: OUT + '/mv2.png' });
} catch (e) { console.error('ERRO', e.message); await page.screenshot({ path: OUT + '/mv-erro.png' }).catch(() => {}); process.exitCode = 1; }
await browser.close();

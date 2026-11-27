import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';

const NON_HEADLESS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const adminUrl = process.env.LW_ADMIN_URL;
const email = process.env.LW_ADMIN_EMAIL;
const password = process.env.LW_ADMIN_PASSWORD;
const baseUrl = adminUrl.replace(/\/admin\/?$/, '');

const [inputFile, outputFile, COURSE_INTERNAL_ID, COURSE_TITLE_ID, SECTION_ID, UNIT_ID] = process.argv.slice(2);
if (!UNIT_ID) {
  console.error('uso: node bulk-mark-video-complete-generic.js <studentsFile> <outputFile> <courseInternalId> <courseTitleId> <sectionId> <unitId>');
  process.exit(1);
}
// Tempo assistido enviado. Precisa cobrir ~90% da duracao do video, senao a LW aceita mas nao conclui.
// Videos com mais de ~1h50 exigem TOTAL_TIME=<duracao em s> (ver unit_duration no /progress).
const TOTAL_TIME = Number(process.env.TOTAL_TIME) || 6173;
const students = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const CONCURRENCY = Number(process.env.BULK_MARK_CONCURRENCY || 3);

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runNext() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
  return results;
}

async function waitForFrame(page, predicate, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let frame = null;
  do {
    frame = page.frames().find(predicate);
    if (frame) return frame;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  throw new Error('Frame nao encontrado: ' + description);
}

function getCookieValue(cookies, name) {
  const c = cookies.find((c) => c.name === name);
  return c ? c.value : null;
}

async function loginAsAdmin(browser) {
  const context = await browser.newContext({ userAgent: NON_HEADLESS_UA });
  const page = await context.newPage();
  await page.route('**/*getbeamer.com/**', (route) => route.abort());

  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.getByRole('link', { name: 'ENTRAR' }).first().click();
  await page.waitForSelector('#signin-email', { state: 'visible', timeout: 15000 });
  await page.locator('#signin-email').fill(email);
  await page.locator('#signin-password').fill(password);
  const signinResponsePromise = page.waitForResponse((r) => r.url().includes('/api/signin'), { timeout: 15000 }).catch(() => null);
  await page.locator('#submitLogin').click();
  await signinResponsePromise;
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.getByText('Courses & programs').waitFor({ state: 'visible', timeout: 45000 });

  await page.getByText('Users', { exact: true }).click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);

  return { context, page };
}

async function markOneStudent(browser, student) {
  const { context, page } = await loginAsAdmin(browser);
  try {
    const usersFrame = await waitForFrame(page, (f) => f.url().includes('/author/users') && f.url().includes('_referrer=admin'), 'users iframe');
    const searchInput = usersFrame.locator('input[name="search"]');
    await searchInput.fill(student.email);
    await page.waitForTimeout(1500);

    // a busca acha tambem e-mails que comecam igual (aluno com conta x@gmail.com e x@gmail.com.br, mesmo nome):
    // clica no nome da linha do e-mail EXATO e confere se a conta aberta e' a do aluno
    const emailExato = usersFrame.getByText(student.email, { exact: true }).first();
    const nameLocator = (await emailExato.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false))
      ? emailExato.locator(`xpath=ancestor::*[.//*[normalize-space(text())=${JSON.stringify(student.name)}]][1]`).getByText(student.name, { exact: true }).first()
      : usersFrame.getByText(student.name, { exact: true }).first();
    const nameVisible = await nameLocator.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (!nameVisible) return { ok: false, reason: 'nome nao encontrado na busca' };

    const profResponsePromise = page.waitForResponse((r) => r.url().includes('/api/author/user/'), { timeout: 10000 }).catch(() => null);
    await nameLocator.click();
    const profResponse = await profResponsePromise;
    const contaAberta = profResponse ? (profResponse.url().match(/\/api\/author\/user\/([a-f0-9]+)/) || [])[1] : null;
    if (contaAberta && contaAberta !== student.id) return { ok: false, reason: `abriu outra conta (${contaAberta}) com o mesmo nome; nada gravado` };
    await page.waitForTimeout(1500);

    const manageVisible = await page.getByText('Manage user', { exact: true }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (!manageVisible) return { ok: false, reason: 'perfil nao abriu (Manage user nao apareceu)' };

    await page.getByText('Manage user', { exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByText('Log in as this user', { exact: true }).click();
    await page.waitForTimeout(1000);
    await page.locator('span.lw-checkbox-box').click({ force: true });
    await page.waitForTimeout(400);
    await page.getByText('Log in as this user', { exact: true }).last().click();
    await page.waitForTimeout(2500);

    if (!page.url().includes('/start')) {
      return { ok: false, reason: `nao redirecionou pra /start apos login as (url=${page.url()})` };
    }

    const cookies = await context.cookies();
    const lwTokensRaw = getCookieValue(cookies, 'lw_tokens');
    if (!lwTokensRaw) return { ok: false, reason: 'cookie lw_tokens nao encontrado apos impersonate' };
    const lwTokens = JSON.parse(decodeURIComponent(lwTokensRaw));
    const accessToken = lwTokens.access_token;

    const dataPayload = JSON.stringify({
      userId: student.id,
      context: {
        type: process.env.UNIT_TYPE || 'ivideo',
        courseId: COURSE_INTERNAL_ID,
        courseTitleId: COURSE_TITLE_ID,
        section: SECTION_ID,
        unitId: UNIT_ID,
        pathPlayerId: UNIT_ID,
      },
      totalTime: TOTAL_TIME,
      activeTime: TOTAL_TIME,
      hiddenDuration: 0,
      isInactive: false,
      completed: true,
      courseCompleted: false,
    });

    const resp = await page.request.post(`${baseUrl}/api//update-path-player-activity`, {
      multipart: { data: dataPayload, _token: accessToken },
    });
    const body = await resp.json().catch(() => null);

    if (!resp.ok() || !body || body.success !== true) {
      return { ok: false, reason: `POST falhou: status=${resp.status()} body=${JSON.stringify(body)}` };
    }
    return { ok: true };
  } finally {
    await context.close().catch(() => {});
  }
}

const results = new Array(students.length);
let completed = 0;
const browser = await chromium.launch({ headless: true });
try {
  await runPool(students, async (s) => {
    let entry;
    try {
      const r = await markOneStudent(browser, s);
      entry = { ...s, result: r };
    } catch (err) {
      entry = { ...s, result: { ok: false, reason: 'exception: ' + err.message } };
    }
    completed++;
    console.log(`[${completed}/${students.length}] ${s.name} <${s.email}> ... ${entry.result.ok ? 'OK' : `FALHOU: ${entry.result.reason}`}`);
    results[students.indexOf(s)] = entry;
    fs.writeFileSync(outputFile, JSON.stringify(results.filter(Boolean), null, 2));
    return entry;
  }, CONCURRENCY);
} finally {
  await browser.close();
  const okCount = results.filter((r) => r && r.result.ok).length;
  console.log(`\n=== RESUMO: ${okCount}/${results.length} OK (concorrência: ${CONCURRENCY}) ===`);
}

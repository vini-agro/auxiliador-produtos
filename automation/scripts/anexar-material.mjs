// Anexa um arquivo (Digital Download) numa atividade da LW pelo painel (16/nov/2026).
// uso: node scripts/anexar-material.mjs <slug> "<titulo exato da atividade>" "<arquivo>" [pastaPrints]
// Sem SALVAR=1 so' abre a atividade e mostra os anexos atuais. Nunca confirma o dialogo
// de turmas sincronizadas: se ele aparecer, para sem salvar.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { jaTemArquivo } from '../src/materiaisAula.js';

const [, , SLUG, TITULO, ARQUIVO, OUT = '.'] = process.argv;
if (!SLUG || !TITULO || !ARQUIVO) throw new Error('uso: <slug> "<titulo>" "<arquivo>" [pastaPrints]');
if (!fs.existsSync(ARQUIVO)) throw new Error('arquivo nao existe: ' + ARQUIVO);
const NOME = path.basename(ARQUIVO);
const UNIT_ID = process.env.UNIT_ID || null;
const baseUrl = process.env.LW_ADMIN_URL.replace(/\/admin\/?$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const SESSAO = path.join(process.cwd(), '.lw-session-state.json');

async function anexosAtuais(page) {
  const d = await page.evaluate(async (s) => (await fetch(`/api/course/${s}?contents&path-player`, { credentials: 'include' })).json(), SLUG);
  const achadas = [];
  for (const sec of Object.values(d.course.sections || {})) for (const u of sec.learningPath || []) {
    if ((u.unitTitle || u.title || '').trim() !== TITULO.trim()) continue;
    // UNIT_ID: Zoom e Embed da mesma aula tem o mesmo titulo (robo troca-gravacao)
    if (UNIT_ID && u.id !== UNIT_ID) continue;
    // nome repetido no storage vira "2-<nome>": conta como o mesmo arquivo
    const nomes = (u.attachments || []).map((a) => a.title);
    achadas.push({ id: u.id, tipo: u.type, anexos: [...nomes, ...nomes.map((n) => n.replace(/^\d+-/, ''))] });
  }
  return achadas;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, userAgent: UA, storageState: SESSAO });
  const page = await context.newPage();
  await page.route('**/*getbeamer.com/**', (r) => r.abort());
  await page.goto(`${baseUrl}/author/course?courseid=${SLUG}&tab=contents`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(7000);

  const antes = await anexosAtuais(page);
  console.log('ANTES:', JSON.stringify(antes));
  if (antes.length !== 1) throw new Error(`esperava 1 atividade com esse titulo, achei ${antes.length}`);
  if (jaTemArquivo(antes[0].anexos, NOME)) { console.log('JA TEM esse anexo, nada a fazer'); process.exit(0); }
  if (!process.env.SALVAR) { console.log('(sem SALVAR=1: nao subi)'); process.exit(0); }

  const fr = page.frames().find((f) => f.url().includes('/author/course?courseid=') && f.url().includes('_referrer=admin'));
  const us = UNIT_ID
    ? fr.locator(`li[id="${UNIT_ID}"]`).getByText(TITULO, { exact: true }).filter({ visible: true })
    : fr.getByText(TITULO, { exact: true }).filter({ visible: true });
  if ((await us.count()) !== 1) throw new Error('titulo visivel nao e unico no editor: ' + (await us.count()));
  await us.first().scrollIntoViewIfNeeded(); await us.first().hover(); await page.waitForTimeout(500);
  await us.first().locator('xpath=ancestor::*[.//*[normalize-space(text())="Settings"]][1]').getByText('Settings', { exact: true }).first().click({ force: true });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, `anexar-${SLUG}-0-settings.png`) });
  // Embed/video: <input id="addAttachment" type="button">. Zoom (formulario novo): <button>Add digital download</button>.
  const candidatos = [fr.locator('#addAttachment'), fr.locator('button', { hasText: 'Add digital download' }), fr.locator('input[type=button][value="Add digital download"]')];
  let botao = null;
  for (const c of candidatos) if ((await c.filter({ visible: true }).count()) === 1) { botao = c.filter({ visible: true }); break; }
  if (!botao) throw new Error('nao achei 1 botao "Add digital download" visivel');
  await botao.scrollIntoViewIfNeeded();

  const chooser = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);
  await botao.click();
  const fc = await chooser;
  if (!fc) { await page.screenshot({ path: path.join(OUT, `anexar-${SLUG}-sem-seletor.png`) }); throw new Error('o botao nao abriu seletor de arquivo (nada salvo)'); }
  // O nome aparece no formulario na hora, com barra de progresso: salvar antes do fim do
  // upload descarta o anexo (16/nov, GPA: salvou a 59% e nada gravou). Espera o PUT pro storage acabar.
  let abertos = 0, iniciados = 0, ultimoFim = Date.now();
  const ehStorage = (r) => r.url().includes('blob.core.windows.net') && r.method() === 'PUT';
  page.on('request', (r) => { if (ehStorage(r)) { abertos++; iniciados++; } });
  page.on('requestfinished', (r) => { if (ehStorage(r)) { abertos--; ultimoFim = Date.now(); } });
  page.on('requestfailed', (r) => { if (ehStorage(r)) { abertos--; console.log('FALHA no upload:', r.failure()?.errorText); } });
  await fc.setFiles(ARQUIVO);
  const limite = Date.now() + 10 * 60000;
  while (!(iniciados > 0 && abertos === 0 && Date.now() - ultimoFim > 5000)) {
    if (Date.now() > limite) throw new Error('upload nao terminou em 10 min (nada salvo)');
    await page.waitForTimeout(1000);
  }
  console.log(`upload terminou (${iniciados} PUT(s) pro storage)`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, `anexar-${SLUG}-1-upload.png`) });

  const salvar = fr.locator('[data-testid="course-content-authoring--edit-form--save-button"], [data-testid="save-button"]').filter({ visible: true });
  if ((await salvar.count()) !== 1) throw new Error('botao Save visivel nao e unico: ' + (await salvar.count()));
  await salvar.click();
  await page.waitForTimeout(3000);
  const sync = fr.getByText(/synchroni[sz]ed (peers|content)|changing synced/i).filter({ visible: true });
  if ((await sync.count()) > 0) {
    await page.screenshot({ path: path.join(OUT, `anexar-${SLUG}-SYNC.png`) });
    // so' confirma com CONFIRMAR_SYNC=1 (aprovacao explicita do usuario): a mudanca vai pra todas as turmas peer
    if (!process.env.CONFIRMAR_SYNC) throw new Error('DIALOGO DE SYNC apareceu: parei SEM confirmar (nada salvo)');
    const marcar = fr.getByText('I understand that this action will affect all synchronized peers').filter({ visible: true });
    await marcar.click({ force: true });
    await page.waitForTimeout(500);
    const modal = marcar.locator('xpath=ancestor::*[.//button[normalize-space(.)="Save"] or .//*[normalize-space(text())="Save"]][1]');
    await modal.getByText('Save', { exact: true }).filter({ visible: true }).first().click();
    console.log('SYNC confirmado');
  }
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, `anexar-${SLUG}-2-salvo.png`) });
  const depois = await anexosAtuais(page);
  console.log('DEPOIS:', JSON.stringify(depois));
  console.log(depois[0] && depois[0].anexos.includes(NOME) ? 'OK: anexo gravado' : 'ATENCAO: anexo NAO aparece depois de salvar');
} finally {
  await browser.close();
}

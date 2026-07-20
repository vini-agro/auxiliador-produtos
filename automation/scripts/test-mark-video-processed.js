// automation/scripts/test-mark-video-processed.js
import 'dotenv/config';

const [videoUri] = process.argv.slice(2);
if (!videoUri) {
  console.error('Uso: node test-mark-video-processed.js "<videoUri>" (ex: /videos/1188068233)');
  process.exit(1);
}

const vimeoToken = process.env.VIMEO_TOKEN;
const tagUrl = `https://api.vimeo.com${videoUri}/tags/automacao-ok`;
const headers = { Authorization: `Bearer ${vimeoToken}` };

console.log('1. Marcando...');
const putRes = await fetch(tagUrl, { method: 'PUT', headers });
console.log('   PUT status:', putRes.status);

console.log('2. Confirmando persistência com uma leitura independente...');
const getRes = await fetch(`https://api.vimeo.com${videoUri}?fields=tags`, { headers });
const body = await getRes.json();
const persisted = (body.tags || []).some((t) => t.canonical === 'automacao-ok');
console.log('   Tag persistiu:', persisted);

console.log('3. Desfazendo (removendo a tag de teste, sem deixar resíduo)...');
const deleteRes = await fetch(tagUrl, { method: 'DELETE', headers });
console.log('   DELETE status:', deleteRes.status);

if (!persisted) {
  console.error('FALHA: a tag não persistiu depois do PUT.');
  process.exit(1);
}
console.log('OK: tag marcada, confirmada e removida com sucesso.');

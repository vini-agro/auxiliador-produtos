// automation/scripts/mark-video-processed.js
import 'dotenv/config';

const [videoUri] = process.argv.slice(2);

if (!videoUri) {
  console.error('Uso: node mark-video-processed.js "<videoUri>" (ex: /videos/1188068233)');
  process.exit(1);
}

const vimeoToken = process.env.VIMEO_TOKEN;

if (!vimeoToken) {
  console.error('VIMEO_TOKEN precisa estar definido no .env');
  process.exit(1);
}

const url = `https://api.vimeo.com${videoUri}/tags/automacao-ok`;

try {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${vimeoToken}` },
  });

  if (!res.ok) {
    console.error(`Erro ao marcar vídeo ${videoUri} como processado: status ${res.status}`);
    process.exit(1);
  }

  console.log(`Vídeo ${videoUri} marcado como processado (tag automacao-ok).`);
} catch (err) {
  console.error(`Erro ao marcar vídeo ${videoUri} como processado:`, err.message);
  process.exit(1);
}

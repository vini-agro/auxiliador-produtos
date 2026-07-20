import 'dotenv/config';
import { findNewVideos } from '../src/vimeoWatcher.js';

const vimeoToken = process.env.VIMEO_TOKEN;
const projectUri = process.env.VIMEO_MBA_LW_PROJECT_URI;

if (!vimeoToken || !projectUri) {
  console.error('VIMEO_TOKEN e VIMEO_MBA_LW_PROJECT_URI precisam estar definidos no .env');
  process.exit(1);
}

try {
  const videos = await findNewVideos({ vimeoToken, projectUri });
  console.log(JSON.stringify(videos));
} catch (err) {
  console.error('Erro ao listar vídeos novos:', err.message);
  process.exit(1);
}

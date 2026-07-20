import 'dotenv/config';
import { findNewVideos } from '../src/vimeoWatcher.js';

const vimeoToken = process.env.VIMEO_TOKEN;
const projectUri = process.env.VIMEO_MBA_LW_PROJECT_URI;

if (!vimeoToken || !projectUri) {
  console.error('VIMEO_TOKEN e VIMEO_MBA_LW_PROJECT_URI precisam estar definidos no .env');
  process.exit(1);
}

const videos = await findNewVideos({ vimeoToken, projectUri });
console.log(`Encontrados ${videos.length} vídeo(s) sem a tag "automacao-ok":`);
for (const v of videos) {
  console.log(`- ${v.name}\n  embed: ${v.embedUrl}\n  uri: ${v.videoUri}`);
}

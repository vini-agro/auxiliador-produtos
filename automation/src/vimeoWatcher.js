/**
 * @param {{ tags?: Array<{ canonical?: string }> }} video - objeto de vídeo retornado pela API do Vimeo
 * @returns {boolean}
 */
export function isProcessed(video) {
  const tags = video?.tags || [];
  return tags.some((tag) => tag.canonical === 'automacao-ok');
}

const VIMEO_API_BASE = 'https://api.vimeo.com';
const ITEM_FIELDS =
  'type,folder.uri,folder.name,video.uri,video.name,video.player_embed_url,video.tags';

async function fetchItemsPage({ vimeoToken, projectUri, page }) {
  const url = `${VIMEO_API_BASE}${projectUri}/items?per_page=100&page=${page}&fields=${ITEM_FIELDS}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${vimeoToken}` } });
  if (!res.ok) {
    throw new Error(`Vimeo API retornou status ${res.status} para ${projectUri}/items (página ${page})`);
  }
  return res.json();
}

/**
 * Lista recursivamente todos os vídeos dentro de uma pasta do Vimeo,
 * descendo em qualquer subpasta encontrada (ex: uma subpasta por professor).
 * @param {{ vimeoToken: string, projectUri: string }} opts - projectUri ex: "/me/projects/16743590"
 * @returns {Promise<object[]>} lista de objetos de vídeo (formato bruto da API do Vimeo)
 */
export async function listFolderVideosRecursive({ vimeoToken, projectUri }) {
  const videos = [];
  let page = 1;
  while (true) {
    const body = await fetchItemsPage({ vimeoToken, projectUri, page });
    for (const item of body.data || []) {
      if (item.type === 'video' && item.video) {
        videos.push(item.video);
      } else if (item.type === 'folder' && item.folder) {
        const nested = await listFolderVideosRecursive({ vimeoToken, projectUri: item.folder.uri });
        videos.push(...nested);
      }
    }
    if (!body.paging || !body.paging.next) break;
    page += 1;
  }
  return videos;
}

/**
 * @param {{ vimeoToken: string, projectUri: string }} opts
 * @returns {Promise<Array<{ name: string, embedUrl: string, videoUri: string }>>}
 */
export async function findNewVideos({ vimeoToken, projectUri }) {
  const all = await listFolderVideosRecursive({ vimeoToken, projectUri });
  return all
    .filter((video) => !isProcessed(video))
    .map((video) => ({
      name: video.name,
      embedUrl: video.player_embed_url,
      videoUri: video.uri,
    }));
}

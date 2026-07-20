/**
 * @param {{ tags?: Array<{ canonical?: string }> }} video - objeto de vídeo retornado pela API do Vimeo
 * @returns {boolean}
 */
export function isProcessed(video) {
  const tags = video?.tags || [];
  return tags.some((tag) => tag.canonical === 'automacao-ok');
}

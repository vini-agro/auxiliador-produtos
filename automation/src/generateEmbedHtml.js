
/**
 * @param {object} opts
 * @param {string} opts.vimeoEmbedUrl - URL de embed do Vimeo (iframe src)
 * @param {string} opts.csatLink - valor do campo "LINK CSAT" do Airtable
 * @returns {string} HTML final pronto para colar na LW
 */
export function generateEmbedHtml({ vimeoEmbedUrl, csatLink }) {
  return `<div style="height: 60px;"></div>
<div style="text-align: center; margin-bottom: 20px;">
  <a href="${csatLink}" target="_blank" style="background-color: #007BFF; color: white; padding: 14px 28px; text-decoration: none; font-size: 18px; border-radius: 6px; display: inline-block; font-family: sans-serif;">
    ➜ Avalie a aula de hoje!
  </a>
</div>
<div style="height: 720px; width: 1280px"><iframe src="${vimeoEmbedUrl}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen frameborder="0" style="width:100%;height:100%;"></iframe></div>`;
}

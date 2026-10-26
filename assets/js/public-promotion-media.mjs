// One display policy for approved public promotion images; never fetch or proxy an external image.
export const IMAGE_UNAVAILABLE = '대표사진을 표시할 수 없습니다. 글 내용은 아래에서 확인해 주세요.';
const NAVER_HOTLINK_HOSTS = new Set(['blogthumb.pstatic.net', 'postfiles.pstatic.net', 'blogfiles.pstatic.net']);
export function promotionImageUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || NAVER_HOTLINK_HOSTS.has(url.hostname)) return '';
    return value;
  } catch { return ''; }
}
export function promotionMedia(item) {
  const media = Array.isArray(item?.public_media) ? item.public_media.filter(entry => /^https:\/\//.test(entry?.url || '')) : [];
  // Keep the selected first photo authoritative. Never silently replace it with another photo.
  const selected = media[0];
  const stored = String(item?.link_source_type || 'none') === 'none' && /^https:\/\//.test(item?.hero_image_url || '') ? item.hero_image_url : '';
  const candidate = selected?.url || stored;
  const heroUrl = promotionImageUrl(candidate);
  return { heroUrl, alt: selected?.alt || item?.title || '태장 소식 사진',
    unavailable: candidate && !heroUrl ? IMAGE_UNAVAILABLE : '',
    gallery: media.filter(entry => entry.url !== candidate).map(entry => ({ ...entry, displayUrl: promotionImageUrl(entry.url) })) };
}

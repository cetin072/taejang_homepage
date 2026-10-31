// Reviewed pilot entries only. Empty by default; never infer approval from a URL.
// { contentId, sourceUrl, sha256, size, contentType }
export const publicMediaManifest = Object.freeze([]);
export const deliveryOrigin = 'https://media.taejang.co.kr'; // proposed; not provisioned
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validEntry(entry, storageOrigin) {
  try {
    const url = new URL(entry.sourceUrl);
    return UUID.test(entry.contentId) && /^[a-f0-9]{64}$/.test(entry.sha256)
      && Number.isInteger(entry.size) && entry.size > 0 && entry.size <= 5 * 1024 * 1024
      && ['image/jpeg', 'image/png', 'image/webp'].includes(entry.contentType)
      && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(storageOrigin)
      && url.origin === storageOrigin && !url.search && !url.hash && !url.username && !url.password
      && /^\/storage\/v1\/object\/public\/promotion-media\/[a-zA-Z0-9_./-]+$/.test(url.pathname);
  } catch { return false; }
}
export function mediaKey(entry) { return `v1/${entry.contentId}/${entry.sha256}`; }
export function deliveryUrl(entry) { return `${deliveryOrigin}/${mediaKey(entry)}`; }
export function isCurrentPublicMedia(row, entry) {
  return row?.content_id === entry.contentId && Array.isArray(row.public_media)
    && row.public_media.some(media => media?.url === entry.sourceUrl);
}
// Presentation only: authoritative approval remains the existing RPC and Worker.
export function routePublicMedia(row, { enabled, storageOrigin, entries = publicMediaManifest }) {
  if (enabled !== 'true' || !row) return row;
  const replacements = new Map(entries.filter(entry => validEntry(entry, storageOrigin)
    && isCurrentPublicMedia(row, entry)).map(entry => [entry.sourceUrl, deliveryUrl(entry)]));
  return { ...row, hero_image_url: replacements.get(row.hero_image_url) || row.hero_image_url,
    public_media: (row.public_media || []).map(media => ({ ...media, url: replacements.get(media.url) || media.url })) };
}

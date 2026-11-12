// Presentation only, applied after the existing public approval checks.
// Source and six image identities verified against the official blog on 2026-11-12:
// https://blog.naver.com/taejang-official/224472724117
(function (root) {
  'use strict';
  const articleId = 'e584c9eb-21bb-4777-8752-f0d36d79cd8d';
  const imageIds = [
    'SE-fa3cac41-0281-430d-8e91-d1f5e48a1f5a',
    'SE-5c6c4607-046f-410d-9108-5ffd4f2f9951',
    'SE-29551a87-039b-4e57-8c30-ed9829d85a7b',
    'SE-3e741220-689a-4200-bee6-483b00e1dab4',
    'SE-634544f1-4f9c-4fff-9cd0-991afc54ef6d',
    'SE-388b548c-54cd-4fd6-bca5-681ee6d772ca'
  ];
  const imageSizes = [[1600, 1045], [910, 1055], [971, 1600], [1600, 875], [1262, 1080], [1448, 1086]];
  function escape(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function render(item) {
    if (item?.content_id !== articleId || item.content_type !== 'homepage_article') return null;
    const media = item.public_media || [];
    const photos = imageIds.map(id => media.find(entry => entry.alt === id && root.TAEJANG_PUBLIC_MEDIA.persistent(entry.url)));
    // Never pair an unidentified replacement image by its array position.
    if (photos.some(photo => !photo) || media.length !== photos.length) return null;
    const lines = String(item.public_body || '').split(/\r?\n/).map(line => line.trim());
    const tocIndex = lines.indexOf('글의 순서');
    if (tocIndex < 0 || !lines[tocIndex + 4]?.startsWith('4 ')) return null;
    const headings = lines.slice(tocIndex + 1, tocIndex + 5).map(text => text.replace(/^[1-4]\s+/, ''));
    let section = 0, photoCount = 0, output = [], paragraph = [];
    const flush = () => { if (paragraph.length) { output.push('<p>' + paragraph.map(escape).join(' ') + '</p>'); paragraph = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) { flush(); continue; }
      if (i === tocIndex) {
        flush();
        output.push('<nav class="feature-article-toc" aria-label="글의 순서"><strong>글의 순서</strong><ol>' + headings.map((title, n) => '<li><a href="#feature-section-' + (n + 1) + '">' + escape(title) + '</a></li>').join('') + '</ol></nav>');
        i += 4; continue;
      }
      if (/^[1-4][. ]/.test(line)) {
        flush(); section++;
        if (Number(line[0]) !== section) return null;
        output.push('<h2 id="feature-section-' + section + '">' + escape(line) + '</h2>');
        continue;
      }
      if (/^사진[1-6]$/.test(line)) {
        flush(); const n = Number(line.slice(2)) - 1;
        if (n !== photoCount || !lines[i + 1]) return null;
        photoCount++;
        const caption = lines[++i];
        output.push('<figure class="feature-article-photo"><img src="' + escape(photos[n].url) + '" width="' + imageSizes[n][0] + '" height="' + imageSizes[n][1] + '" alt="' + escape(caption) + '" loading="lazy" decoding="async"><figcaption>' + escape(caption) + '</figcaption></figure>');
        continue;
      }
      if (line.startsWith('Q. ')) {
        flush(); output.push('<h3 class="feature-article-question">' + escape(line) + '</h3>'); continue;
      }
      if (line.startsWith('"') || line.startsWith('“') || line === '직원들이 편안하게 일하고,') {
        flush(); const quote = [line];
        while (lines[i + 1]) quote.push(lines[++i]);
        output.push('<blockquote><p>' + quote.map(escape).join(' ') + '</p></blockquote>'); continue;
      }
      if (line === '연재 기획기사 1편') {
        flush(); output.push('<p class="eyebrow feature-article-label">' + escape(line) + '</p>'); continue;
      }
      paragraph.push(line);
    }
    flush();
    if (section !== 4 || photoCount !== 6) return null;
    return '<div class="feature-article-layout">' + output.join('\n') + '</div>';
  }
  root.TAEJANG_FEATURED_ARTICLE = Object.freeze({ render });
}(typeof window !== 'undefined' ? window : globalThis));

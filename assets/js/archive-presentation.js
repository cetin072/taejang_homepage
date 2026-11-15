// Display-only formatting. Original records, search data and publication state stay intact.
(function (root) {
  'use strict';
  const labels = { homepage: '홈페이지', 'naver-blog': '네이버 블로그', youtube: '유튜브', press: '언론보도', instagram: '인스타그램', x: 'X' };
  function text(value) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, key) => {
      if (key[0] !== '#') return entities[key.toLowerCase()] ?? match;
      const number = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : match;
    });
  }
  function present(item) {
    const title = text(item.title).replace(/\s*[-–—]\s*장애인 표준사업장(?:\s*태장)?\s*$/, '');
    let summary = text(item.summary);
    if (/^태장 공식 블로그의 「.*」 기록입니다\.$/.test(summary)) summary = '';
    summary = summary.replace(/^안녕하세요[.!]\s*(?:함께 만드는[^.!]*태장입니다[.!]\s*)?(?:🌿\s*)?/, '');
    const rawAlt = text(item.thumbnailAlt);
    const alt = !rawAlt || /^(?:SE-[a-z0-9-]+|KakaoTalk[_\s-].*)$/i.test(rawAlt) ? title + ' 관련 사진' : rawAlt;
    return { ...item, title, summary, thumbnailAlt: alt };
  }
  const api = { text, present, labels };
  root.TAEJANG_ARCHIVE_PRESENTATION = api;
  if (typeof module !== 'undefined') module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));

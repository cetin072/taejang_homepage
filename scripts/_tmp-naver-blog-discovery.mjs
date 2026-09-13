const BLOG_ID = 'taejang-official';
const API = `https://m.blog.naver.com/api/blogs/${BLOG_ID}/post-list`;
const MAX_PAGES = 20;
const PAGE_SIZE = 30;

function normalizeEnvelope(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.result?.items)) return payload.result.items;
  if (Array.isArray(payload?.message?.result?.items)) return payload.message.result.items;
  return [];
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function publishedDate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(number));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

const seen = new Set();
const posts = [];
const diagnostics = [];

for (let page = 1; page <= MAX_PAGES; page += 1) {
  const url = new URL(API);
  url.searchParams.set('categoryNo', '0');
  url.searchParams.set('itemCount', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TaejangArchiveSync/1.0; +https://taejang.co.kr)',
      'Accept': 'application/json,text/plain,*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9'
    }
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Naver upstream ${response.status}: ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  const items = normalizeEnvelope(payload);
  diagnostics.push({ page, itemCount: items.length });
  if (!items.length) break;

  let added = 0;
  for (const item of items) {
    const logNo = String(item?.logNo || item?.logno || '').trim();
    if (!/^\d+$/.test(logNo) || seen.has(logNo)) continue;
    seen.add(logNo);
    added += 1;
    posts.push({
      logNo,
      title: cleanTitle(item?.titleWithInspectMessage || item?.title || ''),
      publishedAt: publishedDate(item?.addDate),
      addDate: item?.addDate ?? null,
      thisDayPostInfo: item?.thisDayPostInfo ?? null,
      url: `https://blog.naver.com/${BLOG_ID}/${logNo}`
    });
  }

  if (added === 0 || items.length < PAGE_SIZE) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

process.stdout.write(JSON.stringify({ blogId: BLOG_ID, count: posts.length, diagnostics, posts }, null, 2));

const BLOG_ID = 'taejang-official';
const API = 'https://blog.naver.com/PostTitleListAsync.naver';
const MAX_PAGES = 20;
const PAGE_SIZE = 30;

function decodeTitle(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, '%20'))
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

function publishedDate(value) {
  const raw = String(value ?? '').trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(numeric));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (map.year && map.month && map.day) return `${map.year}-${map.month}-${map.day}`;
  }

  const match = raw.match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

const seen = new Set();
const posts = [];
const diagnostics = [];

for (let page = 1; page <= MAX_PAGES; page += 1) {
  const url = new URL(API);
  url.searchParams.set('blogId', BLOG_ID);
  url.searchParams.set('viewdate', '');
  url.searchParams.set('currentPage', String(page));
  url.searchParams.set('categoryNo', '0');
  url.searchParams.set('parentCategoryNo', '');
  url.searchParams.set('countPerPage', String(PAGE_SIZE));

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `https://blog.naver.com/${BLOG_ID}`
    }
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Naver upstream ${response.status}: ${text.slice(0, 300)}`);

  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error(`Invalid Naver JSON: ${text.slice(0, 300)}`); }

  const items = Array.isArray(payload?.postList) ? payload.postList : [];
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
      title: decodeTitle(item?.title || item?.titleWithInspectMessage || ''),
      publishedAt: publishedDate(item?.addDate),
      addDate: item?.addDate ?? null,
      url: `https://blog.naver.com/${BLOG_ID}/${logNo}`
    });
  }

  if (added === 0 || items.length < PAGE_SIZE) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

process.stdout.write(JSON.stringify({ blogId: BLOG_ID, count: posts.length, diagnostics, posts }, null, 2));

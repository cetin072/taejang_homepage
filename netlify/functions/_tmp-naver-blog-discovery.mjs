const BLOG_ID = 'taejang-official';
const API = `https://m.blog.naver.com/api/blogs/${BLOG_ID}/post-list`;
const MAX_PAGES = 20;
const PAGE_SIZE = 30;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

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
  const date = new Date(number);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export default async (request) => {
  if (request.method !== 'GET') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const seen = new Set();
  const posts = [];
  const diagnostics = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(API);
    url.searchParams.set('categoryNo', '0');
    url.searchParams.set('itemCount', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));

    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TaejangArchiveSync/1.0; +https://taejang.co.kr)',
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'ko-KR,ko;q=0.9'
        }
      });
    } catch (error) {
      return json(502, { error: 'FETCH_FAILED', page, detail: String(error?.message || error) });
    }

    const text = await response.text();
    if (!response.ok) {
      return json(502, { error: 'UPSTREAM_ERROR', page, status: response.status, body: text.slice(0, 500) });
    }

    let payload;
    try { payload = JSON.parse(text); }
    catch { return json(502, { error: 'INVALID_JSON', page, body: text.slice(0, 500) }); }

    const items = normalizeEnvelope(payload);
    diagnostics.push({ page, itemCount: items.length });
    if (!items.length) break;

    let added = 0;
    for (const item of items) {
      const logNo = String(item?.logNo || item?.logno || '').trim();
      if (!/^\d+$/.test(logNo) || seen.has(logNo)) continue;
      seen.add(logNo);
      added += 1;
      const title = cleanTitle(item?.titleWithInspectMessage || item?.title || '');
      posts.push({
        logNo,
        title,
        publishedAt: publishedDate(item?.addDate),
        addDate: item?.addDate ?? null,
        thisDayPostInfo: item?.thisDayPostInfo ?? null,
        url: `https://blog.naver.com/${BLOG_ID}/${logNo}`
      });
    }

    if (added === 0 || items.length < PAGE_SIZE) break;
  }

  return json(200, {
    blogId: BLOG_ID,
    count: posts.length,
    diagnostics,
    posts
  });
};

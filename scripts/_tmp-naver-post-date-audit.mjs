const BLOG_ID = 'taejang-official';
const LOG_NOS = [
  '224400618229','224398600738','224399370543','224398221535','224398110477',
  '224396975752','224396946946','224395712759','224393304415','224392856149',
  '224400583496','224391768685','224390586768','224389347792','224388330726',
  '224385290199','224384174717','224383044111','224378213482','224373709440',
  '224382259640','224377482691','224376710751','224375243175','224371103384',
  '224370787768','224370892954','224369691196','224370033544','224367547159'
];

function decodeHtml(text) {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/\u200b/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function extractBody(html) {
  const smart = html.match(/<div[^>]+class="[^"]*se-main-container[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)?.[1];
  if (smart) return decodeHtml(smart);
  const legacy = html.match(/<div[^>]+id="postViewArea"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (legacy) return decodeHtml(legacy);
  return decodeHtml(html);
}

function extractTitle(html) {
  const match = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)
    || html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:title"/i);
  return decodeHtml(match?.[1] || '');
}

function dateCandidates(text) {
  const patterns = [
    /20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/g,
    /\d{1,2}\s*월\s*\d{1,2}\s*일/g,
    /20\d{2}[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2}/g
  ];
  const found = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = Math.max(0, match.index - 90);
      const end = Math.min(text.length, match.index + match[0].length + 120);
      found.push({ raw: match[0], context: text.slice(start, end).replace(/\n/g, ' ') });
    }
  }
  const unique = [];
  const seen = new Set();
  for (const item of found) {
    const key = `${item.raw}|${item.context}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}

const results = [];
for (const logNo of LOG_NOS) {
  const url = `https://blog.naver.com/PostView.naver?blogId=${BLOG_ID}&logNo=${logNo}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `https://blog.naver.com/${BLOG_ID}/${logNo}`
    }
  });
  const html = await response.text();
  if (!response.ok) {
    results.push({ logNo, status: response.status, title: '', candidates: [] });
    continue;
  }
  const title = extractTitle(html);
  const body = extractBody(html);
  results.push({ logNo, status: response.status, title, candidates: dateCandidates(`${title}\n${body}`) });
  await new Promise(resolve => setTimeout(resolve, 250));
}

process.stdout.write(JSON.stringify({ blogId: BLOG_ID, checked: results.length, results }, null, 2));

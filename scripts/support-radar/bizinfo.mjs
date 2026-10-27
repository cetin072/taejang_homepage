// Official JSON boundary. No DB access, scheduler, credentials in output or new dependency.
export const endpoint = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
const clean = value => typeof value === 'string' ? value.trim() : '';
export function safeUrl(value) {
  try { const url = new URL(clean(value), 'https://www.bizinfo.go.kr');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && clean(value) ? url.href : null;
  } catch { return null; }
}
function date(value, end = false) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const iso = `${y}-${m}-${d}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return `${iso}T${end ? '23:59:59' : '00:00:00'}+09:00`;
}
export function period(raw) {
  const value = clean(raw);
  const match = /^(\d{8})\s*~\s*(\d{8})$/.exec(value);
  const start = match ? date(match[1]) : null;
  const end = match ? date(match[2], true) : null;
  const valid = start && end && start <= end;
  return { application_period: value || null, application_start_at: valid ? start : null, deadline_at: valid ? end : null };
}
export function normalize(item) {
  const id = clean(item.pblancId || item.seq);
  const title = clean(item.pblancNm || item.title);
  const url = safeUrl(item.pblancUrl || item.link);
  if (!/^PBLN_[A-Za-z0-9_-]+$/.test(id) || !title || !url) throw new Error('INVALID_NOTICE');
  return { source_code: 'bizinfo', source_notice_id: id, title, canonical_url: url,
    managing_organization: clean(item.jrsdInsttNm || item.author) || null,
    implementing_organization: clean(item.excInsttNm) || null,
    eligibility_summary: clean(item.trgetNm) || null,
    // Keep upstream text as data; never insert HTML into the application DOM.
    source_summary: clean(item.bsnsSumryCn || item.description) || null,
    ...period(item.reqstBeginEndDe || item.reqstDt) };
}
export function parse(payload) {
  // The official documentation wraps items in jsonArray.item; deployed feeds
  // also return jsonArray directly as an array. Keep both explicit contracts.
  const items = Array.isArray(payload?.jsonArray) ? payload.jsonArray
    : payload?.jsonArray?.item ?? payload?.items ?? payload?.item ?? payload?.channel?.item;
  if (!Array.isArray(items)) throw new Error('INVALID_RESPONSE');
  const unique = new Map();
  for (const item of items) { const notice = normalize(item); unique.set(notice.source_notice_id, notice); }
  return [...unique.values()];
}
export function mergeSnapshot(previous = [], incoming = []) {
  const rows = new Map(previous.map(row => [`${row.source_code}:${row.source_notice_id}`, row]));
  let added = 0, updated = 0;
  for (const notice of incoming) {
    const key = `${notice.source_code}:${notice.source_notice_id}`, old = rows.get(key);
    // Only normalized source fields are replaced; local notes/decisions/assignments survive.
    const source = normalize({ pblancId: notice.source_notice_id, pblancNm: notice.title,
      pblancUrl: notice.canonical_url, jrsdInsttNm: notice.managing_organization,
      excInsttNm: notice.implementing_organization, trgetNm: notice.eligibility_summary,
      bsnsSumryCn: notice.source_summary, reqstBeginEndDe: notice.application_period });
    if (!old) added++;
    else if (Object.keys(source).some(field => old[field] !== source[field])) updated++;
    rows.set(key, { ...old, ...source });
  }
  return { notices: [...rows.values()], added, updated };
}
export async function collect({ key, fetchImpl = fetch, previous = [], lastSuccessAt = null, now = () => new Date().toISOString() } = {}) {
  const attemptedAt = now();
  const failure = status => ({ status, attempted_at: attemptedAt, last_success_at: lastSuccessAt, notices: previous, added: 0, updated: 0 });
  if (!clean(key)) return failure('not_connected');
  const url = new URL(endpoint);
  url.searchParams.set('crtfcKey', key); url.searchParams.set('dataType', 'json');
  url.searchParams.set('searchCnt', '100'); // Bounded latest batch, not a complete historical crawl.
  url.searchParams.set('pageUnit', '100'); url.searchParams.set('pageIndex', '1');
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if ([401, 403].includes(response.status)) return failure('authentication_failed');
    if (!response.ok) return failure('http_error');
    const body = await response.text();
    // Never echo upstream bodies or errors: they may contain the requested credential.
    if (/인증키|인증.*실패|invalid\s*(api\s*)?key|unauthorized/i.test(body) && !body.includes('PBLN_')) return failure('authentication_failed');
    let incoming;
    try { incoming = parse(JSON.parse(body)); } catch { return failure('invalid_response'); }
    const merged = mergeSnapshot(previous, incoming);
    return { ...merged, items: incoming, status: merged.added ? 'success_new' : 'success_no_new', attempted_at: attemptedAt, last_success_at: attemptedAt };
  } catch { return failure('network_error'); }
}

export const BIZINFO_API_ENDPOINT = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';

const REGION_TAGS = new Set([
  '서울', '부산', '대구', '인천', '전남광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '경북', '경남', '제주'
]);

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function first(...values) {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return '';
}

function positiveInteger(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`BIZINFO_${field.toUpperCase()}_INVALID`);
  return number;
}

export function buildBizinfoRequestPlan({
  dataType = 'json',
  searchCnt = null,
  searchLclasId = null,
  hashtags = null,
  pageUnit = null,
  pageIndex = null
} = {}) {
  const normalizedType = clean(dataType).toLowerCase();
  if (!['json', 'xml'].includes(normalizedType)) throw new Error('BIZINFO_DATA_TYPE_INVALID');

  const params = { dataType: normalizedType };
  const count = positiveInteger(searchCnt, 'searchCnt');
  const unit = positiveInteger(pageUnit, 'pageUnit');
  const index = positiveInteger(pageIndex, 'pageIndex');
  if (count !== null) params.searchCnt = String(count);
  if (clean(searchLclasId)) params.searchLclasId = clean(searchLclasId);
  if (clean(hashtags)) params.hashtags = clean(hashtags);
  if (unit !== null) params.pageUnit = String(unit);
  if (index !== null) params.pageIndex = String(index);

  return {
    endpoint: BIZINFO_API_ENDPOINT,
    public_params: params,
    requires_server_secret: true,
    secret_parameter_name: 'crtfcKey'
  };
}

function decodeEntities(value) {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export function stripBizinfoHtml(value) {
  return decodeEntities(clean(value).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBizinfoCsv(value) {
  const seen = new Set();
  const result = [];
  for (const part of clean(value).split(',')) {
    const item = part.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function normalizeDateToken(value) {
  const token = clean(value).replaceAll('.', '-').replaceAll('/', '-');
  const compact = token.match(/^(\d{4})(\d{2})(\d{2})$/);
  const dashed = token.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const match = compact || dashed;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseBizinfoApplicationPeriod(value) {
  const raw = clean(value);
  if (!raw) return { raw: '', start_date: null, end_date: null };

  const parts = raw.split(/\s*(?:~|∼|–|—)\s*/).filter(Boolean);
  if (parts.length !== 2) return { raw, start_date: null, end_date: null };

  return {
    raw,
    start_date: normalizeDateToken(parts[0]),
    end_date: normalizeDateToken(parts[1])
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function buildDocuments(raw) {
  const candidates = [
    [raw?.flpthNm, raw?.fileNm],
    [raw?.printFlpthNm, raw?.printFileNm]
  ];
  const seen = new Set();
  const documents = [];

  for (const [urlValue, filenameValue] of candidates) {
    const url = clean(urlValue);
    const filename = clean(filenameValue);
    if (!url || !isHttpUrl(url)) continue;
    const key = `${url}\n${filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    documents.push({
      document_type: 'attachment',
      source_url: url,
      original_filename: filename || null
    });
  }
  return documents;
}

function normalizeItem(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, rejected: { index, reason: 'ITEM_NOT_OBJECT' } };
  }

  const sourceNoticeId = first(raw.pblancId, raw.seq);
  const title = first(raw.pblancNm, raw.title);
  const sourceUrl = first(raw.pblancUrl, raw.link);

  const missing = [];
  if (!sourceNoticeId) missing.push('source_notice_id');
  if (!title) missing.push('title');
  if (!sourceUrl || !isHttpUrl(sourceUrl)) missing.push('source_url');
  if (missing.length) {
    return {
      ok: false,
      rejected: {
        index,
        reason: 'MISSING_REQUIRED_FIELDS',
        missing,
        source_notice_id: sourceNoticeId || null
      }
    };
  }

  const period = parseBizinfoApplicationPeriod(first(raw.reqstBeginEndDe, raw.reqstDt));
  const hashtags = parseBizinfoCsv(raw.hashTags);
  const category = first(raw.pldirSportRealmLclasCodeNm, raw.lcategory);
  const sourceSummary = stripBizinfoHtml(first(raw.bsnsSumryCn, raw.description));

  return {
    ok: true,
    value: {
      source_code: 'bizinfo',
      occurrence: {
        source_notice_id: sourceNoticeId,
        source_url: sourceUrl,
        raw_title: title,
        source_published_raw: first(raw.creatPnttm, raw.pubDate) || null,
        raw_payload: raw
      },
      notice: {
        title,
        managing_organization: first(raw.jrsdInsttNm, raw.author) || null,
        implementing_organization: first(raw.excInsttNm) || null,
        canonical_url: sourceUrl,
        application_start_date: period.start_date,
        deadline_date: period.end_date,
        target_regions: hashtags.filter(tag => REGION_TAGS.has(tag)),
        categories: category ? [category] : [],
        eligibility_summary: first(raw.trgetNm) || null,
        application_process_summary: first(raw.reqstMthPapersCn) || null,
        contact_summary: first(raw.refrncNm) || null
      },
      source_summary: sourceSummary || null,
      application_url: first(raw.rceptEngnHmpgUrl) || null,
      application_period_raw: period.raw || null,
      hashtags,
      documents: buildDocuments(raw)
    }
  };
}

export function normalizeBizinfoPayload(payload) {
  const root = payload?.jsonArray;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('BIZINFO_INVALID_PAYLOAD');
  }

  let sourceItems = root.item;
  if (sourceItems === undefined || sourceItems === null) sourceItems = [];
  else if (!Array.isArray(sourceItems)) sourceItems = [sourceItems];

  const items = [];
  const rejected = [];
  sourceItems.forEach((raw, index) => {
    const normalized = normalizeItem(raw, index);
    if (normalized.ok) items.push(normalized.value);
    else rejected.push(normalized.rejected);
  });

  const reportedTotal = first(root.totCnt, sourceItems[0]?.totCnt);
  const totalCount = /^\d+$/.test(reportedTotal) ? Number(reportedTotal) : sourceItems.length;

  return {
    source_code: 'bizinfo',
    meta: {
      title: first(root.title) || null,
      category: first(root.category) || null,
      ttl: first(root.ttl) || null,
      last_build_date_raw: first(root.lastBuildDate) || null,
      reported_total_count: totalCount
    },
    items,
    rejected
  };
}

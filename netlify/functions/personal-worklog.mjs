const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const bearer = value => /^Bearer ([^\s]{1,16000})$/i.exec(value || '')?.[1];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function monthRange(month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month || '')) throw fail(400, 'INVALID_MONTH');
  const [year, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 7);
  return { start: `${month}-01T00:00:00+09:00`, end: `${next}-01T00:00:00+09:00` };
}
export function createHandler({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  return async req => {
    if (req.method !== 'GET') return json(405, { code: 'METHOD_NOT_ALLOWED' });
    const token = bearer(req.headers.get('authorization'));
    if (!token) return json(401, { code: 'ERP_AUTH_REQUIRED' });
    const url = env.SUPABASE_URL?.replace(/\/$/, '');
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url || '') || !key) return json(503, { code: 'ERP_CONNECTION_NOT_READY' });
    // Auth/context remain public. Only personal data GETs use the isolated schema.
    async function read(base, apiKey, accessToken, path, code, options = {}) {
      const response = await fetchImpl(base + path, { ...options, headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? 401 : 502, code);
      return response.json();
    }
    try {
      const erpUser = await read(url, key, token, '/auth/v1/user', 'ERP_AUTH_REQUIRED');
      if (!uuid(erpUser?.id) || erpUser.is_anonymous) throw fail(401, 'ERP_AUTH_REQUIRED');
      const context = await read(url, key, token, '/rest/v1/rpc/get_my_access_context', 'ERP_ACCESS_UNAVAILABLE', { method: 'POST', body: '{}' });
      if (context?.id !== erpUser.id || context.account_status !== 'active') throw fail(403, 'ERP_ACCOUNT_INACTIVE');
      if (context.role_simulation?.active === true) throw fail(403, 'WORKLOG_ROLE_PREVIEW');
      if (req.headers.has('x-worklog-authorization')) throw fail(400, 'SECONDARY_SESSION_NOT_SUPPORTED');
      if (env.WORKLOG_UNIFIED_READ_ENABLED !== 'true') throw fail(503, 'WORKLOG_MIGRATION_PENDING');
      const params = new URL(req.url).searchParams;
      if ([...params.keys()].some(k => k !== 'month')) throw fail(400, 'UNSUPPORTED_PARAMETER');
      const range = monthRange(params.get('month'));
      const user = erpUser;
      const worklogRead = path => read(url, key, token, path, 'WORKLOG_READ_FAILED', { headers: { 'Accept-Profile': 'worklog' } });
      const query = (table, values) => worklogRead(`/rest/v1/${table}?${new URLSearchParams(values)}`);
      const spaces = await query('workspaces', { select: 'id,kind,owner_user_id', kind: 'eq.personal', owner_user_id: `eq.${user.id}`, limit: '2' });
      if (!Array.isArray(spaces) || spaces.length !== 1 || !uuid(spaces[0].id) || spaces[0].kind !== 'personal' || spaces[0].owner_user_id !== user.id) throw fail(403, 'PERSONAL_WORKSPACE_UNAVAILABLE');
      const workspaceId = spaces[0].id;
      const members = await query('workspace_members', { select: 'user_id,role', workspace_id: `eq.${workspaceId}`, user_id: `eq.${user.id}`, role: 'eq.owner', limit: '2' });
      if (members.length !== 1 || members[0].user_id !== user.id || members[0].role !== 'owner') throw fail(403, 'PERSONAL_WORKSPACE_UNAVAILABLE');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
      const tomorrow = new Date(Date.parse(`${today}T00:00:00+09:00`) + 86400000).toISOString();
      const schedulesFor = (start, end) => query('schedules', {
        select: 'id,title,starts_at,ends_at,all_day,status', workspace_id: `eq.${workspaceId}`, created_by_user_id: `eq.${user.id}`,
        status: 'in.(confirmed,tentative)', starts_at: `lt.${end}`,
        or: `(ends_at.gt.${start},starts_at.gte.${start})`, order: 'starts_at.asc,id.asc', limit: '501'
      });
      const [schedules, todaySchedules, tasks] = await Promise.all([
        schedulesFor(range.start, range.end), schedulesFor(`${today}T00:00:00+09:00`, tomorrow),
        query('work_records', { select: 'id,title,status,due_at,next_attention_at', workspace_id: `eq.${workspaceId}`, created_by_user_id: `eq.${user.id}`, status: 'in.(in_progress,waiting,needs_review)',
          // Match Worklog's journal projection: a Schedule's source WorkRecord
          // is not another unfinished task. Keep legacy rows with no kind.
          and: '(or(action_kind.is.null,action_kind.eq.task),or(metadata->actionEngine->>kind.is.null,metadata->actionEngine->>kind.neq.schedule))',
          order: 'updated_at.desc,id.asc', limit: '501' })
      ]);
      if (![schedules, todaySchedules, tasks].every(Array.isArray)) throw fail(502, 'WORKLOG_READ_FAILED');
      return json(200, { connected: true, month: params.get('month'), today, schedules: schedules.slice(0,500), todaySchedules: todaySchedules.slice(0,500), tasks: tasks.slice(0,500), limited: [schedules,todaySchedules,tasks].some(rows => rows.length > 500), fetchedAt: now().toISOString() });
    } catch (error) {
      return json(error.status || 502, { code: error.code || 'WORKLOG_UNAVAILABLE' });
    }
  };
}
export default createHandler();
export const config = { path: '/api/personal-worklog' };

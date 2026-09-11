import { createClient } from 'npm:@supabase/supabase-js@2';

const STAGING_PROJECT_REF = 'jgsxpdflgkqroecfjzxq';
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function allowedOrigin(origin) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) return origin;
    if (url.protocol !== 'https:') return null;
    if (host.startsWith('deploy-preview-') && host.endsWith('--taejang-homepage.netlify.app')) return origin;
    return null;
  } catch {
    return null;
  }
}

function corsHeaders(origin) {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '3600',
    'Vary': 'Origin'
  };
}

function reply(status, payload, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...jsonHeaders, ...corsHeaders(origin) }
  });
}

function bearerToken(req) {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function roleCodes(rows) {
  return new Set((rows || []).map(row => row?.role?.code).filter(Boolean));
}

async function authorizeOperator(admin, token) {
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return { error: 'UNAUTHENTICATED', status: 401 };

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, display_name, account_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile || profile.account_status !== 'active') {
    return { error: 'QA_PREVIEW_FORBIDDEN', status: 403 };
  }

  const { data: assignments, error: roleError } = await admin
    .from('profile_roles')
    .select('role:roles!inner(code, name, active)')
    .eq('profile_id', user.id)
    .is('revoked_at', null);
  if (roleError) return { error: 'QA_PREVIEW_ROLE_LOOKUP_FAILED', status: 500 };

  const codes = roleCodes((assignments || []).filter(row => row?.role?.active !== false));
  if (!codes.has('operations_manager') || !codes.has('super_admin')) {
    return { error: 'QA_PREVIEW_FORBIDDEN', status: 403 };
  }

  return { user, profile, codes };
}

async function listAccounts(admin) {
  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, display_name, account_status, department:departments(name), position:positions(name)')
    .eq('account_status', 'active')
    .order('display_name', { ascending: true });
  if (profileError) throw profileError;

  const ids = (profiles || []).map(profile => profile.id);
  let assignments = [];
  if (ids.length) {
    const { data, error } = await admin
      .from('profile_roles')
      .select('profile_id, role:roles!inner(code, name, active)')
      .in('profile_id', ids)
      .is('revoked_at', null);
    if (error) throw error;
    assignments = data || [];
  }

  const roleMap = new Map();
  for (const assignment of assignments) {
    if (assignment?.role?.active === false) continue;
    const current = roleMap.get(assignment.profile_id) || [];
    current.push({ code: assignment.role?.code || '', name: assignment.role?.name || assignment.role?.code || '' });
    roleMap.set(assignment.profile_id, current);
  }

  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const authUsers = new Map((usersData?.users || []).map(user => [user.id, user]));

  return (profiles || []).map(profile => {
    const authUser = authUsers.get(profile.id);
    const roles = (roleMap.get(profile.id) || []).sort((left, right) => left.name.localeCompare(right.name, 'ko'));
    return {
      id: profile.id,
      display_name: profile.display_name || '이름 없음',
      department_name: profile.department?.name || null,
      position_name: profile.position?.name || null,
      roles,
      previewable: Boolean(authUser?.email),
      preview_reason: authUser?.email ? null : '로그인 계정 없음'
    };
  });
}

async function createPreviewToken(admin, targetProfileId) {
  if (typeof targetProfileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(targetProfileId)) {
    return { error: 'INVALID_TARGET_PROFILE', status: 400 };
  }

  const { data: targetProfile, error: profileError } = await admin
    .from('profiles')
    .select('id, display_name, account_status')
    .eq('id', targetProfileId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!targetProfile || targetProfile.account_status !== 'active') {
    return { error: 'TARGET_NOT_ACTIVE', status: 400 };
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(targetProfileId);
  const targetUser = userData?.user;
  if (userError || !targetUser?.email) {
    return { error: 'TARGET_AUTH_ACCOUNT_NOT_FOUND', status: 400 };
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetUser.email
  });
  if (linkError) throw linkError;

  const tokenHash = linkData?.properties?.hashed_token;
  const verificationType = linkData?.properties?.verification_type || 'magiclink';
  if (!tokenHash) return { error: 'QA_PREVIEW_TOKEN_NOT_CREATED', status: 500 };

  return {
    target: { id: targetProfile.id, display_name: targetProfile.display_name || '사용자' },
    token_hash: tokenHash,
    verification_type: verificationType,
    expires_hint_seconds: 600
  };
}

Deno.serve(async req => {
  const requestOrigin = req.headers.get('origin');
  const origin = allowedOrigin(requestOrigin);

  if (req.method === 'OPTIONS') {
    if (requestOrigin && !origin) return reply(403, { error: 'ORIGIN_NOT_ALLOWED' }, null);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' }, origin);
  if (requestOrigin && !origin) return reply(403, { error: 'ORIGIN_NOT_ALLOWED' }, null);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl.includes(`${STAGING_PROJECT_REF}.supabase.co`) || !serviceRoleKey) {
    return reply(403, { error: 'STAGING_ONLY' }, origin);
  }

  const token = bearerToken(req);
  if (!token) return reply(401, { error: 'UNAUTHENTICATED' }, origin);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const authorization = await authorizeOperator(admin, token);
  if (authorization.error) return reply(authorization.status, { error: authorization.error }, origin);

  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'INVALID_JSON' }, origin);
  }

  try {
    if (body?.action === 'list') {
      const accounts = await listAccounts(admin);
      console.info('qa_account_preview_list', { actor_id: authorization.user.id, count: accounts.length });
      return reply(200, { accounts }, origin);
    }

    if (body?.action === 'create') {
      const result = await createPreviewToken(admin, body.target_profile_id);
      if (result.error) return reply(result.status, { error: result.error }, origin);
      console.info('qa_account_preview_created', {
        actor_id: authorization.user.id,
        target_profile_id: result.target.id
      });
      return reply(200, result, origin);
    }

    return reply(400, { error: 'INVALID_ACTION' }, origin);
  } catch (error) {
    console.error('qa_account_preview_failed', error);
    return reply(500, { error: 'QA_PREVIEW_FAILED' }, origin);
  }
});

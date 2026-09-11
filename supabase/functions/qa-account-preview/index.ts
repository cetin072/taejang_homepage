import { createClient } from 'npm:@supabase/supabase-js@2';

const STAGING_PROJECT_REF = 'jgsxpdflgkqroecfjzxq';
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function allowedOrigin(origin: string | null) {
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

function corsHeaders(origin: string | null) {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '3600',
    'Vary': 'Origin'
  };
}

function reply(status: number, payload: unknown, origin: string | null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...jsonHeaders, ...corsHeaders(origin) }
  });
}

function bearerToken(req: Request) {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function isTopAuthority(codes: Set<string>) {
  return codes.has('operations_manager') && codes.has('super_admin');
}

async function loadRoleCodes(admin: any, profileId: string) {
  const { data: assignments, error: assignmentError } = await admin
    .from('profile_roles')
    .select('role_id')
    .eq('profile_id', profileId)
    .is('revoked_at', null);
  if (assignmentError) throw assignmentError;

  const roleIds = [...new Set((assignments || []).map((row: any) => row.role_id).filter(Boolean))];
  if (!roleIds.length) return new Set<string>();

  const { data: roles, error: roleError } = await admin
    .from('roles')
    .select('id, code, active')
    .in('id', roleIds);
  if (roleError) throw roleError;

  return new Set<string>((roles || []).filter((role: any) => role.active !== false).map((role: any) => role.code).filter(Boolean));
}

async function authorizeTopAuthority(admin: any, token: string) {
  // Gateway JWT verification is intentionally disabled for this staging-only
  // function. The bearer token is verified against Supabase Auth here instead,
  // then the real active profile must hold both top-authority roles.
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

  let codes: Set<string>;
  try {
    codes = await loadRoleCodes(admin, user.id);
  } catch (error) {
    console.error('qa_account_preview_role_lookup_failed', error);
    return { error: 'QA_PREVIEW_ROLE_LOOKUP_FAILED', status: 500 };
  }

  if (!isTopAuthority(codes)) return { error: 'QA_PREVIEW_FORBIDDEN', status: 403 };
  return { user, profile, codes };
}

async function listAccounts(admin: any) {
  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, display_name, account_status, department_id, position_id')
    .eq('account_status', 'active')
    .order('display_name', { ascending: true });
  if (profileError) throw profileError;

  const profileRows = profiles || [];
  const profileIds = profileRows.map((profile: any) => profile.id);
  const departmentIds = [...new Set(profileRows.map((profile: any) => profile.department_id).filter(Boolean))];
  const positionIds = [...new Set(profileRows.map((profile: any) => profile.position_id).filter(Boolean))];

  let departments: any[] = [];
  if (departmentIds.length) {
    const { data, error } = await admin.from('departments').select('id, name').in('id', departmentIds);
    if (error) throw error;
    departments = data || [];
  }

  let positions: any[] = [];
  if (positionIds.length) {
    const { data, error } = await admin.from('positions').select('id, name').in('id', positionIds);
    if (error) throw error;
    positions = data || [];
  }

  let assignments: any[] = [];
  if (profileIds.length) {
    const { data, error } = await admin
      .from('profile_roles')
      .select('profile_id, role_id')
      .in('profile_id', profileIds)
      .is('revoked_at', null);
    if (error) throw error;
    assignments = data || [];
  }

  const roleIds = [...new Set(assignments.map((assignment: any) => assignment.role_id).filter(Boolean))];
  let roles: any[] = [];
  if (roleIds.length) {
    const { data, error } = await admin.from('roles').select('id, code, name, active').in('id', roleIds);
    if (error) throw error;
    roles = (data || []).filter((role: any) => role.active !== false);
  }

  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;

  const departmentMap = new Map(departments.map((row: any) => [row.id, row.name]));
  const positionMap = new Map(positions.map((row: any) => [row.id, row.name]));
  const roleById = new Map(roles.map((role: any) => [role.id, role]));
  const rolesByProfile = new Map<string, any[]>();
  for (const assignment of assignments) {
    const role = roleById.get(assignment.role_id);
    if (!role) continue;
    const current = rolesByProfile.get(assignment.profile_id) || [];
    current.push({ code: role.code, name: role.name || role.code });
    rolesByProfile.set(assignment.profile_id, current);
  }
  const authUsers = new Map((usersData?.users || []).map((user: any) => [user.id, user]));

  return profileRows.map((profile: any) => {
    const accountRoles = (rolesByProfile.get(profile.id) || []).sort((left, right) => (left.name || '').localeCompare(right.name || '', 'ko'));
    const authUser: any = authUsers.get(profile.id);
    const hasEmail = Boolean(authUser?.email);
    const emailConfirmed = Boolean(authUser?.email_confirmed_at);
    return {
      id: profile.id,
      display_name: profile.display_name || '이름 없음',
      department_name: departmentMap.get(profile.department_id) || null,
      position_name: positionMap.get(profile.position_id) || null,
      roles: accountRoles,
      top_authority: isTopAuthority(new Set(accountRoles.map(role => role.code))),
      previewable: hasEmail && emailConfirmed,
      preview_reason: !hasEmail ? '로그인 계정 없음' : (!emailConfirmed ? '이메일 확인 전 계정' : null)
    };
  });
}

async function createPreviewToken(admin: any, targetProfileId: unknown) {
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
  if (userError || !targetUser?.email) return { error: 'TARGET_AUTH_ACCOUNT_NOT_FOUND', status: 400 };
  if (!targetUser.email_confirmed_at) return { error: 'TARGET_EMAIL_NOT_CONFIRMED', status: 400 };

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

Deno.serve(async (req: Request) => {
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

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authorization = await authorizeTopAuthority(admin, token);
  if (authorization.error) return reply(authorization.status, { error: authorization.error }, origin);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'INVALID_JSON' }, origin);
  }

  try {
    if (body?.action === 'list') {
      const accounts = await listAccounts(admin);
      console.info('qa_account_preview_list', { actor_id: authorization.user.id, count: accounts.length });
      return reply(200, { accounts, authority: 'top' }, origin);
    }

    if (body?.action === 'create') {
      const result = await createPreviewToken(admin, body.target_profile_id);
      if (result.error) return reply(result.status, { error: result.error }, origin);
      console.info('qa_account_preview_created', { actor_id: authorization.user.id, target_profile_id: result.target.id });
      return reply(200, result, origin);
    }

    return reply(400, { error: 'INVALID_ACTION' }, origin);
  } catch (error) {
    console.error('qa_account_preview_failed', error);
    return reply(500, { error: 'QA_PREVIEW_FAILED' }, origin);
  }
});

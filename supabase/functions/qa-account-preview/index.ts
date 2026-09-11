import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowedQaOrigin, qaEnvironment } from './boundary.mjs';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function corsHeaders(origin: string | null) {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-qa-context-profile-id, x-qa-access-profile-id, x-qa-jwt-subject',
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

function safeDiagnosticCode(error: any) {
  const raw = String(error?.code || error?.name || 'UNKNOWN');
  return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'UNKNOWN';
}

function requestIdentity(req: Request) {
  return {
    contextProfileId: req.headers.get('x-qa-context-profile-id'),
    accessProfileId: req.headers.get('x-qa-access-profile-id'),
    jwtSubject: req.headers.get('x-qa-jwt-subject')
  };
}

async function authorizeTopAuthority(admin: any, supabaseUrl: string, publicKey: string, token: string, identity: ReturnType<typeof requestIdentity>) {
  // Gateway JWT verification is intentionally disabled for this staging-only
  // function. The bearer token is verified against Supabase Auth here instead,
  // then the real active profile must hold both top-authority roles.
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return { error: 'UNAUTHENTICATED', status: 401 };

  const clientIdentity = [identity.contextProfileId, identity.accessProfileId, identity.jwtSubject];
  const identityMatches = clientIdentity.every(value => value === user.id);
  if (!identityMatches) {
    console.warn('qa_account_preview_identity_mismatch', {
      actor_profile_id: user.id,
      context_profile_id: identity.contextProfileId,
      access_profile_id: identity.accessProfileId,
      jwt_subject: identity.jwtSubject
    });
    return { error: 'QA_IDENTITY_MISMATCH', status: 403 };
  }

  const userClient = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: accessContext, error: accessError } = await userClient.rpc('get_my_access_context_v2');
  if (accessError) {
    console.error('qa_account_preview_role_lookup_failed', { actor_profile_id: user.id, code: accessError.code || null });
    return { error: 'QA_ROLE_LOOKUP_FAILED', status: 500 };
  }

  if (!accessContext || accessContext.id !== user.id || accessContext.account_status !== 'active') {
    console.warn('qa_account_preview_profile_not_active', { actor_profile_id: user.id });
    return { error: 'QA_PROFILE_NOT_ACTIVE', status: 403 };
  }

  const codes = new Set<string>((accessContext.actual_roles || []).map((role: any) => role?.code).filter(Boolean));
  if (!isTopAuthority(codes)) {
    console.warn('qa_account_preview_top_authority_required', { actor_profile_id: user.id, actual_role_codes: [...codes].sort() });
    return { error: 'QA_TOP_AUTHORITY_REQUIRED', status: 403 };
  }
  console.info('qa_account_preview_authorized', { actor_profile_id: user.id, actual_role_codes: [...codes].sort() });
  return { user, profile: accessContext, codes };
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
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const environment = qaEnvironment(supabaseUrl);
  const requestOrigin = req.headers.get('origin');
  const origin = allowedQaOrigin(requestOrigin, environment);

  if (req.method === 'OPTIONS') {
    if (requestOrigin && !origin) return reply(403, { error: 'QA_ORIGIN_NOT_ALLOWED' }, null);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' }, origin);
  if (requestOrigin && !origin) return reply(403, { error: 'QA_ORIGIN_NOT_ALLOWED' }, null);

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
  if (!environment || !serviceRoleKey || !publicKey) {
    return reply(403, { error: 'QA_STAGING_ONLY' }, origin);
  }

  const token = bearerToken(req);
  if (!token) return reply(401, { error: 'UNAUTHENTICATED' }, origin);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authorization = await authorizeTopAuthority(admin, supabaseUrl, publicKey, token, requestIdentity(req));
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
      return reply(200, { accounts, authority: 'top', qa_contract_version: 2 }, origin);
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
    return reply(500, {
      error: 'QA_PREVIEW_FAILED',
      ...(environment === 'local' ? { diagnostic_code: safeDiagnosticCode(error) } : {})
    }, origin);
  }
});

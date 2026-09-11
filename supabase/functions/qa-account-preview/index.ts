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
  const raw = [error?.code || error?.name || 'UNKNOWN', error?.qaStage].filter(Boolean).join('_');
  return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'UNKNOWN';
}

function qaFailure(stage: string, error: any) {
  const wrapped: any = new Error(`QA ${stage} failed`);
  wrapped.code = error?.code || error?.name || 'UNKNOWN';
  wrapped.qaStage = stage;
  return wrapped;
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
  return { user, profile: accessContext, codes, userClient };
}

async function loadAccountManagement(userClient: any) {
  const { data: management, error: managementError } = await userClient.rpc('get_operations_account_management');
  if (managementError) throw qaFailure('account_management', managementError);
  return management || {};
}

async function listAccounts(userClient: any) {
  // The canonical account-management RPC is the source of truth for which
  // active profiles a top-authority operator may inspect. Do not bulk-enumerate
  // Auth users here: hosted environments can restrict that admin endpoint, and
  // the selected target is authoritatively verified against Auth in create.
  const management = await loadAccountManagement(userClient);

  const profileRows = (management?.profiles || []).filter((profile: any) => profile.account_status === 'active');
  const departments = management?.departments || [];
  const positions = management?.positions || [];
  const roles = management?.roles || [];

  const departmentMap = new Map(departments.map((row: any) => [row.id, row.name]));
  const positionMap = new Map(positions.map((row: any) => [row.id, row.name]));
  const roleByCode = new Map(roles.map((role: any) => [role.code, role]));

  return profileRows.map((profile: any) => {
    const accountRoles = (profile.roles || [])
      .map((roleCode: string) => ({ code: roleCode, name: roleByCode.get(roleCode)?.name || roleCode }))
      .sort((left: any, right: any) => (left.name || '').localeCompare(right.name || '', 'ko'));
    return {
      id: profile.id,
      display_name: profile.display_name || '이름 없음',
      department_name: departmentMap.get(profile.department_id) || null,
      position_name: positionMap.get(profile.position_id) || null,
      roles: accountRoles,
      top_authority: isTopAuthority(new Set(accountRoles.map(role => role.code))),
      previewable: true,
      preview_reason: null
    };
  });
}

async function createPreviewToken(admin: any, userClient: any, targetProfileId: unknown) {
  if (typeof targetProfileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(targetProfileId)) {
    return { error: 'INVALID_TARGET_PROFILE', status: 400 };
  }

  const management = await loadAccountManagement(userClient);
  const targetProfile = (management?.profiles || []).find((profile: any) => profile.id === targetProfileId);
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
  if (linkError) throw qaFailure('generate_link', linkError);

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
      const accounts = await listAccounts(authorization.userClient);
      console.info('qa_account_preview_list', { actor_id: authorization.user.id, count: accounts.length });
      return reply(200, { accounts, authority: 'top', qa_contract_version: 3 }, origin);
    }

    if (body?.action === 'create') {
      const result = await createPreviewToken(admin, authorization.userClient, body.target_profile_id);
      if (result.error) return reply(result.status, { error: result.error }, origin);
      console.info('qa_account_preview_created', { actor_id: authorization.user.id, target_profile_id: result.target.id });
      return reply(200, result, origin);
    }

    return reply(400, { error: 'INVALID_ACTION' }, origin);
  } catch (error) {
    console.error('qa_account_preview_failed', error);
    return reply(500, {
      error: 'QA_PREVIEW_FAILED',
      diagnostic_code: safeDiagnosticCode(error)
    }, origin);
  }
});

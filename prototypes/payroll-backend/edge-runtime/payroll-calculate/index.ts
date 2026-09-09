// Taejang payroll-calculate Edge Function candidate.
// STATUS: DESIGN CANDIDATE ONLY / NOT DEPLOYED.
// DO NOT COPY TO supabase/functions OR DEPLOY WITHOUT A SEPARATE STAGING APPROVAL.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getPayrollRuntimeModules } from './runtime-deps.ts';

type JsonObject = Record<string, unknown>;

type CoreFactory = (dependencies: JsonObject) => (
  requestInput: JsonObject,
  authContext?: JsonObject,
) => Promise<JsonObject>;

const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_]{2,79}$/;

function envRequired(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function responseJson(status: number, body: JsonObject, allowedOrigin: string | null): Response {
  const headers = new Headers(JSON_HEADERS);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  if (allowedOrigin) {
    headers.set('access-control-allow-origin', allowedOrigin);
    headers.set('vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function requestOriginAllowed(req: Request, configuredOrigin: string): boolean {
  const origin = req.headers.get('origin');
  return !origin || origin === configuredOrigin;
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : '';
  return token || null;
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'PAYROLL_CALCULATION_FAILED';
  const message = String((error as { message?: unknown }).message || '').trim();
  const code = String((error as { code?: unknown }).code || '').trim();
  if (SAFE_CODE.test(message)) return message;
  if (SAFE_CODE.test(code)) return code;
  return 'PAYROLL_CALCULATION_FAILED';
}

function statusForCode(code: string): number {
  if (/UNAUTHENTICATED|JWT|AUTH_REQUIRED|ACTOR_REQUIRED/i.test(code)) return 401;
  if (/FORBIDDEN|ACCESS|ACTOR_FORBIDDEN/i.test(code)) return 403;
  if (/STALE|LOCKED|IDEMPOTENCY_CONFLICT/i.test(code)) return 409;
  if (/INVALID|REQUIRED|UNSUPPORTED|MISMATCH|REVIEW|BLOCKER/i.test(code)) return 422;
  return 500;
}

function safeOperationalLog(event: string, facts: JsonObject) {
  // Never pass request/result payloads, names, rates, pay amounts, clocks or HR fields here.
  console.info(JSON.stringify({ event, ...facts }));
}

const configuredOrigin = envRequired('PAYROLL_ALLOWED_ORIGIN');
const supabaseUrl = envRequired('SUPABASE_URL');
const publishableKey = envRequired('SUPABASE_ANON_KEY');
const internalServiceKey = envRequired('SUPABASE_SERVICE_ROLE_KEY');
const modules = getPayrollRuntimeModules();
const createCore = (modules.core as { createPayrollCalculateCore: CoreFactory }).createPayrollCalculateCore;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const correlationId = crypto.randomUUID();

  if (!requestOriginAllowed(req, configuredOrigin)) {
    return responseJson(403, { ok: false, code: 'PAYROLL_ORIGIN_FORBIDDEN', correlation_id: correlationId }, null);
  }

  if (req.method === 'OPTIONS') {
    const headers = new Headers({
      'access-control-allow-origin': configuredOrigin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      'vary': 'Origin',
    });
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return responseJson(405, { ok: false, code: 'PAYROLL_METHOD_NOT_ALLOWED', correlation_id: correlationId }, origin);
  }

  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return responseJson(413, { ok: false, code: 'PAYROLL_REQUEST_TOO_LARGE', correlation_id: correlationId }, origin);
  }

  const token = bearerToken(req);
  if (!token) {
    return responseJson(401, { ok: false, code: 'PAYROLL_AUTH_REQUIRED', correlation_id: correlationId }, origin);
  }

  let requestBody: JsonObject;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return responseJson(413, { ok: false, code: 'PAYROLL_REQUEST_TOO_LARGE', correlation_id: correlationId }, origin);
    }
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_BODY');
    requestBody = parsed as JsonObject;
  } catch {
    return responseJson(400, { ok: false, code: 'PAYROLL_INVALID_JSON', correlation_id: correlationId }, origin);
  }

  // User-JWT client: guarded read RPC executes as the actual payroll operator.
  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Internal client: used only for the single private persistence RPC. No direct table CRUD.
  // The matching service_role EXECUTE grant is intentionally absent from the current SQL
  // candidate and remains a separate staging approval/review gate.
  const internalClient = createClient(supabaseUrl, internalServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const calculate = createCore({
      authorizeRequest: async () => {
        const { data, error } = await userClient.auth.getUser(token);
        if (error || !data.user) {
          const authError = new Error('PAYROLL_UNAUTHENTICATED');
          (authError as { code?: string }).code = 'PAYROLL_UNAUTHENTICATED';
          throw authError;
        }
        return { actorId: data.user.id };
      },
      fetchCanonicalInput: async ({ payrollMonth, cutoffDate, acceptedBatchId }: JsonObject) => {
        const { data, error } = await userClient.rpc('get_payroll_calculation_input', {
          p_payroll_month: payrollMonth,
          p_cutoff_date: cutoffDate,
          p_expected_batch_id: acceptedBatchId,
        });
        if (error) {
          const code = safeErrorCode(error);
          const rpcError = new Error(code);
          (rpcError as { code?: string }).code = code;
          throw rpcError;
        }
        return data;
      },
      persistTrustedResult: async (payload: JsonObject) => {
        const { data, error } = await internalClient.rpc('private_persist_payroll_calculation', {
          p_actor_id: payload.actorId,
          p_payroll_month: payload.payrollMonth,
          p_cutoff_date: payload.cutoffDate,
          p_expected_batch_id: payload.expectedBatchId,
          p_expected_input_basis_fingerprint: payload.expectedInputBasisFingerprint,
          p_calculation_version: payload.calculationVersion,
          p_generated_at: payload.generatedAt,
          p_employee_count: payload.employeeCount,
          p_unresolved_item_count: payload.unresolvedItemCount,
          p_rate_review_count: payload.rateReviewCount,
          p_gross_pay_preview: payload.grossPayPreview,
          p_gross_pay_preview_status: payload.grossPayPreviewStatus,
          p_payable_hours_preview: payload.payableHoursPreview,
          p_employee_results: payload.employeeResults,
        });
        if (error) {
          const code = safeErrorCode(error);
          const rpcError = new Error(code);
          (rpcError as { code?: string }).code = code;
          throw rpcError;
        }
        return data;
      },
      adapter: modules.adapter,
      engine: modules.engine,
      preflight: modules.preflight,
      calculationVersion: 'payroll-engine-7day-v1',
    });

    const result = await calculate(requestBody, { correlationId });
    safeOperationalLog('payroll_calculate_completed', {
      correlation_id: correlationId,
      status: result.status || 'unknown',
      run_id: result.runId || null,
      employee_count: result.employeeCount || 0,
      unresolved_item_count: result.unresolvedItemCount || 0,
      rate_review_count: result.rateReviewCount || 0,
    });
    return responseJson(result.ok === false ? 422 : 200, { ...result, correlation_id: correlationId }, origin);
  } catch (error) {
    const code = safeErrorCode(error);
    safeOperationalLog('payroll_calculate_failed', {
      correlation_id: correlationId,
      code,
    });
    return responseJson(statusForCode(code), { ok: false, code, correlation_id: correlationId }, origin);
  }
});

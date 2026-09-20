import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (origin === "https://taejang.co.kr") return origin;
  if (/^https:\/\/deploy-preview-\d+--taejang-homepage\.netlify\.app$/.test(origin)) return origin;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return origin;
  return "https://taejang.co.kr";
}

function headers(req: Request) {
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": allowedOrigin(req),
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers(req) });
  }
  if (req.method !== "POST") {
    return json(req, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  let payload: { code?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(req, 400, { ok: false, code: "INVALID_JSON" });
  }

  const code = typeof payload.code === "string" ? payload.code.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(code)) {
    return json(req, 400, { ok: false, code: "INVALID_HANDOFF_CODE" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, 503, { ok: false, code: "HANDOFF_NOT_CONFIGURED" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const codeHash = await sha256Hex(code);
  const { data: consumed, error: consumeError } = await admin.rpc("consume_web_auth_handoff", {
    p_code_hash: codeHash,
  });

  if (consumeError) {
    console.error("web-auth-handoff consume failed", consumeError.message);
    return json(req, 500, { ok: false, code: "HANDOFF_EXCHANGE_FAILED" });
  }

  const row = Array.isArray(consumed) ? consumed[0] : null;
  const profileId = row?.profile_id;
  if (!profileId) {
    return json(req, 401, { ok: false, code: "HANDOFF_EXPIRED_OR_USED" });
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(profileId);
  const email = userData?.user?.email;
  if (userError || !email) {
    console.error("web-auth-handoff user lookup failed", userError?.message || "EMAIL_MISSING");
    return json(req, 401, { ok: false, code: "HANDOFF_USER_UNAVAILABLE" });
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: "https://taejang.co.kr/app/" },
  });

  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("web-auth-handoff magic link failed", linkError?.message || "TOKEN_HASH_MISSING");
    return json(req, 500, { ok: false, code: "HANDOFF_SESSION_TOKEN_FAILED" });
  }

  return json(req, 200, {
    ok: true,
    token_hash: tokenHash,
    type: "email",
  });
});

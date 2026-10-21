// All credentials remain in request-local memory. Never log request bodies or SDK errors.
export function numericPassword(random = crypto) {
  let value = '';
  while (value.length < 16) {
    for (const byte of random.getRandomValues(new Uint8Array(32))) {
      if (byte < 250 && value.length < 16) value += String(byte % 10);
    }
  }
  return value;
}

export function createHandler({ createClient, env, fetcher = fetch }) {
  return async req => {
    const origin = req.headers.get('origin') || '';
    const url = env('SUPABASE_URL') || '';
    const isolated = /^http:\/\/(127\.0\.0\.1|localhost|kong)(:\d+)?$/.test(url);
    const allowed = origin === 'https://taejang.co.kr'
      || (isolated && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin));
    const headers = {
      'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff', 'Vary':'Origin',
      ...(allowed ? {'Access-Control-Allow-Origin':origin} : {}),
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods':'POST, OPTIONS'
    };
    const reply = (status, code, extra = {}) => new Response(JSON.stringify({ok:status===200,code,...extra}),{status,headers});
    if (!allowed) return reply(403,'ORIGIN_FORBIDDEN');
    if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if (req.method!=='POST') return reply(405,'METHOD_NOT_ALLOWED');
    if (env('EMPLOYEE_PASSWORD_RESET_ENABLED')!=='true'
      || (!isolated && env('EMPLOYEE_SELF_CHANGE_VERIFIED')!=='true'))
      return reply(503,'RESET_NOT_READY');
    const key=env('SUPABASE_SERVICE_ROLE_KEY'), anon=env('SUPABASE_ANON_KEY');
    if(!key||!anon||!url) return reply(503,'RESET_NOT_READY');
    // Operational activation requires the approved production self-service route.
    if(!isolated) {
      try {
        const ready=await fetcher('https://taejang.co.kr/staff/change-password.html',
          {cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
        if(!ready.ok || !(await ready.text()).includes('id="change-password-form"')) return reply(503,'SELF_CHANGE_NOT_READY');
      } catch {return reply(503,'SELF_CHANGE_NOT_READY');}
    }
    const token=(req.headers.get('authorization')||'').match(/^Bearer ([^ ]+)$/)?.[1];
    if(!token)return reply(401,'LOGIN_REQUIRED');
    const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
    const admin=createClient(url,key,options);
    let requestId=null, executing=false, completed=false;
    const finish=async result=>{
      const {data,error}=await admin.rpc('finish_employee_password_reset',{p_request_id:requestId,p_result:result});
      return !error && data===true;
    };
    try {
      const {data:actorData,error:actorError}=await admin.auth.getUser(token);
      const actor=actorData?.user;
      if(actorError||!actor?.id||!actor.email)return reply(401,'LOGIN_REQUIRED');
      if(Number(req.headers.get('content-length')||0)>4096)return reply(400,'INVALID_INPUT');
      const raw=await req.text();
      if(raw.length>4096)return reply(400,'INVALID_INPUT');
      let body;
      try { body=JSON.parse(raw); } catch { return reply(400,'INVALID_INPUT'); }
      if(!body || typeof body!=='object' || Array.isArray(body))return reply(400,'INVALID_INPUT');
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if(!uuid.test(body.employee_uuid)||!uuid.test(body.profile_id)
        ||!/^TJ-[0-9]{6,}$/.test(body.employee_number)
        ||!['로그인 정보 분실','현장 로그인 지원','현장 신원 확인 후 복구'].includes(body.reason)
        ||!['random','manual'].includes(body.mode)||body.identity_verified!==true
        ||typeof body.current_password!=='string'||!body.current_password||body.current_password.length>256
        ||(body.mode==='manual' && (typeof body.temporary_password!=='string'||!/^\d{1,128}$/.test(body.temporary_password))))
        return reply(400,'INVALID_INPUT');
      const user=createClient(url,anon,{...options,global:{headers:{Authorization:'Bearer '+token}}});
      const {data:reserved,error:reserveError}=await user.rpc('reserve_employee_password_reset',{
        p_employee_uuid:body.employee_uuid,p_employee_number:body.employee_number,p_profile_id:body.profile_id,
        p_reason:body.reason.trim(),p_mode:body.mode,p_identity_verified:true
      });
      if(reserveError)return reply(403,'RESERVATION_FAILED');
      if(!reserved?.ok)return reply(reserved?.code==='RATE_LIMITED'?429:403,reserved?.code||'FORBIDDEN');
      requestId=reserved.request_id;
      // Password reauthentication is separate from the existing browser session.
      // OTP/magic-link access alone is insufficient for this sensitive action.
      const reauth=createClient(url,anon,options);
      const {data:verified,error:verifyError}=await reauth.auth.signInWithPassword({email:actor.email,password:body.current_password});
      body.current_password='';
      if(verifyError||verified?.user?.id!==actor.id||!verified?.session?.access_token){
        await finish('REAUTH_FAILED');return reply(403,'REAUTH_FAILED');
      }
      try {await reauth.auth.signOut({scope:'local'});} catch {/* ephemeral session; no credentials logged */}
      const {data:targetData,error:targetError}=await admin.auth.admin.getUserById(body.profile_id);
      const target=targetData?.user;
      if(targetError||!target?.id||target.id!==body.profile_id||!target.email_confirmed_at
        ||(target.banned_until&&new Date(target.banned_until).getTime()>Date.now())
        ||target.deleted_at||target.is_anonymous
        ||target.email?.toLowerCase()!==reserved.option?.email?.toLowerCase()){
        await finish('AUTH_UNAVAILABLE');return reply(403,'AUTH_UNAVAILABLE');
      }
      const {data:begun,error:beginError}=await user.rpc('begin_employee_password_reset',{p_request_id:requestId});
      if(beginError||!begun?.ok||begun.profile_id!==target.id||begun.email?.toLowerCase()!==target.email.toLowerCase()){
        await finish('TARGET_CHANGED');return reply(403,'TARGET_CHANGED');
      }
      executing=true;
      let password=body.mode==='manual'?body.temporary_password:numericPassword();
      body.temporary_password='';
      const {error:updateError}=await admin.auth.admin.updateUserById(target.id,{password});
      if(updateError){
        // Only explicit policy rejection proves no mutation. Other failures are ambiguous.
        const known=[400,422].includes(updateError.status);
        await finish(known?'POLICY_REJECTED':'UNKNOWN');
        password='';
        return reply(known?422:503,known?'POLICY_REJECTED':'RESULT_UNKNOWN');
      }
      completed=await finish('SUCCESS');
      if(!completed){password='';return reply(503,'RESULT_UNKNOWN');}
      const response=reply(200,'RESET_COMPLETED',{temporary_password:password,
        change_url:'https://taejang.co.kr/staff/change-password.html'});
      password='';
      return response;
    } catch {
      if(requestId&&!completed) {
        try {await finish(executing?'UNKNOWN':'AUTH_UNAVAILABLE');}catch {/* retain durable reservation */}
      }
      return reply(503,executing?'RESULT_UNKNOWN':'RESET_FAILED');
    }
  };
}

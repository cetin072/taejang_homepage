import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const CANARY = Object.freeze({
  url:'https://jgsxpdflgkqroecfjzxq.supabase.co',
  profileId:'a6436822-9618-4e45-826f-7dafca3af450',
  title:'태장 QA 자동 푸시 검수 · 2026-10-22',
});
// One-off operator client: actual password authentication and existing guarded RPC.
// No service_role, impersonated claims, direct table writes, session persistence or sending.
export async function createCanaryDraft({config,email,password,storage,request=fetch}) {
  if(config.url!==CANARY.url || !config.publishableKey) throw Error('PROJECT_MISMATCH');
  if(storage.getItem('notice-canary-attempted')) throw Error('NO_AUTOMATIC_RETRY_CHECK_SERVER');
  const call=async(path,body,token)=>{
    const response=await request(config.url+path,{method:'POST',headers:{
      apikey:config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})
    },body:JSON.stringify(body)});
    if(!response.ok) throw Error('AUTH_OR_RPC_REJECTED_'+response.status);
    return response.json();
  };
  const session=await call('/auth/v1/token?grant_type=password',{email,password});
  if(session.user?.id!==CANARY.profileId || !session.access_token) throw Error('APPROVED_ACCOUNT_REQUIRED');
  const token=session.access_token;
  const existing=await call('/rest/v1/rpc/list_manageable_notices',{p_limit:200},token);
  if(!Array.isArray(existing)) throw Error('NOTICE_LIST_UNAVAILABLE');
  const matches=existing.filter(n=>n.title===CANARY.title);
  if(matches.length) {
    if(matches.length!==1 || matches[0].target_scope!=='profile' || matches[0].target_profile_id!==CANARY.profileId) throw Error('EXISTING_SCOPE_MISMATCH');
    return {id:matches[0].id,version_no:matches[0].version_no,status:matches[0].status,reused:true};
  }
  storage.setItem('notice-canary-attempted','true');
  const now=Date.now();
  const result=await call('/rest/v1/rpc/save_notice',{
    p_notice_id:null,p_notice_kind:'general',p_importance:'important',p_title:CANARY.title,
    p_body_easy:'지정 Galaxy QA 한 대의 자동 알림 확인용입니다. 알림을 눌러 이 상세 화면이 열리는지 확인한 뒤 내용 확인 버튼을 직접 눌러 주세요.',
    p_publish_start_at:new Date(now).toISOString(),p_publish_end_at:new Date(now+86400000).toISOString(),
    p_effective_start_date:null,p_effective_end_date:null,p_location:null,p_materials_text:null,
    p_related_schedule_id:null,p_related_work_guide_id:null,p_related_link_url:null,p_related_link_label:null,
    p_requires_acknowledgement:true,p_target_scope:'profile',p_target_department_id:null,
    p_target_work_group_id:null,p_target_profile_id:CANARY.profileId,p_status:'draft',
    p_change_reason:'사용자 승인 Galaxy 한 대 자동 푸시 검수 초안; 기존 관리 RPC'
  },token);
  if(!result?.ok || !result.id) throw Error('DRAFT_SAVE_UNVERIFIED_NO_RETRY');
  return {id:result.id,version_no:result.version_no,status:'draft',reused:false};
}
export function page() {
  const script='const CANARY='+JSON.stringify(CANARY)+';'+createCanaryDraft.toString()+
    ";document.getElementById('form').addEventListener('submit',async event=>{event.preventDefault();const button=document.getElementById('submit'),status=document.getElementById('status'),password=document.getElementById('password');if(button.disabled)return;button.disabled=true;status.textContent='인증 및 개인 대상 초안 생성 중';try{const config=await(await fetch('/config')).json();const result=await createCanaryDraft({config,email:document.getElementById('email').value.trim(),password:password.value,storage:sessionStorage});status.textContent='비공개 초안 준비 완료: '+result.id+' / v'+result.version_no+' / '+result.status;document.getElementById('form').hidden=true;}catch(error){status.textContent=error.message+' — 자동으로 다시 저장하지 않습니다.';}finally{password.value='';}});";
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Galaxy 개인 대상 테스트 초안</title><style>body{font:18px sans-serif;max-width:620px;margin:40px auto;padding:20px;background:#f7faf8;color:#173629}label{display:block;margin:16px 0}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%}button{background:#236947;color:white;border:0;border-radius:8px}#status{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Galaxy 개인 대상 테스트 초안</h1><p>승인된 계정 본인 한 명 대상의 비공개 초안 1건만 기존 공지 저장 RPC로 만듭니다. 게시와 푸시 발송은 하지 않습니다.</p><p>비밀번호는 기존 태장 Supabase 인증으로만 전송하며 세션은 이 화면 메모리에만 유지합니다. 서비스 키·계정 사칭·DB 직접 쓰기를 사용하지 않습니다.</p><form id="form"><label>기존 태장 로그인 이메일<input id="email" type="email" autocomplete="username" required></label><label>비밀번호<input id="password" type="password" autocomplete="current-password" required></label><button id="submit">로그인 후 개인 대상 초안 1건 만들기</button></form><p id="status" role="status"></p><script>'+script+'</script></html>';
}
export function startServer(port=43184) {
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' "+CANARY.url+"; frame-ancestors 'none'; form-action 'none'");
    if(req.method!=='GET') {res.writeHead(405).end();return;}
    if(req.url==='/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page());return;}
    if(req.url==='/config') {
      try {
        const response=await fetch('https://taejang.co.kr/.netlify/functions/staff-config');
        const config=await response.json();
        if(config.url!==CANARY.url || !config.publishableKey) throw Error('PROJECT_MISMATCH');
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:config.url,publishableKey:config.publishableKey}));
      } catch {res.writeHead(503).end('Configuration unavailable');}
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port,'127.0.0.1',()=>console.info('Single-Galaxy draft client: http://127.0.0.1:'+port+' (loopback only; no credential logging)'));
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) startServer();

// PKCE protocol adapted from the existing Supabase auth-js 2.116.0 client.
// Own logged-in user only. No account/email/role editing and no implicit flow.
export const GOOGLE_FLOW_KEY='taejang-google-link-v1';
export const STAFF_SESSION_KEY='taejang-staff-session-v1';
const MAX_AGE=10*60*1000;
const fail=code=>Object.assign(new Error(code),{code});
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function settings(config,origin){
 let base,site;try{base=new URL(config.url);site=new URL(origin);}catch{throw fail('CONFIG_INVALID');}
 if(base.protocol!=='https:'||!/^[a-z0-9]+\.supabase\.co$/.test(base.hostname)||base.origin!==base.href.replace(/\/$/,'')||!config.publishableKey||site.protocol!=='https:'&& !['localhost','127.0.0.1'].includes(site.hostname))throw fail('CONFIG_INVALID');
 return {base:base.origin,callback:site.origin+'/staff/google-link.html'};
}
export function createGoogleIdentityFlow({config,origin,storage,readSession,saveSession,fetchImpl=fetch,cryptoImpl=crypto,now=()=>Date.now()}={}){
 const {base,callback}=settings(config,origin);
 async function request(path,token,{method='GET',body}={}){
  const response=await fetchImpl(base+path,{method,headers:{apikey:config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const code=String(data.code||data.error_code||'');throw fail(/identity_already_exists|email_exists|identity_already_linked/.test(code)?'IDENTITY_CONFLICT':response.status===401?'SESSION_REQUIRED':'GOOGLE_REQUEST_FAILED');}
  return data;
 }
 async function verified(token,actor){
  if(!token)throw fail('SESSION_REQUIRED');
  const user=await request('/auth/v1/user',token);
  if(!user?.id||user.is_anonymous||actor&&user.id!==actor)throw fail('ACCOUNT_CHANGED');
  const context=await request('/rest/v1/rpc/get_my_access_context',token,{method:'POST',body:{}});
  if(context?.id!==user.id||context.account_status!=='active')throw fail('ACCOUNT_INACTIVE');
  return user;
 }
 const clear=()=>storage.removeItem(GOOGLE_FLOW_KEY);
 return Object.freeze({
  clear,
  async begin(mode='link'){
   if(!config.googleIdentityEnabled)throw fail('GOOGLE_NOT_READY');
   if(!['link','signin'].includes(mode))throw fail('INVALID_MODE');
   const initial=readSession();
   const user=mode==='link'?await verified(initial?.access_token):null;
   const verifier=b64(cryptoImpl.getRandomValues(new Uint8Array(32)));
   const nonce=b64(cryptoImpl.getRandomValues(new Uint8Array(24)));
   const challenge=b64(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
   const redirect=new URL(callback);redirect.searchParams.set('flow',nonce);
   const pending={mode,actor:user?.id||null,existingActor:initial?.user?.id||null,verifier,nonce,createdAt:now(),base};
   storage.setItem(GOOGLE_FLOW_KEY,JSON.stringify(pending));
   const params=new URLSearchParams({provider:'google',redirect_to:redirect.href,code_challenge:challenge,code_challenge_method:'s256',prompt:'select_account',skip_http_redirect:'true'});
   try{
    if(mode==='link'){
     if(readSession()?.access_token!==initial.access_token)throw fail('ACCOUNT_CHANGED');
     const result=await request('/auth/v1/user/identities/authorize?'+params,initial.access_token);
     const url=new URL(result.url);
     if(url.protocol!=='https:'||![base,'https://accounts.google.com'].includes(url.origin)||url.username||url.password)throw fail('INVALID_AUTH_URL');
     return url.href;
    }
    // Authorize is the ordinary Supabase Auth provider endpoint, not OAuth Server.
    params.delete('skip_http_redirect');
    return base+'/auth/v1/authorize?'+params;
   }catch(error){clear();throw error;}
  },
  async complete(callbackUrl){
   const url=new URL(callbackUrl);
   let pending;try{pending=JSON.parse(storage.getItem(GOOGLE_FLOW_KEY)||'null');}catch{}
   clear(); // Single attempt; replay/new callbacks require a new local flow.
   if(!config.googleIdentityEnabled)throw fail('GOOGLE_NOT_READY');
   if(!pending||!Number.isFinite(pending.createdAt)||!/^[A-Za-z0-9_-]{43}$/.test(pending.verifier||'')||pending.base!==base||url.origin!==new URL(callback).origin||!['/staff/google-link.html','/staff/google-link'].includes(url.pathname)||url.searchParams.get('flow')!==pending.nonce||now()-pending.createdAt>MAX_AGE||now()<pending.createdAt||!['link','signin'].includes(pending.mode))throw fail('FLOW_INVALID');
   if(url.hash)throw fail('IMPLICIT_CALLBACK_REJECTED');
   if(url.searchParams.has('error'))throw fail('GOOGLE_CANCELLED');
   const code=url.searchParams.get('code');if(!code||code.length>4096)throw fail('CALLBACK_INVALID');
   const before=readSession();
   if(pending.mode==='link'&&before?.user?.id!==pending.actor||pending.mode==='signin'&&(before?.user?.id||null)!==pending.existingActor)throw fail('ACCOUNT_CHANGED');
   if(pending.mode==='link')await verified(before?.access_token,pending.actor);
   const fresh=await request('/auth/v1/token?grant_type=pkce',null,{method:'POST',body:{auth_code:code,code_verifier:pending.verifier}});
   const user=await verified(fresh.access_token,pending.mode==='link'?pending.actor:null);
   if(!user.identities?.some(i=>i.provider==='google'))throw fail('GOOGLE_IDENTITY_MISSING');
   if(readSession()?.access_token!==before?.access_token||pending.mode==='link'&&user.id!==pending.actor)throw fail('ACCOUNT_CHANGED');
   // Preserve the original ERP session until both Auth and active Profile pass.
   const safe={access_token:fresh.access_token,refresh_token:fresh.refresh_token,expires_at:fresh.expires_at,expires_in:fresh.expires_in,token_type:fresh.token_type,user};
   if(!safe.refresh_token)throw fail('CALLBACK_INVALID');
   saveSession(safe);
   return {userId:user.id,mode:pending.mode};
  }
 });
}

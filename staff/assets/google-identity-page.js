import {createGoogleIdentityFlow,STAFF_SESSION_KEY,GOOGLE_FLOW_KEY} from './google-identity-api.mjs';
const el=id=>document.getElementById(id);
const url=new URL(location.href);
const callback=url.searchParams.has('code')||url.searchParams.has('error')||Boolean(url.hash);
// Remove auth artifacts before network requests, DOM rendering, or navigation.
history.replaceState(null,'',location.pathname+(url.searchParams.get('mode')==='signin'?'?mode=signin':''));
const copy={GOOGLE_NOT_READY:'Google 로그인 연결을 준비 중입니다. 기존 이메일 로그인을 이용해 주세요.',SESSION_REQUIRED:'태장에 먼저 로그인한 뒤 연결해 주세요.',FLOW_INVALID:'연결 시간이 지났거나 올바른 연결 요청이 아닙니다. 다시 시작해 주세요.',ACCOUNT_CHANGED:'로그인 계정이 바뀌어 연결을 중단했습니다. 기존 로그인으로 다시 확인해 주세요.',ACCOUNT_INACTIVE:'활성 태장 계정만 이용할 수 있습니다.',IDENTITY_CONFLICT:'이 Google 주소의 기존 계정을 먼저 확인해야 합니다. 자동으로 합치지 않았습니다.',GOOGLE_CANCELLED:'Google 연결을 취소했습니다. 기존 이메일 로그인은 유지됩니다.',GOOGLE_IDENTITY_MISSING:'Google 연결을 확인하지 못했습니다. 기존 이메일 로그인으로 확인해 주세요.'};
const read=()=>{try{return JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||sessionStorage.getItem(STAFF_SESSION_KEY)||'null');}catch{return null;}};
let flow;
el('google-cancel').addEventListener('click',()=>{sessionStorage.removeItem(GOOGLE_FLOW_KEY);location.assign('../app/');});
try{
 const response=await fetch('/.netlify/functions/staff-config',{cache:'no-store'});if(!response.ok)throw Error('CONFIG_INVALID');const config=await response.json();
 flow=createGoogleIdentityFlow({config,origin:location.origin,storage:sessionStorage,readSession:read,saveSession:session=>{localStorage.setItem(STAFF_SESSION_KEY,JSON.stringify(session));sessionStorage.removeItem(STAFF_SESSION_KEY);}});
 if(callback){const result=await flow.complete(url.href);el('google-message').textContent=result.mode==='link'?'Google 계정 연결을 확인했습니다. 대시보드로 돌아갑니다.':'Google 로그인을 확인했습니다. 대시보드로 이동합니다.';location.replace('../app/');}
 else{
  const mode=url.searchParams.get('mode')==='signin'?'signin':'link';
  el('google-title').textContent=mode==='signin'?'Google로 로그인':'Google 로그인 연결';
  el('google-start').textContent=mode==='signin'?'Google로 로그인':'Google 계정 연결';
  if(mode==='signin')el('google-help').textContent='기존 태장 계정에 연결한 Google 계정으로 로그인합니다.';
  el('google-start').disabled=!config.googleIdentityEnabled;
  el('google-message').textContent=config.googleIdentityEnabled?'본인의 Google 계정을 선택해 주세요.':copy.GOOGLE_NOT_READY;
  el('google-start').addEventListener('click',async()=>{el('google-start').disabled=true;try{location.assign(await flow.begin(mode));}catch(error){el('google-message').textContent=copy[error.code]||'연결을 완료하지 못했습니다. 기존 이메일 로그인은 유지됩니다.';el('google-start').disabled=!config.googleIdentityEnabled;}});
 }
}catch(error){el('google-message').textContent=copy[error.code]||'연결 상태를 확인하지 못했습니다. 기존 이메일 로그인으로 다시 확인해 주세요.';}

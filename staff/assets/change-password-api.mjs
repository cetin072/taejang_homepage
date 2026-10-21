// Employee self-service only: use own login and own Auth token; never persist or log credentials.
export function validateChange(values) {
 const email=String(values?.email||'').trim().toLowerCase();
 const current=String(values?.current||''), next=String(values?.next||''), confirm=String(values?.confirm||'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('EMAIL_INVALID');
 if(!current)throw Error('CURRENT_REQUIRED');
 if(next.length<8)throw Error('TOO_SHORT');
 if(next===current)throw Error('MUST_DIFFER');
 if(next!==confirm)throw Error('NOT_EQUAL');
 return {email,current,next};
}
export async function changePassword(values,config,fetcher=fetch) {
 const {email,current,next}=validateChange(values);
 let base;try{base=new URL(String(config?.url||''));}catch{throw Error('CONFIG_INVALID');}
 if(base.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/i.test(base.hostname)||base.port
 ||base.pathname!=='/'||base.search||base.hash||base.username||base.password
 ||typeof config?.publishableKey!=='string'||!config.publishableKey)throw Error('CONFIG_INVALID');
 const headers={apikey:config.publishableKey,'Content-Type':'application/json'};
 const call=async(path,opt)=>{
   const c=new AbortController(),timeout=setTimeout(()=>c.abort(),10000);
   try{return await fetcher(base.origin+path,{...opt,credentials:'omit',cache:'no-store',redirect:'error',signal:c.signal});}
   finally{clearTimeout(timeout);}
 };
 let login;try{login=await call('/auth/v1/token?grant_type=password',{method:'POST',headers,body:JSON.stringify({email,password:current})});}
 catch{throw Error('NETWORK');}
 if(login.status===429)throw Error('RATE_LIMIT');
 if(!login.ok)throw Error('BAD_LOGIN');
 let token;try{token=(await login.json())?.access_token;}catch{throw Error('NO_SESSION');}
 if(typeof token!=='string'||token.length<32)throw Error('NO_SESSION');
 const privateHeaders={...headers,Authorization:'Bearer '+token};
 try {
   let update;try{update=await call('/auth/v1/user',{method:'PUT',headers:privateHeaders,body:JSON.stringify({password:next,current_password:current})});}
   catch{throw Error('NETWORK');}
   if(update.status===429)throw Error('RATE_LIMIT');
   if(update.status===400||update.status===422)throw Error('NEW_PASSWORD_REJECTED');
   if(!update.ok)throw Error('UPDATE_FAILED');
   return true;
 }finally{
   try{await call('/auth/v1/logout?scope=local',{method:'POST',headers:privateHeaders});}
   catch{/* never hide original update result */}
 }
}

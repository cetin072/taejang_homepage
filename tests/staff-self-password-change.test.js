'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const values={email:'someone@example.org',current:'example-current',next:'example-new-strong',confirm:'example-new-strong'};
const config={url:'https://test-project.supabase.co',publishableKey:'test-publishable'};
test('staff login exposes email-free self-change and accessible fields',()=>{
 assert.match(read('staff/index.html'),/href="change-password\.html"/);
 const html=read('staff/change-password.html');
 for(const n of ['email','current_password','new_password','confirm_password'])assert.match(html,new RegExp('name="'+n+'"'));
 assert.match(html,/aria-live="polite"/);assert.match(html,/이메일을 열지 않고/);
 assert.doesNotMatch(read('staff/assets/change-password-api.mjs'),/localStorage|sessionStorage|service_role|auth\.admin/i);
});
test('own password grant, change and revoke only, never use privileged endpoints',async()=>{
 const {changePassword}=await import('../staff/assets/change-password-api.mjs');
 const calls=[];const fetcher=async(u,opt)=>{calls.push({u,opt});return u.includes('grant_type=password')
  ? new Response(JSON.stringify({access_token:'s'.repeat(40)}),{status:200})
  :new Response('{}',{status:200});};
 assert.equal(await changePassword(values,config,fetcher),true);
 assert.equal(calls.length,3);
 assert.match(calls[0].u,/grant_type=password/);
 assert.deepEqual(JSON.parse(calls[1].opt.body),{password:values.next,current_password:values.current});
 assert.equal(calls[1].opt.headers.Authorization,'Bearer '+'s'.repeat(40));
 assert.match(calls[2].u,/logout/);
 for(const x of calls){assert.equal(x.opt.credentials,'omit');assert.equal(x.opt.cache,'no-store');}
});
test('invalid input cannot trigger Auth requests',async()=>{
 const {changePassword}=await import('../staff/assets/change-password-api.mjs');let count=0;
 const fetcher=()=>{count++;throw Error('unexpected fetch');};
 for(const part of [{email:'bad'},{next:'short',confirm:'short'},{next:values.current,confirm:values.current},{confirm:'not-equal'}])
 await assert.rejects(changePassword({...values,...part},config,fetcher));
 assert.equal(count,0);
});
test('login rejection never calls update',async()=>{
 const {changePassword}=await import('../staff/assets/change-password-api.mjs');let count=0;
 await assert.rejects(changePassword(values,config,async()=>{count++;return new Response('{}',{status:400});}),/BAD_LOGIN/);
 assert.equal(count,1);
});
test('reject new password on server error, and try logout',async()=>{
 const {changePassword}=await import('../staff/assets/change-password-api.mjs');const seen=[];
 await assert.rejects(changePassword(values,config,async u=>{seen.push(u);return u.includes('grant_type=password')
  ?new Response(JSON.stringify({access_token:'x'.repeat(40)}),{status:200}):new Response('{}',{status:422});}),/NEW_PASSWORD_REJECTED/);
 assert.equal(seen.length,3);assert.match(seen[2],/logout/);
});
test('reject non-HTTPS or other-origin auth configuration',async()=>{
 const {changePassword}=await import('../staff/assets/change-password-api.mjs');
 for(const url of ['http://test-project.supabase.co','https://evil.example.org','https://test-project.supabase.co/other','https://test-project.supabase.co:1234'])
 await assert.rejects(changePassword(values,{...config,url},async()=>{throw Error('not reachable');}),/CONFIG_INVALID/);
});

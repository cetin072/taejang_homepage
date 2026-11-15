import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createERPDatabase,OPS,WORKER} from './helpers/erp-sales-isolated-db.mjs';
const C=createRequire(import.meta.url)('../app/assets/logistics-core.js');
const db=await createERPDatabase();let passed=0;
const ok=(condition,label)=>{assert.ok(condition,label);passed++;console.log('PASS',label)};
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const rpc=(fn,args,{actor=OPS,role='authenticated'}={})=>JSON.parse(db.sql(`select public.${fn}(${args});`,{actor,role}));
const read=(actor=OPS)=>rpc('get_logistics_workspace','',{actor});
const mutate=(action,payload,id=randomUUID(),actor=OPS)=>rpc('mutate_logistics_workspace',`'${id}'::uuid,'${action}',${literal(payload)}`,{actor});
const rejects=(fn,re,label)=>{assert.throws(fn,re);passed++;console.log('PASS',label)};
try{
 const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('_logistics_workspace.sql'));
 db.raw(readFileSync(files.length?'supabase/migrations/'+files[files.length-1]:'supabase/sql/logistics_workspace.sql','utf8'));
 // Existing isolated fixture supplies real role/capability foundation, not hosted accounts.
 const roles=['department_lead','promotion_lead','ceo','field_lead','super_admin'];const actors={};
 for(const role of roles){const id=randomUUID();actors[role]=id;db.raw(`insert into public.roles(code,name) select '${role}','Synthetic ${role}' where not exists(select 1 from public.roles where code='${role}');insert into public.profiles values('${id}','Synthetic ${role}','active');insert into public.profile_roles select '${id}',id,null from public.roles where code='${role}';`);}
 for(const role of ['department_lead','promotion_lead','ceo'])ok(Array.isArray(read(actors[role]).customers),role+' can use logistics');
 for(const who of [WORKER,actors.field_lead,actors.super_admin])rejects(()=>read(who),/LOGISTICS_FORBIDDEN/,'lower/system-only role blocked');
 rejects(()=>rpc('get_logistics_workspace','',{role:'anon',actor:null}),/permission denied/,'anonymous RPC blocked');
 rejects(()=>db.sql('select * from logistics_private.entries;'),/permission denied/,'direct ledger access blocked');
 const customer=mutate('customer.save',{name:'Synthetic Logistics',phone:'',memo:'test only'}).customer;
 const getBalance=()=>read().customers.find(c=>c.id===customer.id).balance;
 const depositId=randomUUID(),deposit={customerId:customer.id,amount:50000,memo:'Synthetic received payment'};
 mutate('wallet.deposit',deposit,depositId);mutate('wallet.deposit',deposit,depositId);ok(Number(getBalance())===50000,'deposit retry exactly once');
 rejects(()=>mutate('wallet.deposit',{...deposit,amount:40000},depositId),/LOGISTICS_REQUEST_REUSE/,'idempotency key cannot be reused for different input');
 const q=C.draft();q.customerId=customer.id;const confirmed=mutate('quote.confirm',{quote:q}).quote;ok(confirmed.total===6864,'server recalculates v8 quote');ok(Number(getBalance())===50000,'confirmation does not charge');
 const chargeId=randomUUID();mutate('wallet.charge',{quoteId:confirmed.id},chargeId);mutate('wallet.charge',{quoteId:confirmed.id},chargeId);ok(Number(getBalance())===43136,'quote charged once on retry');
 rejects(()=>mutate('wallet.charge',{quoteId:confirmed.id}),/LOGISTICS_DUPLICATE_CHARGE/,'fresh request cannot double charge same quote');
 rejects(()=>mutate('wallet.manual',{customerId:customer.id,amount:100000,memo:'Synthetic too high'}),/LOGISTICS_FUNDS/,'insufficient balance blocks debit');
 rejects(()=>mutate('wallet.reverse',{entryId:depositId,reason:'Synthetic deposit error'}),/LOGISTICS_FUNDS/,'cannot reverse spent deposit into negative balance');
 mutate('wallet.reverse',{entryId:chargeId,reason:'Synthetic correction'});ok(Number(getBalance())===50000,'reversal restores balance without erasing original');
 rejects(()=>mutate('wallet.reverse',{entryId:chargeId,reason:'Synthetic duplicate'}),/LOGISTICS_REVERSED/,'double reversal blocked');
 rejects(()=>mutate('wallet.charge',{quoteId:confirmed.id}),/LOGISTICS_DUPLICATE_CHARGE/,'reversed quote cannot be silently recharged');
 mutate('customer.save',{id:customer.id,name:'Synthetic renamed',phone:'',memo:'',revision:1});
 ok(read().quotes.find(r=>r.id===confirmed.id).snapshot.customerName==='Synthetic Logistics','customer rename preserves historical document');
 rejects(()=>mutate('customer.save',{id:customer.id,name:'Stale',revision:1}),/LOGISTICS_CONFLICT/,'stale customer edit rejected');
 rejects(()=>db.raw(`update logistics_private.quotes set total=1 where id='${confirmed.id}';`),/LOGISTICS_IMMUTABLE/,'confirmed quote immutable even for owner writes');
 rejects(()=>db.raw(`delete from logistics_private.entries where id='${chargeId}';`),/LOGISTICS_IMMUTABLE/,'ledger originals immutable');
 const vectors=[];for(const mode of ['inclusive','exclusive'])for(const shelves of [0,1,2,5])for(const start of [1,3,4]){const x=C.draft();x.vatMode=mode;x.storage={shelves,startMonth:start,months:3,rate:15000};x.feeEnabled=true;x.feeRate=12.34;x.discount=123;vectors.push(x);}
 for(const vector of vectors){const expected=C.calculate(vector),actual=JSON.parse(db.raw(`select logistics_private.calculate(${literal(vector)});`));for(const key of ['subtotal','supply','vat','platform','total','storageAmount'])assert.equal(actual[key],expected[key],key);}
 ok(true,'48 SQL and JS pricing vectors match');
 const invalid=C.draft();invalid.lines[0].unitPrice=999;rejects(()=>mutate('quote.confirm',{quote:{...invalid,customerId:customer.id}}),/LOGISTICS_INVALID/,'free item price manipulation rejected');
 db.raw(`insert into public.role_simulation_modes(profile_id,role_code,expires_at) values('${OPS}','promotion_lead',now()+interval '1 hour');`);rejects(()=>read(),/LOGISTICS_FORBIDDEN/,'role simulation cannot operate ledger');db.raw(`delete from public.role_simulation_modes where profile_id='${OPS}';`);
 db.raw(`update public.profiles set account_status='suspended' where id='${actors.department_lead}';`);rejects(()=>read(actors.department_lead),/LOGISTICS_FORBIDDEN/,'suspension revokes server access immediately');
 // Two simultaneous workers attempt to spend the same available balance.
 const concurrent=mutate('customer.save',{name:'Synthetic Concurrent'}).customer;mutate('wallet.deposit',{customerId:concurrent.id,amount:10000,memo:'Synthetic concurrency seed'});
 const exec=promisify(execFile),run=()=>exec('docker',['exec',db.name,'psql','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1','-c',`set role authenticated;select set_config('request.jwt.claim.sub','${OPS}',false);select public.mutate_logistics_workspace('${randomUUID()}'::uuid,'wallet.manual',${literal({customerId:concurrent.id,amount:7000,memo:'Synthetic concurrent debit'})});`]);
 const results=await Promise.allSettled([run(),run()]);ok(results.filter(r=>r.status==='fulfilled').length===1,'exactly one concurrent debit succeeds');ok(results.some(r=>r.status==='rejected'&&/LOGISTICS_FUNDS/.test(String(r.reason?.stderr))),'other concurrent debit rejected for funds');ok(Number(read().customers.find(c=>c.id===concurrent.id).balance)===3000,'concurrent balance never goes negative');
 ok(Number(db.raw('select count(*) from logistics_private.audit;'))>0,'audit records written');
 console.log(`PASS ${passed} logistics database checks`);
}finally{db.stop();}

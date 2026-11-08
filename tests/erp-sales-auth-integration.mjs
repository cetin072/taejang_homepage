// Real Auth + PostgREST against the existing isolated Supabase CI stack only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const url=process.env.SUPABASE_URL||process.env.API_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.ANON_KEY;
assert.ok(url&&key,'local Supabase required');assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'hosted ERP fixtures forbidden');
const project=process.env.SUPABASE_PROJECT_ID||'taejang-homepage-phase1a';assert.equal(project,'taejang-homepage-phase1a');let count=0;
const check=(ok,label)=>{assert.ok(ok,label);count++;};
function sql(s){const id=execFileSync('docker',['ps','--filter','name=supabase_db_'+project,'--format','{{.ID}}'],{encoding:'utf8'}).trim();assert.ok(id);return execFileSync('docker',['exec','-i',id,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8'}).trim();}
async function api(path,{token,body,method='POST'}={}){const r=await fetch(url+path,{method,headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {ok:r.ok,status:r.status,data:await r.json()};}
const rpc=(name,actor,params={})=>api('/rest/v1/rpc/'+name,{token:actor?.token,body:params});
async function account(role){const r=await api('/auth/v1/signup',{body:{email:'erp-'+role+'-'+crypto.randomUUID()+'@example.test',password:crypto.randomUUID()+'-Aa1!',data:{display_name:'Synthetic ERP '+role}}});check(r.ok&&r.data.user?.id&&r.data.access_token,'synthetic signup '+role);const id=r.data.user.id;sql(`update public.profiles set account_status='active',approved_at=now(),status_changed_at=now(),status_changed_by='${id}' where id='${id}';insert into public.profile_roles(profile_id,role_id,scope_type,granted_by) select '${id}',id,'company','${id}' from public.roles where code='${role}';`);return {id,token:r.data.access_token};}
const ops=await account('operations_manager'),worker=await account('general_worker');
const must=async(name,params={})=>{const r=await rpc(name,ops,params);check(r.ok,name+' succeeds');return r.data;};
const master=(kind,data)=>must('erp_sales_save_master',{p_kind:kind,p_data:data});
const company=await master('party',{name:'Synthetic Auth Corporate',kind:'company',business_number:'5555555555',relationships:['customer','supplier']});
const person=await master('party',{name:'Synthetic Auth Person',kind:'individual',relationships:['customer']});
const item=await master('item',{code:'AUTH-SALT',name:'Synthetic Auth Salt',kind:'product',unit:'포',tax_class:'taxable'});
const service=await master('item',{code:'AUTH-SERVICE',name:'Synthetic Auth Cleanup',kind:'service',unit:'월',tax_class:'taxable'});
const contract=await master('contract',{party_id:company.id,item_id:service.id,title:'Synthetic Auth Annual',starts_on:'2097-01-01',ends_on:'2097-12-31',monthly_supply:50000,monthly_tax:5000,tax_class:'taxable',billing_basis:'월말 청구',status:'active'});
const month=await must('erp_sales_generate_month',{p_contract_id:contract.id,p_month:'2097-01-01'});
check(month.total_amount===55000,'actual contract total saved through Data API');
const saleInput={request_key:crypto.randomUUID(),kind:'product',party_id:person.id,supplier_id:company.id,order_date:'2097-02-01',sales_date:'2097-02-01',order_channel:'phone',shipping_status:'preparing',commission:{kind:'none',value:0,settlement_rule:'after_full_payment'},lines:[{item_id:item.id,quantity:2,unit_price:1000,tax_class:'taxable',tax_amount:200}]};
const sale=await must('erp_sales_save',{p_data:saleInput});check(sale.total_amount===2200,'actual individual order saved');
const replay=await must('erp_sales_save',{p_data:saleInput});check(replay.id===sale.id,'HTTP retry deduplicates an order');
await must('erp_sales_confirm',{p_id:sale.id,p_revision:sale.revision});
const overwrite=await rpc('erp_sales_save',ops,{p_data:saleInput,p_id:sale.id,p_revision:sale.revision+1});check(!overwrite.ok&&JSON.stringify(overwrite.data).includes('ERP_SALE_CONFIRMED'),'confirmed record cannot be overwritten through API');
const reread=await must('erp_sales_get',{p_id:sale.id});check(reread.status==='confirmed'&&reread.lines[0].unit_price===1000,'real HTTP reread returns confirmed snapshot');
await must('erp_sales_confirm',{p_id:month.id,p_revision:month.revision});
const adjustmentId=crypto.randomUUID();
await must('erp_sales_request_adjustment',{p_sale_id:month.id,p_request_id:adjustmentId,p_kind:'service_change',p_reason:'Synthetic Auth amount approval',p_detail:{amount:50000}});
const approval={p_sale_id:month.id,p_adjustment_id:adjustmentId,p_request_id:crypto.randomUUID(),p_on:sql("select (now() at time zone 'Asia/Seoul')::date;"),p_note:'Synthetic Auth apply amount'};
check((await rpc('erp_sales_approve_amount_adjustment',worker,approval)).status===403,'worker denied actual amount approval');
check(!(await rpc('erp_sales_approve_amount_adjustment',null,approval)).ok,'anonymous denied actual amount approval');
await must('erp_sales_approve_amount_adjustment',approval);
await must('erp_sales_approve_amount_adjustment',approval);
const position=await must('erp_sales_get_receipts',{p_sale_id:month.id});
check(position.effective_total===50000&&position.balance===50000,'HTTP approval applies target amount once');
check((await must('erp_sales_get',{p_id:month.id})).total_amount===55000,'HTTP approval preserves the original confirmed amount');
const adjustments=await must('erp_sales_list_adjustments',{p_sale_id:month.id});
check(adjustments.find(x=>x.id===adjustmentId).events[0].sales_delta===-5000,'HTTP approval exposes the exact financial effect');
for(const [name,params] of [['erp_sales_bootstrap',{}],['erp_sales_list',{p_from:'2097-01-01',p_to:'2097-12-31'}],['erp_sales_get',{p_id:sale.id}],['erp_sales_save',{p_data:saleInput}],['erp_sales_save_master',{p_kind:'agent',p_data:{name:'Denied'}}],['erp_sales_confirm',{p_id:month.id,p_revision:month.revision}],['erp_sales_shipping',{p_id:sale.id,p_status:'delivered'}]]){const denied=await rpc(name,worker,params);check(denied.status===403,'worker denied '+name);}
for(const table of ['erp_sales_parties','erp_sales_agents','erp_sales_items','erp_sales_contracts','erp_sales_transactions','erp_sales_lines','erp_sales_history','erp_sales_assignments']){const denied=await api('/rest/v1/'+table+'?select=*',{token:worker.token,method:'GET'});check(denied.ok&&denied.data.length===0,'RLS read denied '+table);}
const anonymous=await rpc('erp_sales_bootstrap',null);check(!anonymous.ok,'anonymous RPC denied');
const direct=await api('/rest/v1/erp_sales_transactions?id=eq.'+sale.id,{method:'PATCH',token:ops.token,body:{total_amount:1}});check(!direct.ok,'direct table mutation cannot bypass RPC validation');
const simulated=await rpc('set_role_simulation_mode',ops,{p_role_code:'promotion_staff'});check(simulated.ok,'existing lower-role simulation starts');check((await rpc('erp_sales_bootstrap',ops)).status===403,'simulation cannot retain ERP financial access');await rpc('set_role_simulation_mode',ops,{p_role_code:'actual'});
check((await must('erp_sales_list',{p_from:'2097-01-01',p_to:'2097-12-31'})).total===2,'exact two persisted transactions through API');
console.log('ERP_REAL_AUTH_PASS '+count+' assertions');

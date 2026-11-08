// Financial balance changes and migration compatibility: isolated synthetic PG17 only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createERPDatabase,OPS,WORKER} from './helpers/erp-sales-isolated-db.mjs';
const db=await createERPDatabase({amountAdjustments:false});let count=0;
const check=(ok,label)=>{assert.ok(ok,label);count++;};
const reject=(fn,pattern)=>{assert.throws(fn,pattern);count++;};
const call=(name,params={})=>db.rpc(name,params);
const save=(kind,data)=>call('erp_sales_save_master',{p_kind:kind,p_data:data});
const request=(sale,kind,detail)=>{
 const id=randomUUID();call('erp_sales_request_adjustment',{p_sale_id:sale.id,p_request_id:id,p_kind:kind,
  p_reason:'Synthetic amount adjustment',p_detail:detail});return id;
};
const on=db.raw("select (now() at time zone 'Asia/Seoul')::date;");
const decision=(sale,id,action='approve')=>call('erp_sales_record_adjustment_event',{
 p_sale_id:sale.id,p_adjustment_id:id,p_request_id:randomUUID(),p_action:action,p_on:on,p_note:'Synthetic decision',p_amount:null
});
const approveParams=(sale,id)=>({p_sale_id:sale.id,p_adjustment_id:id,p_request_id:randomUUID(),p_on:on,p_note:'Synthetic amount approval'});
const approve=p=>call('erp_sales_approve_amount_adjustment',p);
const position=sale=>call('erp_sales_get_receipts',{p_sale_id:sale.id});
const collect=(sale,amount)=>call('erp_sales_record_receipt',{p_sale_id:sale.id,p_request_id:randomUUID(),p_recorded_on:on,p_amount:amount});
try{
 const party=save('party',{name:'Synthetic Amount Customer',kind:'company',business_number:'9999999999',relationships:['customer','supplier']});
 const service=save('item',{code:'AMOUNT-SVC',name:'Synthetic Amount Service',kind:'service',unit:'월',tax_class:'taxable'});
 const item=save('item',{code:'AMOUNT-PROD',name:'Synthetic Amount Product',kind:'product',unit:'개',tax_class:'taxable'});
 const contract=save('contract',{party_id:party.id,item_id:service.id,title:'Synthetic Amount Contract',
  starts_on:'2020-01-01',ends_on:'2099-12-31',monthly_supply:50000,monthly_tax:5000,tax_class:'taxable',billing_basis:'monthly',status:'active'});
 const draft=call('erp_sales_generate_month',{p_contract_id:contract.id,p_month:on.slice(0,7)+'-01'});
 const sale=call('erp_sales_confirm',{p_id:draft.id,p_revision:draft.revision});
 const old=request(sale,'service_change',{amount:50000});decision(sale,old);
 const pending=request(sale,'service_change',{amount:45000});
 check(position(sale).effective_total===55000,'legacy approval was record-only before migration');
 db.raw(readFileSync('supabase/migrations/20261108115308_erp_sales_apply_amount_adjustments.sql','utf8'));
 db.raw(readFileSync('supabase/migrations/20261108225909_erp_sales_list_effective_amounts.sql','utf8'));
 check(position(sale).effective_total===55000,'migration never reinterprets historical approvals');
 check(call('erp_sales_list_adjustments',{p_sale_id:sale.id}).find(x=>x.id===old).events[0].sales_delta===null,'legacy approvals carry an explicit null effect');
 check(call('erp_sales_amount_adjustments_ready')===true,'new backend readiness is available to ERP reader');
 check(db.rpc('erp_sales_amount_adjustments_ready',{}, {actor:WORKER})===false,'readiness does not grant worker access');
 const first=approveParams(sale,pending);
 reject(()=>db.rpc('erp_sales_approve_amount_adjustment',first,{actor:WORKER}),/ERP_FORBIDDEN/);
 reject(()=>db.sql('select public.erp_sales_approve_amount_adjustment(null,null,null,null,null);',{role:'anon',actor:null}),/permission denied/);
 check(position(sale).effective_total===55000,'pending amount changes never alter balances');
 collect(sale,20000);approve(first);
 check(position(sale).effective_total===45000&&position(sale).balance===25000,'approval changes a partially collected balance');
 const listed=call('erp_sales_list',{p_from:on.slice(0,7)+'-01',p_to:sale.sales_date,p_party_id:party.id}).items.find(x=>x.id===sale.id);
 check(listed.total_amount===55000&&listed.effective_total===45000,'sales list exposes current and original amounts together');
 check(call('erp_sales_list_receivables',{p_party_id:party.id}).items[0].balance===25000,'receivable list shares the applied total');
 approve(first);
 check(position(sale).balance===25000,'retry does not apply the amount delta twice');
 reject(()=>approve({...first,p_note:'different note'}),/ERP_REQUEST_REUSE/);
 reject(()=>approve({...first,p_request_id:randomUUID()}),/ERP_ADJUSTMENT_DUPLICATE/);
 const raised=request(sale,'service_change',{amount:50000});const raisedParams=approveParams(sale,raised);approve(raisedParams);
 check(position(sale).balance===30000,'a second target total replaces the effective amount without replacing the original');
 approve(first);
 check(position(sale).effective_total===50000,'retrying an earlier approval cannot restore an obsolete total');
 collect(sale,30000);
 const reduced=request(sale,'service_change',{amount:30000});approve(approveParams(sale,reduced));
 check(position(sale).balance===0&&position(sale).overpaid===20000&&position(sale).received===50000,'reduction after full collection shows overpayment and preserves receipts');
 reject(()=>collect(sale,1),/ERP_RECEIPT_OVER_BALANCE/);
 const increased=request(sale,'service_change',{amount:60000});approve(approveParams(sale,increased));
 check(position(sale).balance===10000&&position(sale).overpaid===0,'increased sale creates the correct new receivable');
 const zero=request(sale,'service_change',{amount:0});approve(approveParams(sale,zero));
 check(position(sale).effective_total===0&&position(sale).overpaid===50000,'zero total is supported without altering collected money');
 const rejected=request(sale,'service_change',{amount:100});decision(sale,rejected,'reject');
 reject(()=>approve(approveParams(sale,rejected)),/ERP_ADJUSTMENT_DUPLICATE/);
 check(position(sale).effective_total===0,'rejection does not change the effective total');
 const legacyAfter=request(sale,'service_change',{amount:100});decision(sale,legacyAfter);
 check(position(sale).effective_total===0,'old clients remain explicitly record-only after migration');
 check(call('erp_sales_get',{p_id:sale.id}).total_amount===55000,'original confirmed service total is immutable');
 const productInput={kind:'product',request_key:randomUUID(),party_id:party.id,supplier_id:party.id,
  order_date:on,sales_date:on,order_channel:'phone',shipping_status:'preparing',commission:{kind:'none',value:0,settlement_rule:'after_full_payment'},
  lines:[{item_id:item.id,quantity:10,unit_price:1000,tax_class:'taxable',tax_amount:0}]};
 const productDraft=call('erp_sales_save',{p_data:productInput});
 const product=call('erp_sales_confirm',{p_id:productDraft.id,p_revision:productDraft.revision});
 call('erp_sales_shipping',{p_id:product.id,p_status:'delivered'});
 const returned=request(product,'return_goods',{line_id:product.lines[0].id,quantity:2,credit_amount:2000,refund_plan:0});decision(product,returned);
 check(position(product).effective_total===8000,'return before amount approval reduces the current total');
 const price=request(product,'sales_change',{amount:7000});approve(approveParams(product,price));
 check(position(product).effective_total===7000,'target total after a prior return does not deduct that return twice');
 const laterReturn=request(product,'return_goods',{line_id:product.lines[0].id,quantity:1,credit_amount:1000,refund_plan:0});decision(product,laterReturn);
 check(position(product).effective_total===6000,'a later return reduces the newly approved amount');
 const laterPrice=request(product,'sales_change',{amount:6500});approve(approveParams(product,laterPrice));
 check(position(product).effective_total===6500,'repeated amount approval includes all earlier return credits exactly once');
 reject(()=>approve(approveParams(product,returned)),/ERP_ADJUSTMENT_INVALID_INPUT/);
 const productRaw=call('erp_sales_get',{p_id:product.id});
 check(productRaw.total_amount===10000&&productRaw.lines[0].quantity===10,'amount/return adjustments preserve original product and quantity');
 const cancelledDraft=call('erp_sales_save',{p_data:{...productInput,request_key:randomUUID()}});
 const cancelled=call('erp_sales_confirm',{p_id:cancelledDraft.id,p_revision:cancelledDraft.revision});
 decision(cancelled,request(cancelled,'cancel_order',{refund_plan:0}));
 const revive=request(cancelled,'sales_change',{amount:5000});
 reject(()=>approve(approveParams(cancelled,revive)),/ERP_ADJUSTMENT_CANCELLED_SALE/);
 check(position(cancelled).effective_total===0,'amount adjustment cannot revive a cancelled sale');
 const closed=request(sale,'service_change',{amount:60000});
 const setMonth=closed=>call('erp_sales_set_month_close',{p_month:on.slice(0,7)+'-01',p_request_id:randomUUID(),p_closed:closed,p_expected_closed:!closed,p_reason:'Synthetic amount period control'});
 setMonth(true);reject(()=>approve(approveParams(sale,closed)),/ERP_PERIOD_CLOSED/);
 check(position(sale).effective_total===0,'closed-month failure is atomic');
 setMonth(false);approve(approveParams(sale,closed));
 check(position(sale).effective_total===60000,'an open month permits the pending amount approval');
 // Both approvals can start together, but must calculate their deltas under the same sale lock.
 const concurrent=[40000,45000].map(amount=>approveParams(sale,request(sale,'service_change',{amount})));
 const exec=promisify(execFile);const wsl=process.env.ERP_DOCKER_WSL==='1';
 await Promise.all(concurrent.map(p=>{
  const stmt=`set role authenticated;select set_config('request.jwt.claim.sub','${OPS}',false);select public.erp_sales_approve_amount_adjustment('${p.p_sale_id}','${p.p_adjustment_id}','${p.p_request_id}','${on}','Synthetic amount approval');`;
  const args=['exec',db.name,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',stmt];
  return exec(wsl?'wsl.exe':'docker',wsl?['-e','docker','-H','unix:///var/run/erp-v1-docker.sock',...args]:args,{maxBuffer:1024*1024});
 }));
 check([40000,45000].includes(position(sale).effective_total),'concurrent approvals serialize instead of adding stale deltas');
 check(call('erp_sales_get',{p_id:sale.id}).total_amount===55000,'concurrent approvals retain the original snapshot');
 console.log(`ERP_AMOUNT_ADJUSTMENTS_PASS ${count} assertions`);
}finally{db.stop();}

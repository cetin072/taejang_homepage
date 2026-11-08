import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { createERPDatabase,OPS,WORKER } from './helpers/erp-sales-isolated-db.mjs';
const db=await createERPDatabase();let passed=0;
const check=(ok,label)=>{assert.ok(ok,label);passed++;console.log('PASS',label);};
const reject=(fn,pattern)=>{assert.throws(fn,pattern);passed++;};
const save=(kind,data,previous)=>db.rpc('erp_sales_save_master',{p_kind:kind,p_data:data,p_id:previous?.id||null,p_revision:previous?.revision||0});
const assign=(party,agent,type,start)=>db.rpc('erp_sales_assign_agent',{p_party_id:party.id,p_agent_id:agent.id,p_relationship:type,p_starts_on:start,p_reason:'Synthetic relationship test'});
const fee=(kind,value)=>({kind,value,settlement_rule:'after_full_payment'});
try {
 const documentBefore=db.raw('select md5(jsonb_agg(t)::text) from public.monthly_client_document_company_defaults t;');
 const customer=save('party',{name:'Synthetic Corporate',kind:'company',business_number:'1234567890',relationships:['customer','supplier'],document_company_id:'beomhan'});
 reject(()=>save('party',{name:'Duplicate',kind:'company',business_number:'123-45-67890',relationships:['customer']}),/duplicate key/);
 check(customer.relationships.length===2,'one corporate party can be both customer and supplier');
 const individual=save('party',{name:'Synthetic Individual',kind:'individual',phone:'0000000000',relationships:['customer']});
 reject(()=>save('party',{name:'Synthetic Individual',kind:'individual',phone:'000-0000-000',relationships:['customer']}),/duplicate key/);
 const supplier=save('party',{name:'Synthetic Direct Supplier',kind:'company',business_number:'2222222222',relationships:['supplier']});
 const agentA=save('agent',{name:'Synthetic Agent A'}),agentB=save('agent',{name:'Synthetic Agent B'});
 assign(customer,agentA,'acquisition','2099-01-01');assign(customer,agentA,'management','2099-01-01');assign(customer,agentB,'support','2099-01-01');assign(individual,agentA,'management','2099-01-01');
 check(db.rpc('erp_sales_bootstrap').assignments.length===4,'multiple sales relationships per party are saved and reread');
 const salt=save('item',{code:'SALT-TEST',name:'Synthetic Salt',kind:'product',unit:'포',base_price:1000,tax_class:'taxable',inventory_managed:true});
 const service=save('item',{code:'SERVICE-TEST',name:'Synthetic Cleanup',kind:'service',unit:'월',base_price:null,tax_class:'taxable'});
 const contract=save('contract',{title:'Synthetic yearly contract',party_id:customer.id,item_id:service.id,starts_on:'2099-01-01',ends_on:'2099-12-31',monthly_supply:100000,monthly_tax:10000,tax_class:'taxable',billing_basis:'매월 말일 청구',status:'active'});
 const contractMonth=month=>db.rpc('erp_sales_get_contract_month',{p_contract_id:contract.id,p_month:month});
 check(contractMonth('2099-01-01')===null&&db.raw('select count(*) from public.erp_sales_transactions;')==='0',
  'looking up a missing contract month does not create a sale');
 reject(()=>contractMonth('2099-01-02'),/ERP_INVALID_MONTH/);
 reject(()=>contractMonth('infinity'),/ERP_INVALID_MONTH/);
 reject(()=>db.rpc('erp_sales_get_contract_month',{p_contract_id:randomUUID(),p_month:'2099-01-01'}),/ERP_CONTRACT_NOT_FOUND/);
 reject(()=>db.rpc('erp_sales_get_contract_month',{p_contract_id:contract.id,p_month:'2099-01-01'},{actor:WORKER}),/ERP_FORBIDDEN/);
 let monthly=db.rpc('erp_sales_generate_month',{p_contract_id:contract.id,p_month:'2099-01-01'});
 check(monthly.total_amount===110000&&monthly.lines.length===1&&monthly.agent_id===agentA.id,'scenario A: contract month generates persisted sale and actual amount');
 check(contractMonth('2099-01-01').id===monthly.id&&contractMonth('2099-01-01').status==='draft'
  &&db.raw('select count(*) from public.erp_sales_transactions;')==='1','month lookup opens an existing draft without creating another sale');
 monthly=db.rpc('erp_sales_save',{p_data:{...monthly,commission:fee('rate',2.5)},p_id:monthly.id,p_revision:monthly.revision});
 const stale=monthly.revision-1;
 reject(()=>db.rpc('erp_sales_save',{p_data:monthly,p_id:monthly.id,p_revision:stale}),/ERP_REVISION_CONFLICT/);
 monthly=db.rpc('erp_sales_confirm',{p_id:monthly.id,p_revision:monthly.revision});
 check(monthly.history[0].after_data.confirmed_at!==null&&monthly.history[0].after_data.confirmed_by===OPS&&monthly.history[0].after_data.revision===monthly.revision,'confirmation history records the actual final revision, actor and time');
 const receiptRead={p_sale_id:monthly.id};
 const receipt={...receiptRead,p_request_id:randomUUID(),p_recorded_on:'2026-01-10',p_amount:40000};
 let balance=db.rpc('erp_sales_get_receipts',receiptRead);
 check(balance.received===0&&balance.balance===110000,'confirmed sale starts with the full unpaid balance');
 balance=db.rpc('erp_sales_record_receipt',receipt);
 check(balance.received===40000&&balance.balance===70000,'partial payment reduces the confirmed sale balance');
 check(db.rpc('erp_sales_record_receipt',receipt).entries.length===1,'retry records the same receipt exactly once');
 reject(()=>db.rpc('erp_sales_record_receipt',{...receipt,p_amount:30000}),/ERP_REQUEST_REUSE/);
 reject(()=>db.rpc('erp_sales_record_receipt',{...receipt,p_request_id:randomUUID(),p_amount:70001}),/ERP_RECEIPT_OVER_BALANCE/);
 reject(()=>db.rpc('erp_sales_record_receipt',{...receipt,p_request_id:randomUUID(),p_amount:0.5}),/ERP_RECEIPT_INVALID_INPUT/);
 const reversal={...receiptRead,p_request_id:randomUUID(),p_recorded_on:'2026-01-11',p_reverses_id:receipt.p_request_id,p_note:'Synthetic incorrect record'};
 reject(()=>db.rpc('erp_sales_record_receipt',{...reversal,p_note:' '}),/ERP_RECEIPT_INVALID_INPUT/);
 balance=db.rpc('erp_sales_record_receipt',reversal);
 check(balance.received===0&&balance.balance===110000&&balance.entries.length===2,'record correction preserves original and restores balance');
 check(db.rpc('erp_sales_record_receipt',reversal).entries.length===2,'retry records the same reversal exactly once');
 reject(()=>db.rpc('erp_sales_record_receipt',{...reversal,p_request_id:randomUUID()}),/ERP_RECEIPT_ALREADY_REVERSED/);
 check(db.rpc('erp_sales_get', {p_id:monthly.id}).total_amount===110000,'receipts never change the confirmed sale amount');
 reject(()=>db.rpc('erp_sales_get_receipts',receiptRead,{actor:WORKER}),/ERP_FORBIDDEN/);
 reject(()=>db.rpc('erp_sales_record_receipt',receipt,{actor:WORKER}),/ERP_FORBIDDEN/);
 check(db.sql('select count(*) from public.erp_sales_receipts;',{actor:WORKER})==='0','receipt RLS hides transaction data from regular employees');
 reject(()=>db.sql('delete from public.erp_sales_receipts;'),/permission denied/);
 reject(()=>db.raw('delete from public.erp_sales_receipts;'),/ERP_RECEIPT_IMMUTABLE/);
 const dueDate={...receiptRead,p_due_on:'2099-01-31',p_expected_due_on:null};
 check(db.rpc('erp_sales_set_receipt_due_on',dueDate).due_on==='2099-01-31','the due date is persisted separately from the confirmed sale');
 reject(()=>db.rpc('erp_sales_set_receipt_due_on',{...dueDate,p_due_on:'2099-02-10'}),/ERP_REVISION_CONFLICT/);
 reject(()=>db.rpc('erp_sales_set_receipt_due_on',{...dueDate,p_due_on:'infinity',p_expected_due_on:'2099-01-31'}),/ERP_RECEIPT_INVALID_DUE_ON/);
 reject(()=>db.rpc('erp_sales_set_receipt_due_on',dueDate,{actor:WORKER}),/ERP_FORBIDDEN/);
 reject(()=>db.rpc('erp_sales_list_receivables',{},{actor:WORKER}),/ERP_FORBIDDEN/);
 reject(()=>db.sql('delete from public.erp_sales_receipt_schedule;'),/permission denied/);
 let receivables=db.rpc('erp_sales_list_receivables',{p_party_id:customer.id,p_due_from:'2099-01-01',p_due_to:'2099-01-31'});
 check(receivables.total===1&&receivables.total_balance==='110000'&&receivables.items[0].due_on==='2099-01-31','receivables show due date and aggregate balance within the selected filters');
 check(db.rpc('erp_sales_list_receivables',{p_party_id:individual.id}).total===0,'receivables respect the customer filter');
 check(db.rpc('erp_sales_list_receivables',{p_due_from:'2099-02-01'}).total===0,'receivables exclude dates outside the selected range');
 reject(()=>db.rpc('erp_sales_list_receivables',{p_due_from:'2099-02-01',p_due_to:'2099-01-01'}),/ERP_RECEIPT_INVALID_DUE_RANGE/);
 check(db.rpc('erp_sales_set_receipt_due_on',{...dueDate,p_due_on:null,p_expected_due_on:'2099-01-31'}).due_on===null,'removing the date keeps the unpaid sale');
 check(db.rpc('erp_sales_list_receivables').total===1&&db.rpc('erp_sales_list_receivables',{p_due_from:'2099-01-01'}).total===0,'undated unpaid sales appear without date filters');
 db.rpc('erp_sales_record_receipt',{...receipt,p_request_id:randomUUID(),p_amount:110000});
 check(db.rpc('erp_sales_list_receivables').total===0,'fully settled sales leave the receivables list');
 const duplicate=db.rpc('erp_sales_generate_month',{p_contract_id:contract.id,p_month:'2099-01-01'});
 check(duplicate.id===monthly.id&&duplicate.alreadyExists,'same contract/month returns original sale without duplication');
 assign(customer,agentB,'management','2099-02-01');
 check(db.rpc('erp_sales_get',{p_id:monthly.id}).agent_snapshot.name==='Synthetic Agent A','changing party manager preserves historical salesperson');
 const product=(party,agent,price,quantity,commission)=>({kind:'product',party_id:party.id,supplier_id:supplier.id,agent_id:agent.id,order_channel:party.kind==='company'?'purchase_order':'kakao',shipping_status:'preparing',order_date:'2099-02-05',sales_date:'2099-02-05',commission,lines:[{item_id:salt.id,quantity,unit_price:price,tax_class:'taxable',tax_amount:100}]});
 const corporateInput={...product(customer,agentB,1000,10,fee('rate',3)),request_key:randomUUID()};
 let corporate=db.rpc('erp_sales_save',{p_data:corporateInput});
 check(db.rpc('erp_sales_save',{p_data:corporateInput}).id===corporate.id,'retry after a lost acknowledgement cannot create another order');
 reject(()=>db.rpc('erp_sales_save',{p_data:{...corporateInput,memo:'different request'}}),/ERP_REQUEST_REUSE/);
 let person=db.rpc('erp_sales_save',{p_data:product(individual,agentA,1234,3,fee('fixed',500))});
 reject(()=>db.rpc('erp_sales_record_receipt',{...receipt,p_sale_id:person.id,p_request_id:randomUUID()}),/ERP_RECEIPT_CONFIRMED_REQUIRED/);
 check(corporate.total_amount===10100&&person.total_amount===3802,'scenario B: corporate and individual orders preserve different actual unit prices');
 check(corporate.commission.value===3&&person.commission.value===500&&monthly.commission.value===2.5,'salesperson conditions are per transaction, without payout or withholding calculations');
 const changedSalt=save('item',{...salt,name:'Synthetic Salt renamed',base_price:9999},salt);
 corporate=db.rpc('erp_sales_confirm',{p_id:corporate.id,p_revision:corporate.revision});
 check(corporate.lines[0].unit_price===1000&&corporate.lines[0].item_snapshot.name==='Synthetic Salt','master price/name changes do not alter earlier sale snapshots');
 reject(()=>db.rpc('erp_sales_save',{p_data:corporate,p_id:corporate.id,p_revision:corporate.revision}),/ERP_SALE_CONFIRMED/);
 reject(()=>db.raw(`update public.erp_sales_transactions set total_amount=0 where id='${corporate.id}';`),/ERP_SALE_CONFIRMED/);
 reject(()=>db.raw(`delete from public.erp_sales_transactions where id='${corporate.id}';`),/ERP_SALE_CONFIRMED/);
 reject(()=>db.raw(`update public.erp_sales_lines set unit_price=0 where sale_id='${corporate.id}';`),/ERP_SALE_CONFIRMED/);
 const delivered=db.rpc('erp_sales_shipping',{p_id:corporate.id,p_status:'delivered'});
 check(delivered.shippingCurrent==='delivered'&&delivered.shipping_status==='preparing'&&delivered.total_amount===10100,'shipping progress appends history without changing confirmed original or amounts');
 reject(()=>db.raw(`delete from public.erp_sales_history where entity_id='${corporate.id}';`),/ERP_HISTORY_IMMUTABLE/);
 check(db.rpc('erp_sales_bootstrap').items.find(i=>i.id===salt.id).inventory_managed===true,'supplier direct delivery does not modify inventory configuration');
 const outsider=save('agent',{name:'Synthetic Unlinked Agent'});
 reject(()=>db.rpc('erp_sales_save',{p_data:{...product(customer,outsider,1,1,fee('none',0)),sales_date:'2099-02-05'}}),/ERP_AGENT_RELATION_REQUIRED/);
 reject(()=>db.rpc('erp_sales_save',{p_data:{...product(customer,agentB,1,1,fee('rate',101))}}),/ERP_INVALID_COMMISSION/);
 reject(()=>db.rpc('erp_sales_save',{p_data:{...product(customer,agentB,1,1,fee('none',0)),lines:[{item_id:salt.id,quantity:1,unit_price:1.001,tax_class:'taxable',tax_amount:0}]}}),/ERP_INVALID_PRECISION/);
 reject(()=>db.rpc('erp_sales_save',{p_data:{...product(customer,agentB,1,1,fee('none',0)),lines:[{item_id:salt.id,quantity:1,unit_price:1,tax_class:'exempt',tax_amount:1}]}}),/violates check constraint/);
 check(db.rpc('erp_sales_list',{p_from:'2099-01-01',p_to:'2099-12-31'}).total===3,'failed writes roll back completely; list rereads three real transactions');
 check(db.rpc('erp_sales_list',{p_from:'2099-01-01',p_to:'2099-12-31',p_party_id:customer.id,p_kind:'product',p_status:'confirmed',p_agent_id:agentB.id}).items[0].id===corporate.id,'period/customer/type/status/salesperson filters work on persisted data');
 check(db.raw('select md5(jsonb_agg(t)::text) from public.monthly_client_document_company_defaults t;')===documentBefore,'existing monthly document defaults remain unchanged');
 for(const name of ['erp_sales_parties','erp_sales_agents','erp_sales_assignments','erp_sales_items','erp_sales_contracts','erp_sales_transactions','erp_sales_lines','erp_sales_history']){
  check(db.sql(`select count(*) from public.${name};`,{actor:WORKER})==='0',`${name}: RLS denies unauthorized reads`);
  reject(()=>db.sql(`delete from public.${name};`,{actor:WORKER}),/permission denied/);
 }
 for(const name of ['erp_sales_bootstrap','erp_sales_get'])reject(()=>db.rpc(name,name==='erp_sales_get'?{p_id:corporate.id}:{},{actor:WORKER}),/ERP_FORBIDDEN/);
 reject(()=>db.sql('select public.erp_sales_bootstrap();',{actor:null,role:'anon'}),/permission denied/);
 reject(()=>db.sql(`update public.erp_sales_parties set name='bypass';`),/permission denied/);
 db.raw(`insert into public.role_simulation_modes(profile_id,role_code,expires_at) values('${OPS}','general_worker',now()+interval '1 hour');`);
 reject(()=>db.rpc('erp_sales_bootstrap'),/ERP_FORBIDDEN/);db.raw('delete from public.role_simulation_modes;');
 db.raw(`insert into public.role_simulation_modes(profile_id,role_code,expires_at) values('${WORKER}','operations_manager',now()+interval '1 hour');`);
 reject(()=>db.rpc('erp_sales_bootstrap',{},{actor:WORKER}),/ERP_FORBIDDEN/);db.raw('delete from public.role_simulation_modes;');
 db.raw("update public.platform_capabilities set active=false where code='erp_sales.write';");
 check(db.rpc('erp_sales_bootstrap').canWrite===false,'read and write permissions are separately enforced');reject(()=>save('agent',{name:'Denied'}),/ERP_FORBIDDEN/);
 db.raw("update public.platform_capabilities set active=true where code='erp_sales.write';update public.platform_capabilities set active=false where code='erp_sales.confirm';");
 reject(()=>db.rpc('erp_sales_confirm',{p_id:person.id,p_revision:person.revision}),/ERP_FORBIDDEN/);
 db.raw("update public.platform_capabilities set active=true where code='erp_sales.confirm';");
 check(db.raw("select adapter_ready from public.menu_authority_catalog where menu_key='erp_sales.manage';")==='f','personal delegation is not enabled by this V1');
 const ruleKey={p_contract_id:contract.id};
 const unsetRule=db.rpc('erp_sales_get_contract_receipt_rule',ruleKey);
 check(unsetRule.month_offset===null&&unsetRule.due_day===null,'existing contracts start without an automatic receipt rule');
 const setRule=(offset,day,expected=unsetRule,actor=OPS)=>db.rpc('erp_sales_set_contract_receipt_rule',
  {...ruleKey,p_month_offset:offset,p_due_day:day,p_expected_rule:expected},{actor});
 reject(()=>setRule(0,0),/ERP_RECEIPT_INVALID_RULE/);
 reject(()=>setRule(2,10),/ERP_RECEIPT_INVALID_RULE/);
 reject(()=>setRule(null,10),/ERP_RECEIPT_INVALID_RULE/);
 reject(()=>setRule(0,31,unsetRule,WORKER),/ERP_FORBIDDEN/);
 reject(()=>db.rpc('erp_sales_get_contract_receipt_rule',ruleKey,{actor:WORKER}),/ERP_FORBIDDEN/);
 const monthEnd=setRule(0,31);
 check(db.rpc('erp_sales_get_receipts',receiptRead).due_on===null,'saving a contract rule does not backfill existing sales');
 const generate=p_month=>db.rpc('erp_sales_generate_month',{...ruleKey,p_month});
 const dueOf=id=>db.raw(`select due_on from public.erp_sales_receipt_schedule where sale_id='${id}';`);
 const feb=generate('2099-02-01');
 check(dueOf(feb.id)==='2099-02-28','a 31st day rule uses February month end');
 reject(()=>setRule(1,10),/ERP_REVISION_CONFLICT/);
 const nextMonth=setRule(1,10,monthEnd);
 const febRetry=generate('2099-02-01');
 check(febRetry.id===feb.id&&dueOf(febRetry.id)==='2099-02-28','regenerating an existing month preserves its original due date');
 const mar=generate('2099-03-01');
 db.rpc('erp_sales_confirm',{p_id:mar.id,p_revision:mar.revision});
 check(db.rpc('erp_sales_get_receipts',{p_sale_id:mar.id}).due_on==='2099-04-10','confirmed sales inherit the configured following-month day');
 db.rpc('erp_sales_set_receipt_due_on',{p_sale_id:mar.id,p_due_on:'2099-04-15',p_expected_due_on:'2099-04-10'});
 check(dueOf(generate('2099-03-01').id)==='2099-04-15','manual due date override survives a duplicate monthly generation request');
 setRule(null,null,nextMonth);
 check(dueOf(generate('2099-04-01').id)==='','disabling the rule leaves newly generated sales unscheduled');
 const on=db.raw("select (now() at time zone 'Asia/Seoul')::date;");
 const payApproval=(sale,kind,amount,basis=null,extras={})=>({
  p_sale_id:sale.id,p_request_id:randomUUID(),p_kind:kind,p_amount:amount,p_basis_amount:basis,
  p_evidence:'Synthetic invoice checked',...extras
 });
 const approve=(p,actor=OPS)=>db.rpc('erp_sales_approve_payout',p,{actor});
 const payment=(p,p_outcome='paid')=>db.rpc('erp_sales_finish_payout',{
  p_sale_id:p.p_sale_id,p_payout_id:p.p_request_id,p_outcome,p_on:on,p_evidence:'Synthetic payment or cancellation evidence'
 });
 const collect=(sale,amount)=>({p_sale_id:sale.id,p_request_id:randomUUID(),p_recorded_on:on,p_amount:amount});
 reject(()=>approve(payApproval(corporate,'supplier',500,800)),/ERP_PAYOUT_OVER_LIMIT/);
 db.rpc('erp_sales_record_receipt',collect(corporate,5050));
 reject(()=>approve(payApproval(corporate,'commission',10,300)),/ERP_PAYOUT_OVER_LIMIT/);
 reject(()=>approve(payApproval(corporate,'supplier',500,800,{p_evidence:' '})),/ERP_PAYOUT_INVALID_INPUT/);
 reject(()=>approve(payApproval(corporate,'supplier',500,800,{p_cycle:'monthly'})),/ERP_PAYOUT_INVALID_INPUT/);
 const supplierApproval=payApproval(corporate,'supplier',500,800,{p_cycle:'monthly',p_due_on:'2099-03-10'});
 reject(()=>approve(supplierApproval,WORKER),/ERP_FORBIDDEN/);
 check(approve(supplierApproval).supplier.pending===500,'supplier approval is distinct from actual payment');
 check(approve(supplierApproval).supplier.entries.length===1,'retrying payout approval does not duplicate it');
 const pendingQueue=(params={},actor=OPS)=>db.rpc('erp_sales_list_pending_payouts',params,{actor});
 let queue=pendingQueue();
 check(queue.total===1&&queue.total_cash==='500'&&queue.items[0].id===supplierApproval.p_request_id,
  'pending payout queue includes approved supplier amounts exactly once');
 check(pendingQueue({p_kind:'commission'}).total===0,'pending payout queue respects payment kind');
 check(pendingQueue({p_due_to:on}).total===0,'future target date is excluded from overdue queue');
 reject(()=>pendingQueue({},WORKER),/ERP_FORBIDDEN/);
 reject(()=>pendingQueue({p_kind:'invalid'}),/ERP_PAYOUT_INVALID_INPUT/);
 reject(()=>pendingQueue({p_due_to:'infinity'}),/ERP_PAYOUT_INVALID_INPUT/);
 reject(()=>approve(payApproval(corporate,'supplier',100,800)),/ERP_PAYOUT_BASIS_CONFLICT/);
 let payouts=payment(supplierApproval);
 check(payouts.supplier.paid===500&&payouts.supplier.remaining===300&&payouts.supplier.pending===0,'supplier payment preserves the balance and removes pending approval');
 check(payment(supplierApproval).supplier.paid===500,'retrying payment completion does not double count');
 check(pendingQueue().total===0,'completed payment leaves the pending queue');
 reject(()=>payment(supplierApproval,'cancelled'),/ERP_PAYOUT_ALREADY_FINISHED/);
 reject(()=>db.raw('delete from public.erp_sales_payouts;'),/ERP_PAYOUT_IMMUTABLE/);
 reject(()=>db.rpc('erp_sales_get_payouts',{p_sale_id:corporate.id},{actor:WORKER}),/ERP_FORBIDDEN/);

 person=db.rpc('erp_sales_save',{p_data:{...person,commission:{...person.commission,settlement_rule:'proportional'}},p_id:person.id,p_revision:person.revision});
 person=db.rpc('erp_sales_confirm',{p_id:person.id,p_revision:person.revision});
 const firstHalf=collect(person,1901);
 db.rpc('erp_sales_record_receipt',firstHalf);
 const commissionApproval=payApproval(person,'commission',250);
 reject(()=>approve({...commissionApproval,p_amount:251}),/ERP_PAYOUT_OVER_LIMIT/);
 check(approve(commissionApproval).commission.pending===250,'partial receipt permits only its share of fixed commission');
 check(pendingQueue({p_kind:'commission'}).items[0].id===commissionApproval.p_request_id,'commission approvals join the pending queue');
 db.rpc('erp_sales_record_receipt',{p_sale_id:person.id,p_request_id:randomUUID(),p_recorded_on:on,
  p_reverses_id:firstHalf.p_request_id,p_note:'Synthetic incorrect deposit'});
 reject(()=>payment(commissionApproval),/ERP_PAYOUT_OVER_LIMIT/);
 check(payment(commissionApproval,'cancelled').commission.pending===0,'cancelling an unpaid approval retains history and releases its reservation');
 check(pendingQueue().total===0,'cancelled approval leaves the pending queue');
 db.rpc('erp_sales_record_receipt',collect(person,1901));
 const replacement=payApproval(person,'commission',250);
 approve(replacement);
 payouts=payment(replacement);
 check(payouts.commission.paid===250&&payouts.commission.remaining===250&&payouts.supplier.paid===0,'commission and supplier balances remain separate on the same sale');
 const support=(kind,p_data,p_request_id=randomUUID(),actor=OPS)=>
  db.rpc('erp_sales_record_support',{p_kind:kind,p_request_id,p_data},{actor});
 const purchase={date:on,purchase_kind:'expense',merchant:'Synthetic store',description:'Synthetic supplies',
  method:'company_card',amount:3700,note:'Synthetic card reference'};
 const purchaseId=randomUUID();
 support('purchase',purchase,purchaseId);
 check(support('purchase',purchase,purchaseId).id===purchaseId,'direct purchase save is idempotent without a supplier or purchase order');
 reject(()=>support('purchase',{...purchase,amount:3800},purchaseId),/ERP_REQUEST_REUSE/);
 const purchases=db.rpc('erp_sales_list_purchases',{p_from:on,p_to:on});
 check(purchases.total===1&&purchases.total_amount==='3700'&&purchases.items[0].supplier==='Synthetic store','direct card expense is listed with source and total');
 reject(()=>support('purchase',purchase,randomUUID(),WORKER),/ERP_FORBIDDEN/);
 check(db.rpc('erp_sales_get_stock').balances.find(r=>r.id===salt.id).quantity===0,'previous direct-delivery sales never change stock');
 support('stock',{date:'2025-01-02',item_id:salt.id,quantity:10.5,note:'Synthetic stock in'});
 support('stock',{date:on,item_id:salt.id,quantity:-2.25,note:'Synthetic stock out'});
 check(db.rpc('erp_sales_get_stock').balances.find(r=>r.id===salt.id).quantity===8.25,'stock balances use explicit incoming and outgoing movements');
 reject(()=>support('stock',{date:'2025-01-01',item_id:salt.id,quantity:-1,note:'Backdated excess'}),/ERP_STOCK_INSUFFICIENT/);
 reject(()=>support('stock',{date:on,item_id:service.id,quantity:1,note:'Service item'}),/ERP_STOCK_ITEM_REQUIRED/);
 reject(()=>support('evidence',{date:on,sale_id:corporate.id,kind:'tax_invoice',
  reference:'REMOVED',amount:10100}),/ERP_SUPPORT_INVALID_INPUT/);
 check(db.raw("select to_regprocedure('public.erp_sales_get_evidence(uuid)') is null;")==='t',
  'retired invoice endpoint is absent');
 const requestAdjustment=(sale,kind,detail)=>({
  p_sale_id:sale.id,p_request_id:randomUUID(),p_kind:kind,p_reason:'Synthetic adjustment',p_detail:detail
 });
 const request=p=>db.rpc('erp_sales_request_adjustment',p);
 const event=(p,action,amount=null,actor=OPS)=>db.rpc('erp_sales_record_adjustment_event',{
  p_sale_id:p.p_sale_id,p_adjustment_id:p.p_request_id,p_request_id:randomUUID(),
  p_action:action,p_amount:amount,p_on:on,p_note:'Synthetic adjustment evidence'
 },{actor});
 reject(()=>request(requestAdjustment(corporate,'cancel_order',{})),/ERP_ADJUSTMENT_SHIPPING_STATE/);
 const adjustmentQueue=(params={})=>db.rpc('erp_sales_list_pending_adjustments',params);
 check(adjustmentQueue().total===0,'adjustment queue starts empty');
 reject(()=>db.rpc('erp_sales_list_pending_adjustments',{}, {actor:WORKER}),/ERP_FORBIDDEN/);
 reject(()=>db.sql('select public.erp_sales_list_pending_adjustments();',{role:'anon',actor:null}),/permission denied/);
 reject(()=>adjustmentQueue({p_kind:'unknown'}),/ERP_ADJUSTMENT_INVALID_INPUT/);
 const followups=(params={})=>db.rpc('erp_sales_list_pending_followups',params);
 check(followups().total===0,'followups start empty');
 reject(()=>db.rpc('erp_sales_list_pending_followups',{}, {actor:WORKER}),/ERP_FORBIDDEN/);
 reject(()=>db.sql('select public.erp_sales_list_pending_followups();',{role:'anon',actor:null}),/permission denied/);
 reject(()=>followups({p_kind:'unknown'}),/ERP_ADJUSTMENT_INVALID_INPUT/);
 const returned=requestAdjustment(corporate,'return_goods',{line_id:corporate.lines[0].id,quantity:3,credit_amount:3030,refund_plan:600});
 request(returned);
 check(request(returned).length===1,'adjustment request retries preserve a single original record');
 check(followups().total===0,'unapproved requests do not appear as followups');
 const pendingReturn=adjustmentQueue();
 check(pendingReturn.total===1&&pendingReturn.items[0].id===returned.p_request_id
  &&pendingReturn.items[0].sale_id===corporate.id&&pendingReturn.items[0].reason==='Synthetic adjustment',
  'pending adjustment queue returns the original request once with sale navigation');
 check(adjustmentQueue({p_kind:'service_change'}).total===0&&adjustmentQueue({p_kind:'return_goods'}).total===1,
  'adjustment queue filters request kind');
 reject(()=>event(returned,'refund',300),/ERP_ADJUSTMENT_APPROVAL_REQUIRED/);
 reject(()=>event(returned,'approve',null,WORKER),/ERP_FORBIDDEN/);
 const corporateReceipt=()=>db.rpc('erp_sales_get_receipts',{p_sale_id:corporate.id});
 check(corporateReceipt().balance===5050,'requested return credit does not change the receivable before approval');
 event(returned,'approve');
 const followup=followups();
 check(followup.total===1&&followup.items[0].id===returned.p_request_id
  &&followup.items[0].recall_pending&&followup.items[0].refund_remaining===600
  &&followup.total_refund_remaining==='600','approved return tracks recall and refund separately');
 check(followups({p_kind:'cancel_order'}).total===0&&followups({p_kind:'return_goods'}).total===1,'followups respect adjustment kind');
 check(adjustmentQueue().total===0,'approved requests leave the pending queue before recall or refund');
 check(corporateReceipt().balance===2020,'approved return credit reduces receivable even before refund');
 reject(()=>request(requestAdjustment(corporate,'return_goods',{
  line_id:corporate.lines[0].id,quantity:1,credit_amount:7071
 })),/ERP_ADJUSTMENT_CREDIT_LIMIT/);
 reject(()=>request(requestAdjustment(corporate,'return_goods',{line_id:corporate.lines[0].id,quantity:8})),/ERP_ADJUSTMENT_QUANTITY/);
 event(returned,'recall');
 check(!followups().items[0].recall_pending&&followups().total_refund_remaining==='600','recall does not clear remaining refund');
 const refund=event(returned,'refund',300);
 check(followups().items[0].refund_remaining===300&&followups().total_refund_remaining==='300','partial refunds reduce remaining refund exactly once');
 check(refund[0].detail.refund_plan===600&&refund[0].events.find(x=>x.action==='refund').amount===300,'refund plan and actual payment remain separate');
 reject(()=>event(returned,'refund',301),/ERP_ADJUSTMENT_REFUND_LIMIT/);
 const adjusted=corporateReceipt();
 check(adjusted.effective_total===7070&&adjusted.received===5050&&adjusted.net_received===4750&&adjusted.balance===2320,
  'actual refund reduces net collections without reducing original receipts or deducting the return credit twice');
 const receivable=db.rpc('erp_sales_list_receivables',{p_party_id:customer.id}).items.find(row=>row.id===corporate.id);
 check(receivable.total_amount===7070&&receivable.received===4750&&receivable.balance===2320,
  'receivables use the same adjusted total and net collections as the sale detail');
 reject(()=>db.rpc('erp_sales_record_receipt',collect(corporate,2321)),/ERP_RECEIPT_OVER_BALANCE/);
 check(db.rpc('erp_sales_get',{p_id:corporate.id}).total_amount===10100,'return and refund preserve the confirmed sale');
 event(returned,'refund',300);
 check(followups().total===0,'completed recall and refund leave followups');
 const newOrder=db.rpc('erp_sales_save',{p_data:{...corporateInput,request_key:randomUUID()}});
 db.rpc('erp_sales_confirm',{p_id:newOrder.id,p_revision:newOrder.revision});
 const cancellation=requestAdjustment(newOrder,'cancel_order',{refund_plan:0});
 request(cancellation);event(cancellation,'approve');
 check(followups().total===0,'cancellation without refund needs no followup or recall');
 check(db.rpc('erp_sales_get_receipts',{p_sale_id:newOrder.id}).balance===0,'approved cancellation removes the receivable');
 reject(()=>db.rpc('erp_sales_record_receipt',collect(newOrder,1)),/ERP_RECEIPT_OVER_BALANCE/);
 reject(()=>db.rpc('erp_sales_shipping',{p_id:newOrder.id,p_status:'shipped'}),/ERP_ADJUSTMENT_SHIPPING_STATE/);
 const declined=requestAdjustment(newOrder,'sales_change',{amount:1});
 request(declined);
 check(adjustmentQueue().items[0].id===declined.p_request_id,'new requests reappear in pending queue');
 event(declined,'reject');
 check(followups().total===0,'rejected requests are excluded from followups');
 check(adjustmentQueue().total===0,'rejected requests leave the pending queue');
 const commissionChange=requestAdjustment(person,'commission_change',{commission_action:'offset',amount:100});
 request(commissionChange);event(commissionChange,'approve');
 check(db.rpc('erp_sales_get_payouts',{p_sale_id:person.id}).commission.paid===250,'commission correction preserves existing actual payments');
 const nextDraft=db.rpc('erp_sales_save',{p_data:product(individual,agentA,1000,1,fee('fixed',300))});
 const nextSale=db.rpc('erp_sales_confirm',{p_id:nextDraft.id,p_revision:nextDraft.revision});
 db.rpc('erp_sales_record_receipt',collect(nextSale,nextSale.total_amount));
 const abandoned=payApproval(nextSale,'commission',50);
 check(approve(abandoned).commission.entries[0].cash_amount===0,'commission offset can cover a payout without a cash transfer');
 payment(abandoned,'cancelled');
 const next=payApproval(nextSale,'commission',200);
 let nextEntries=approve(next).commission.entries;
 check(nextEntries.find(entry=>entry.id===next.p_request_id).cash_amount===100,'cancelled approval releases the offset to the next commission on a different sale');
 queue=pendingQueue({p_kind:'commission'});
 const queuedCommission=queue.items.find(entry=>entry.id===next.p_request_id);
 check(queuedCommission.amount===200&&queuedCommission.offset_amount===100&&queuedCommission.cash_amount===100
  &&queue.total_cash==='100','pending queue shows gross approval, offset and actual cash independently');
 nextEntries=approve(next).commission.entries;
 check(nextEntries.find(entry=>entry.id===next.p_request_id).offset===100,'approval retry does not consume the offset again');
 check(payment(next).commission.cash_paid===100,'recorded cash payout excludes the applied offset');
 const later=payApproval(nextSale,'commission',100);
 check(approve(later).commission.entries.find(entry=>entry.id===later.p_request_id).offset===0,'settled offset cannot be reused');
 reject(()=>db.raw('delete from public.erp_sales_adjustment_events;'),/ERP_RECEIPT_IMMUTABLE/);
 const oldMonth=db.raw("select (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 month')::date;");
 const oldDraft=db.rpc('erp_sales_save',{p_data:{...corporateInput,request_key:randomUUID(),sales_date:oldMonth,
  order_date:oldMonth,agent_id:null,commission:fee('none',0)}});
 const oldSale=db.rpc('erp_sales_confirm',{p_id:oldDraft.id,p_revision:oldDraft.revision});
 db.rpc('erp_sales_set_month_close',{p_month:oldMonth,p_request_id:randomUUID(),p_closed:true,p_expected_closed:false,
  p_reason:'Synthetic prior period close'});
 reject(()=>db.rpc('erp_sales_record_receipt',{...collect(oldSale,1),p_recorded_on:oldMonth}),/ERP_PERIOD_CLOSED/);
 check(db.rpc('erp_sales_record_receipt',collect(oldSale,1)).received===1,'a closed sale period permits a new collection in an open period');
 const month=on.slice(0,7)+'-01';
 const setMonth=(closed,expected,actor=OPS)=>db.rpc('erp_sales_set_month_close',{
  p_month:month,p_request_id:randomUUID(),p_closed:closed,p_expected_closed:expected,p_reason:'Synthetic month control'
 },{actor});
 reject(()=>setMonth(true,false,WORKER),/ERP_FORBIDDEN/);
 check(setMonth(true,false).closed,'month close is persisted');
 reject(()=>support('purchase',purchase),/ERP_PERIOD_CLOSED/);
 reject(()=>db.rpc('erp_sales_record_receipt',collect(corporate,1)),/ERP_PERIOD_CLOSED/);
 check(!setMonth(false,true).closed,'exceptional reopen restores writes for the period');
 support('purchase',purchase);
 check(setMonth(true,false).events.length===3,'reclosing keeps all close and reopen history');
 save('contract',{...contract,status:'ended'},contract);
 check(contractMonth('2099-01-01').id===monthly.id&&contractMonth('2099-01-01').status==='confirmed',
  'ended contracts retain read access to their existing confirmed monthly sales');
 console.log(`ERP isolated PostgreSQL17: ${passed} assertions PASS`);
}finally{db.stop();}

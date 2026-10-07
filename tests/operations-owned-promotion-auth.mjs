import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function operationsOwnedPromotionChecks({apiUrl,rpc,sql,signUp,admin,lead,staff,departmentId,positionId,check,equal}) {
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(apiUrl).hostname),'Operations workflow tests require isolated Supabase');
  const draft=async(extra={},actor=admin,operations=true)=>{
    const saved=await rpc(operations?'save_operations_promotion_draft':'save_promotion_draft',actor.token,{
      p_content_type:'homepage_article',p_slug:`ci-owned-${randomUUID()}`,p_title:'CI operations-owned',p_public_body:'QA content',p_byline_kind:'company',p_public_media:[],p_people_photo:'no',p_number_or_amount:'no',...extra
    });check(saved.ok&&saved.data?.revision_id,'save isolated draft');return saved.data;
  };
  const state=id=>sql(`select lifecycle::text from public.promotion_contents where id='${id}'`);
  const pending=id=>sql(`select stage::text from public.promotion_review_requests where revision_id='${id}' and decision='pending'`);
  const publish=(item,actor=admin,date=null)=>rpc('queue_operations_owned_promotion',actor.token,{p_content_id:item.content_id,p_scheduled_for:date});
  const review=(item,actor,action='approve')=>rpc('review_promotion_revision',actor.token,{p_content_id:item.content_id,p_action:action,p_comment:action==='changes_requested'?'QA changes':null});
  const direct=await draft();equal(state(direct.content_id),'draft','temporary save remains draft');
  const workspace=await rpc('get_my_promotion_workspace',admin.token,{});check(workspace.data.my_items.some(i=>i.content_id===direct.content_id&&i.is_owner===true),'own draft visible');
  check((await publish(direct)).ok,'operations own ordinary direct publication');equal(state(direct.content_id),'published','direct content published');
  equal(sql(`select count(*) from public.promotion_review_requests where revision_id='${direct.revision_id}'`),'0','direct publish creates no fake approvals');
  equal(sql(`select count(*) from public.audit_logs where target_id='${direct.content_id}' and action='operations_direct_published'`),'1','audit records actual direct action');
  check(!(await publish(direct)).ok,'already published direct call rejected');
  const feed=await rpc('list_public_promotion_feed',null,{});check(feed.data.some(i=>i.content_id===direct.content_id),'direct article in public feed');
  const scheduled=await draft({p_content_type:'press_release',p_number_or_amount:'yes'});
  check(!(await publish(scheduled,admin,new Date(Date.now()-1000).toISOString())).ok,'past schedule rejected atomically');equal(state(scheduled.content_id),'draft','invalid schedule preserves draft');
  check((await publish(scheduled,admin,new Date(Date.now()+86400000).toISOString())).ok,'operations-own important ordinary content can schedule');equal(state(scheduled.content_id),'scheduled','future scheduled');
  check(!(await rpc('list_public_promotion_feed',null,{})).data.some(i=>i.content_id===scheduled.content_id),'future schedule absent feed');
  sql(`update public.promotion_publication_queue set scheduled_for=now()-interval '1 second' where revision_id='${scheduled.revision_id}'; select public.private_publish_due_promotions()`);
  equal(state(scheduled.content_id),'published','existing due publisher accepts scoped lane');
  const advisory=await draft({p_number_or_amount:'yes'});
  check((await rpc('submit_operations_promotion_revision',admin.token,{p_content_id:advisory.content_id})).ok,'optional lead request');equal(pending(advisory.revision_id),'lead','advisory lead row');
  check(!(await publish(advisory)).ok,'cannot bypass outstanding lead request');
  check((await review(advisory,lead,'changes_requested')).ok,'lead can return for changes');equal(state(advisory.content_id),'needs_revision','changes return to operations');
  const replacement=await draft({p_content_id:advisory.content_id,p_number_or_amount:'yes'});
  check(replacement.revision_id!==advisory.revision_id,'returned revision immutable; new revision saved');
  await rpc('submit_operations_promotion_revision',admin.token,{p_content_id:advisory.content_id});
  check((await review(replacement,lead)).ok,'lead completes optional review');equal(state(advisory.content_id),'approved','advisory completion is final without operations self review');
  equal(sql(`select count(*) from public.promotion_review_requests where revision_id='${replacement.revision_id}' and stage='operations'`),'0','no operations self-review row');
  check((await publish(replacement)).ok,'operations publishes after advisory');
  const ceo=await signUp('phase1a-ops-owned-ceo@example.test','QA CEO');
  const employee=await rpc('create_employee',admin.token,{p_full_name:'QA CEO employee',p_hired_on:'2026-09-08',p_department_id:departmentId,p_position_id:positionId,p_attendance_required:false});check(employee.ok,'CEO QA employee');
  check((await rpc('approve_signup_request_with_employee',admin.token,{p_target_profile_id:ceo.id,p_employee_uuid:employee.data.employee_uuid,p_role_code:'general_worker',p_reason_summary:'isolated QA CEO link'})).ok,'CEO fixture linked through onboarding API');
  check((await rpc('set_profile_roles',admin.token,{p_target_profile_id:ceo.id,p_role_codes:['ceo'],p_reason_summary:'isolated QA CEO role'})).ok,'separate QA CEO role');
  for(const optional of [false,true]) {
    const gate=await draft({p_byline_kind:'ceo',p_byline:'QA CEO'});
    check(!(await publish(gate)).ok,'CEO direct publish blocked');equal(state(gate.content_id),'draft','CEO rejection preserves editable draft');
    check((await rpc(optional?'submit_operations_promotion_revision':'submit_operations_owned_promotion_for_ceo',admin.token,{p_content_id:gate.content_id})).ok,'CEO submission');
    if(optional){equal(pending(gate.revision_id),'lead','optional CEO pre-review');check((await review(gate,lead)).ok,'CEO pre-review completion');}
    equal(pending(gate.revision_id),'ceo','CEO Gate directly pending; no operations self step');
    check(!(await publish(gate)).ok,'unapproved CEO publish blocked');
    check((await review(gate,ceo,'on_hold')).ok,'CEO hold without date');
    const held=await rpc('get_my_promotion_workspace',ceo.token,{});check(held.data.held_items.some(i=>i.content_id===gate.content_id),'held list');
    check((await rpc('resume_promotion_review',ceo.token,{p_content_id:gate.content_id})).ok,'hold resumes');
    const resumed=await rpc('get_my_promotion_workspace',ceo.token,{});check(!resumed.data.held_items.some(i=>i.content_id===gate.content_id),'resumed no stale held item');
    check((await review(gate,ceo)).ok,'separate CEO approval');equal(state(gate.content_id),'approved','CEO approval never auto publishes');
    check((await publish(gate)).ok,'operations can publish after CEO');
  }
  const foreign=await draft({},staff,false);check(!(await publish(foreign)).ok,'operations cannot publish staff-owned');
  const editedForeign=await draft({p_content_id:foreign.content_id});check(!(await publish(editedForeign)).ok,'operations authoring a foreign-owner revision still denied');
  const leadOwned=await draft({},lead,false);check(!(await publish(leadOwned)).ok,'operations cannot publish lead-owned');
  const own=await draft();check(!(await publish(own,lead)).ok,'lead cannot call operations-own RPC');check(!(await publish(own,staff)).ok,'staff cannot call operations-own RPC');
  check(!(await rpc('queue_promotion_revision',admin.token,{p_content_id:own.content_id})).ok,'global queue still lead-only');
  check(!(await rpc('queue_operations_owned_promotion',null,{p_content_id:own.content_id})).ok,'anon direct publish denied');
  // Preserve staff chain independently of operations lane.
  const staffFlow=await draft({},staff,false);await rpc('submit_promotion_revision',staff.token,{p_content_id:staffFlow.content_id});equal(pending(staffFlow.revision_id),'lead','staff lead review unchanged');
  check((await review(staffFlow,lead)).ok,'lead approves staff ordinary item');check((await rpc('queue_promotion_revision',lead.token,{p_content_id:staffFlow.content_id})).ok,'lead publishes staff item');

  // When operations is the real final approver, approval itself publishes.
  const importantStaff=await draft({p_number_or_amount:'yes'},staff,false);
  check((await rpc('submit_promotion_revision',staff.token,{p_content_id:importantStaff.content_id})).ok,'important staff submit');
  equal(pending(importantStaff.revision_id),'lead','important staff starts at lead');
  check((await review(importantStaff,lead)).ok,'lead advances important staff item');
  equal(pending(importantStaff.revision_id),'operations','important staff reaches operations final review');
  check((await review(importantStaff,admin)).ok,'operations final approval succeeds');
  equal(state(importantStaff.content_id),'published','operations final approval immediately publishes important staff item');
  check((await rpc('list_public_promotion_feed',null,{})).data.some(i=>i.content_id===importantStaff.content_id),'operations-final-approved staff item is in public feed');

  const leadFinal=await draft({},lead,false);
  check((await rpc('submit_promotion_revision',lead.token,{p_content_id:leadFinal.content_id})).ok,'lead-owned submit to operations');
  equal(pending(leadFinal.revision_id),'operations','lead-owned item reaches operations');
  check((await review(leadFinal,admin)).ok,'operations approves lead-owned item');
  equal(state(leadFinal.content_id),'published','operations final approval immediately publishes lead-owned item');
  check((await rpc('list_public_promotion_feed',null,{})).data.some(i=>i.content_id===leadFinal.content_id),'operations-final-approved lead item is in public feed');

  console.log('OPERATIONS_OWNED_PROMOTION_AUTH_PASS');
}

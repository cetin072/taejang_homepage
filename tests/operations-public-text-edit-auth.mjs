import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function operationsPublicTextEditChecks({apiUrl,rpc,sql,signUp,admin,lead,staff,departmentId,positionId,check,equal}) {
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(apiUrl).hostname),'Text edit tests require isolated Supabase');
 const draft=async(actor=admin,extra={})=>{
  const r=await rpc(actor===admin?'save_operations_promotion_draft':'save_promotion_draft',actor.token,{
   p_content_type:'homepage_article',p_slug:`ci-text-${randomUUID()}`,p_title:'Original title',p_summary:'Original summary',p_public_body:'Original body',
   p_byline_kind:'company',p_byline:'태장',p_external_url:'https://taejang.co.kr/archive.html',
   p_hero_image_url:'https://taejang.co.kr/assets/images/taejang-logo.png',
   p_public_media:[{url:'https://taejang.co.kr/assets/images/taejang-logo.png',alt:'QA image'}],
   p_source_reference_url:'https://taejang.co.kr/about.html',p_people_photo:'no',p_number_or_amount:'no',...extra
  });check(r.ok&&r.data?.revision_id,'isolated public-edit draft');return r.data;
 };
 const own=await draft();check((await rpc('queue_operations_owned_promotion',admin.token,{p_content_id:own.content_id})).ok,'own edit fixture published');
 sql(`update public.promotion_contents set published_at=now()-interval '48 hours' where id='${own.content_id}'`);
 const snapshot=id=>sql(`select to_jsonb(c)-'current_revision_id'-'updated_at' from public.promotion_contents c where id='${id}'`);
 const original=snapshot(own.content_id);
 let current=own.revision_id;
 const edit=async(item=own,actor=admin,extra={})=>rpc('operations_update_public_promotion_text',actor.token,{
  p_content_id:item.content_id,p_expected_revision_id:current,p_title:'Original title',p_summary:'Original summary',p_public_body:'Original body',...extra
 });
 for(const fields of [{p_title:'Updated title'},{p_public_body:'Updated body'},{p_summary:'Updated summary'}]) {
  const loaded=await rpc('get_operations_public_promotion_edit',admin.token,{p_content_id:own.content_id});check(loaded.ok,'authorized full original loads');equal(loaded.data.revision_id,current,'loaded optimistic revision');
  const prior=current;
  const result=await edit(own,admin,fields);check(result.ok,'title/body/summary correction allowed after 24h');current=result.data.revision_id;
  check(current!==prior,'new revision generated');equal(snapshot(own.content_id),original,'id/date/type/visibility/owner/link source preserved');
  equal(sql(`select count(*) from public.promotion_content_revisions where id='${prior}' and locked_at is not null`),'1','old locked revision preserved');
  equal(sql(`select count(*) from public.promotion_review_requests where revision_id='${current}'`),'0','no fake approval rows');
  equal(sql(`select count(*) from public.promotion_content_revisions old join public.promotion_content_revisions new on old.id='${own.revision_id}' and new.id='${current}' where (to_jsonb(old)-array['id','revision_no','title','summary','public_body','change_reason','submitted_at','locked_at','created_at'])=(to_jsonb(new)-array['id','revision_no','title','summary','public_body','change_reason','submitted_at','locked_at','created_at'])`),'1','all media/link/byline/risk/lane fields preserved');
  const feed=await rpc('list_public_promotion_feed',null,{});const card=feed.data.find(i=>i.content_id===own.content_id);check(!!card,'edited item remains public');
  const detail=await rpc('get_public_promotion_content',null,{p_content_id:own.content_id});
  equal(detail.data[0].title,fields.p_title||'Original title','detail title fresh');equal(detail.data[0].public_body,fields.p_public_body||'Original body','detail body fresh');equal(card.summary,fields.p_summary||'Original summary','feed summary fresh');
  const manager=await rpc('get_promotion_publication_admin',admin.token,{});equal(manager.data.items.find(i=>i.content_id===own.content_id).title,card.title,'manager/feed agree');
 }
 equal(sql(`select count(*) from public.audit_logs where target_id='${own.content_id}' and action='promotion_operations_public_text_updated' and metadata->>'from_revision_id' is not null and metadata->>'to_revision_id' is not null`),'3','three actual audit events with revision pair');
 check(!(await edit(own,admin,{p_expected_revision_id:own.revision_id,p_title:'Stale overwrite'})).ok,'stale revision conflict rejected');
 equal(sql(`select current_revision_id from public.promotion_contents where id='${own.content_id}'`),current,'conflict does not overwrite');
 check(!(await edit(own,staff)).ok,'staff unauthorized');check(!(await edit(own,lead)).ok,'lead cannot use operations RPC');
 check(!(await rpc('operations_update_public_promotion_text',null,{p_content_id:own.content_id,p_expected_revision_id:current,p_title:'Anon',p_summary:null,p_public_body:null})).ok,'anon cannot edit');
 check(!(await edit(own,admin,{p_byline_kind:'company',p_content_type:'homepage_article'})).ok,'unrecognized risk/type parameters rejected');
 check(!(await rpc('lead_update_recent_promotion_content',lead.token,{p_content_id:own.content_id,p_title:'too late',p_reason:'QA'})).ok,'lead 24h restriction remains');

 const approved=await draft(lead);
 await rpc('submit_promotion_revision',lead.token,{p_content_id:approved.content_id});
 check((await rpc('review_promotion_revision',admin.token,{p_content_id:approved.content_id,p_action:'approve'})).ok,'real operations final approval');
 const reviewBefore=sql(`select jsonb_agg(to_jsonb(q) order by q.id) from public.promotion_review_requests q where revision_id='${approved.revision_id}'`);
 current=approved.revision_id;check((await edit(approved)).ok,'own final approved lead post correction allowed');
 equal(sql(`select jsonb_agg(to_jsonb(q) order by q.id) from public.promotion_review_requests q where revision_id='${approved.revision_id}'`),reviewBefore,'original approval unchanged');
 current=sql(`select current_revision_id from public.promotion_contents where id='${approved.content_id}'`);
 check((await edit(approved,admin,{p_title:'Second correction'})).ok,'approval provenance still usable after new revision');
 current=sql(`select current_revision_id from public.promotion_contents where id='${approved.content_id}'`);
 sql(`update public.promotion_contents set lifecycle='hidden' where id='${approved.content_id}'`);
 const hiddenLoaded=await rpc('get_operations_public_promotion_edit',admin.token,{p_content_id:approved.content_id});check(hiddenLoaded.ok&&hiddenLoaded.data.public_body,'hidden original loads through authorized RPC');
 check((await edit(approved)).ok,'hidden text editable');equal(sql(`select lifecycle from public.promotion_contents where id='${approved.content_id}'`),'hidden','edit keeps hidden');
 check(!(await rpc('list_public_promotion_feed',null,{})).data.some(i=>i.content_id===approved.content_id),'hidden stays absent feed');

 const foreign=await draft(staff);
 await rpc('submit_promotion_revision',staff.token,{p_content_id:foreign.content_id});
 await rpc('review_promotion_revision',lead.token,{p_content_id:foreign.content_id,p_action:'approve'});
 await rpc('queue_promotion_revision',lead.token,{p_content_id:foreign.content_id});
 current=foreign.revision_id;check(!(await edit(foreign)).ok,'ordinary staff post without own final approval denied');
 check(!(await rpc('get_operations_public_promotion_edit',admin.token,{p_content_id:foreign.content_id})).ok,'unrelated edit source denied');
 const other=await signUp('phase1a-public-edit-other@example.test','QA other operations');
 const employee=await rpc('create_employee',admin.token,{p_full_name:'QA other operations',p_hired_on:'2026-09-08',p_department_id:departmentId,p_position_id:positionId,p_attendance_required:false});
 check(employee.ok,'other operations fixture employee');
 check((await rpc('approve_signup_request_with_employee',admin.token,{p_target_profile_id:other.id,p_employee_uuid:employee.data.employee_uuid,p_role_code:'general_worker',p_reason_summary:'isolated text edit QA'})).ok,'other operations onboarding');
 check((await rpc('set_profile_roles',admin.token,{p_target_profile_id:other.id,p_role_codes:['operations_manager'],p_reason_summary:'isolated QA'})).ok,'other operations role');
 current=sql(`select current_revision_id from public.promotion_contents where id='${own.content_id}'`);
 check(!(await edit(own,other)).ok,'different operations manager cannot edit own post');
 current=sql(`select current_revision_id from public.promotion_contents where id='${approved.content_id}'`);
 check(!(await edit(approved,other)).ok,'different operations manager cannot claim final approval');
 check(!(await edit(approved,admin,{p_title:' '})).ok,'empty title rejected');
 check(!(await edit(approved,admin,{p_title:'X'.repeat(161)})).ok,'oversized title rejected without changing data');

 check((await rpc('lead_update_recent_promotion_content',lead.token,{p_content_id:foreign.content_id,p_title:'Recent lead correction',p_reason:'QA'})).ok,'lead 24h direct correction preserved');

 const ceo=await draft(admin,{p_byline_kind:'ceo'});
 current=ceo.revision_id;check(!(await edit(ceo)).ok,'unpublished CEO item denied');
 // Existing integration covers real CEO approval. This locked published fixture
 // tests immutable classification even when publication was already authorized.
 sql(`update public.promotion_contents set lifecycle='published',published_at=now(),minimum_review_stage='ceo' where id='${ceo.content_id}'`);
 check(!(await edit(ceo)).ok,'published CEO byline and minimum gate cannot be bypassed');
 const policy=await draft();current=policy.revision_id;
 sql(`update public.promotion_contents set lifecycle='published',published_at=now(),minimum_review_stage='ceo' where id='${policy.content_id}'`);
 check(!(await edit(policy)).ok,'company byline with CEO minimum still denied');
 sql(`update public.profiles set account_status='suspended' where id='${admin.id}'`);
 check(!(await edit(policy)).ok,'inactive profile denied');
 sql(`update public.profiles set account_status='active' where id='${admin.id}'`);
 console.log('OPERATIONS_PUBLIC_TEXT_EDIT_AUTH_PASS');
}

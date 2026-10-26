#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
// This suite uses the seeded Phase 1A administrator, so it must share the
// isolated CI fixture password used by the preceding integration suites.
const password = 'Phase1A-Test-Only-2026!';
assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(key, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');
assert.ok(['127.0.0.1','localhost','kong'].includes(new URL(apiUrl).hostname), 'notice fixture writes require an isolated DB');

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token || key}`, ...headers },
    body
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

const rpc = (name, token, body = {}) => request(`/rest/v1/rpc/${name}`, {
  method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

async function signUp(email, displayName) {
  const result = await request('/auth/v1/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: { display_name: displayName } })
  });
  check(result.ok, `signup failed for ${email}`);
  return { id: result.data.user.id, token: result.data.access_token, displayName, session: result.data };
}

async function approve(adminToken, account, departmentId, positionId, role) {
  const employee = await rpc('create_employee', adminToken, {
    p_full_name: account.displayName, p_hired_on: '2020-01-01', p_department_id: departmentId,
    p_position_id: positionId, p_attendance_required: true
  });
  equal(employee.data?.code, 'EMPLOYEE_CREATED', `${role} employee is created`);
  const approval = await rpc('approve_signup_request_with_employee', adminToken, {
    p_target_profile_id: account.id, p_employee_uuid: employee.data.employee_uuid,
    p_role_code: 'general_worker', p_reason_summary: 'Issue 300 isolated account approval'
  });
  equal(approval.data?.code, 'EMPLOYEE_ACCOUNT_APPROVED', `${role} account is approved`);
  if (role !== 'general_worker') {
    const roles = await rpc('set_profile_roles', adminToken, {
      p_target_profile_id: account.id, p_role_codes: [role], p_reason_summary: 'Issue 300 role fixture'
    });
    equal(roles.data?.code, 'ROLES_CHANGED', `${role} role is assigned`);
  }
}

const target = (scope, id = null) => ({
  p_target_scope: scope, p_target_department_id: scope === 'department' ? id : null,
  p_target_work_group_id: null, p_target_profile_id: scope === 'profile' ? id : null
});
const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const noticePayload = (overrides = {}) => ({
  p_notice_id: null, p_notice_kind: 'safety', p_importance: 'important', p_title: 'Issue 300 사진 공지',
  p_body_easy: '사진 자료를 함께 확인합니다.', p_publish_start_at: new Date(Date.now() - 3600000).toISOString(),
  p_publish_end_at: new Date(Date.now() + 86400000).toISOString(), p_effective_start_date: kstDate,
  p_effective_end_date: kstDate, p_location: null, p_materials_text: null, p_related_schedule_id: null,
  p_related_work_guide_id: null, p_related_link_url: null, p_related_link_label: null,
  p_requires_acknowledgement: true, p_status: 'draft', p_change_reason: 'Issue 300 test draft', ...overrides
});

const adminLogin = await request('/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'phase1a-worker@example.test', password })
});
check(adminLogin.ok, 'fixture super admin signs in');
const adminToken = adminLogin.data.access_token;
const references = await request('/rest/v1/departments?select=id,code', { token: adminToken });
const positions = await request('/rest/v1/positions?select=id,code', { token: adminToken });
check(references.ok && positions.ok, 'fixture reference data is readable');
const department = code => references.data.find(row => row.code === code)?.id;
const position = code => positions.data.find(row => row.code === code)?.id;

const operations = await signUp('issue300-operations@example.test', 'Issue 300 운영총괄');
const promotion = await signUp('issue300-promotion@example.test', 'Issue 300 홍보팀장');
const recipient = await signUp('issue300-recipient@example.test', 'Issue 300 대상 근로자');
const outsider = await signUp('issue300-outsider@example.test', 'Issue 300 비대상 근로자');
await approve(adminToken, operations, department('operations'), position('operations_manager'), 'operations_manager');
await approve(adminToken, promotion, department('promotion'), position('staff'), 'promotion_lead');
await approve(adminToken, recipient, department('promotion'), position('general_worker'), 'general_worker');
await approve(adminToken, outsider, department('logistics'), position('general_worker'), 'general_worker');

const promotionDraft = await rpc('save_notice', promotion.token, noticePayload({ ...target('department', department('promotion')) }));
equal(promotionDraft.data?.code, 'NOTICE_SAVED', 'promotion lead saves an in-scope draft');
const directPublish = await rpc('save_notice', promotion.token, noticePayload({ p_title: '차단된 직접 게시', p_status: 'published', ...target('department', department('promotion')) }));
equal(directPublish.data?.code, 'OPERATIONS_REVIEW_REQUIRED', 'promotion lead cannot publish directly');
const submitted = await rpc('submit_notice_for_operations_review', promotion.token, { p_notice_id: promotionDraft.data.id, p_reason: '운영 검토 요청' });
equal(submitted.data?.code, 'NOTICE_SUBMITTED_FOR_REVIEW', 'promotion lead submits draft');
const operationsList = await rpc('list_manageable_notices', operations.token, { p_limit: 200 });
check(operationsList.data.some(item => item.id === promotionDraft.data.id && item.review_state === 'submitted'), 'operations sees submitted notice');

const published = await rpc('save_notice', operations.token, noticePayload({
  p_notice_id: promotionDraft.data.id, p_status: 'published', p_title: '검토 완료 사진 공지',
  p_change_reason: '운영총괄 검토 및 게시', ...target('department', department('promotion'))
}));
equal(published.data?.code, 'NOTICE_SAVED', 'operations manager edits and publishes submitted notice');
const reviewedList = await rpc('list_manageable_notices', operations.token, { p_limit: 200 });
check(reviewedList.data.some(item => item.id === promotionDraft.data.id && item.review_state === 'reviewed'), 'published submission records operations review');

// Issue #446: an owner is not authorized to overwrite an operations-approved notice.
const approvedDowngrade = await rpc('save_notice', promotion.token, noticePayload({
  p_notice_id: promotionDraft.data.id, p_status: 'draft', p_title: '446 forged approved downgrade',
  ...target('department', department('promotion'))
}));
check(!approvedDowngrade.ok || approvedDowngrade.data?.ok === false,
  '446 BLOCK APPROVED DOWNGRADE: lead cannot erase publication/review with legacy draft save');
console.log('NOTICE_446_APPROVED_DOWNGRADE_GUARD_PASS');

const path = `${promotionDraft.data.id}/issue300.png`;
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]);
const upload = await request(`/storage/v1/object/notice-media/${encodeURIComponent(path)}`, {
  method: 'POST', token: operations.token, headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' }, body: png
});
check(upload.ok, 'operations uploads a permitted notice photo');
const media = await rpc('add_notice_media', operations.token, { p_notice_id: promotionDraft.data.id, p_storage_path: path, p_mime_type: 'image/png', p_alt_text: '검토된 사진 자료', p_display_order: 0 });
equal(media.data?.code, 'NOTICE_MEDIA_ADDED', 'operations registers uploaded photo metadata');
const detail = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: promotionDraft.data.id });
check(detail.ok && detail.data.media.length === 1, 'target worker receives photo metadata in detail');
const targetRead = await request(`/storage/v1/object/authenticated/notice-media/${encodeURIComponent(path)}`, { token: recipient.token });
check(targetRead.ok, 'target worker can read notice photo');
const outsideRead = await request(`/storage/v1/object/authenticated/notice-media/${encodeURIComponent(path)}`, { token: outsider.token });
check(!outsideRead.ok, 'non-target worker cannot read notice photo');
const forgedMetadata = await rpc('add_notice_media', operations.token, { p_notice_id: promotionDraft.data.id, p_storage_path: `${recipient.id}/forged.png`, p_mime_type: 'image/png', p_alt_text: '위조 경로', p_display_order: 1 });
check(!forgedMetadata.ok, 'other notice storage path cannot be registered');
const directRows = await request('/rest/v1/notice_media?select=*', { token: recipient.token });
check(!directRows.ok, 'workers cannot directly query notice media metadata');
const archived = await rpc('archive_notice_media', operations.token, { p_media_id: media.data.id, p_reason: '사진 교체' });
equal(archived.data?.code, 'NOTICE_MEDIA_ARCHIVED', 'operations archives photo metadata');
const noMedia = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: promotionDraft.data.id });
equal(noMedia.data.media.length, 0, 'archived photo no longer appears for worker');

// Issue #444 UI uses these unchanged RPCs in private-save -> media -> publish order.
const uxTarget = target('department', department('promotion'));
const privateDraft = await rpc('save_notice', operations.token, noticePayload({ ...uxTarget, p_requires_acknowledgement: false, p_importance: 'normal', p_title: 'Issue 444 private first' }));
equal(privateDraft.data?.code, 'NOTICE_SAVED', '444 operations first saves private draft');
const draftRead = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: privateDraft.data.id });
check(!draftRead.ok, '444 draft not exposed to recipient before photos/publish');
const scheduledLead = await rpc('save_notice', promotion.token, noticePayload({ ...uxTarget, p_status: 'published', p_publish_start_at: new Date(Date.now()+86400000).toISOString() }));
equal(scheduledLead.data?.code, 'OPERATIONS_REVIEW_REQUIRED', '444 server rejects lead scheduled publication too');
const futureTime = new Date(Date.now()+86400000).toISOString();
const reserved = await rpc('save_notice', operations.token, noticePayload({ ...uxTarget, p_notice_id: privateDraft.data.id, p_status: 'published', p_publish_start_at: futureTime, p_publish_end_at: new Date(Date.now()+172800000).toISOString() }));
equal(reserved.data?.code, 'NOTICE_SAVED', '444 operations schedules draft with same id');
const earlyRead = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: privateDraft.data.id });
check(!earlyRead.ok, '444 reserved notice unavailable before its start');
const visiblePayload = noticePayload({ ...uxTarget, p_notice_id: privateDraft.data.id, p_status: 'published', p_title: 'Issue 444 immediate' });
const immediate = await rpc('save_notice', operations.token, visiblePayload);
equal(immediate.data?.code, 'NOTICE_SAVED', '444 operations can make notice current');
const visibleRead = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: privateDraft.data.id });
check(visibleRead.ok && visibleRead.data.title === 'Issue 444 immediate', '444 target recipient sees current published notice');
const deniedRead = await rpc('get_my_notice_detail', outsider.token, { p_notice_id: privateDraft.data.id });
check(!deniedRead.ok, '444 different department never sees notice');
const existingEdit = await rpc('save_notice', operations.token, { ...visiblePayload, p_title: 'Issue 444 published edit' });
equal(existingEdit.data?.code, 'NOTICE_SAVED', '444 existing edit retains published status');
const editedRead = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: privateDraft.data.id });
equal(editedRead.data?.title, 'Issue 444 published edit', '444 published edit immediately visible within target');
for (const status of ['cancelled','inactive']) {
  const stopped = await rpc('save_notice', operations.token, { ...visiblePayload, p_status: status });
  equal(stopped.data?.code, 'NOTICE_SAVED', `444 intentional ${status} remains supported`);
  const stoppedRead = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: privateDraft.data.id });
  check(!stoppedRead.ok, `444 ${status} notice not exposed`);
}
// #446: real roles, company-only guarded writer, ownership evidence and Storage.
const routinePayload = overrides => noticePayload({ ...target('company'), p_notice_kind:'general', p_importance:'normal', p_requires_acknowledgement:false, p_confirm_routine:true, ...overrides });
const leadSave = overrides => rpc('save_lead_notice', promotion.token, routinePayload(overrides));
const refused = (result,message) => check(!result.ok || result.data?.ok===false,message);
const otherLead = await signUp('issue446-other-lead@example.test','Issue 446 다른 운영팀장');
await approve(adminToken,otherLead,department('promotion'),position('staff'),'promotion_lead');
let ownedId;
for (const kind of ['general','external_activity','training','transport','materials','clothing','company_life']) {
 const draft=await leadSave({p_notice_kind:kind,p_title:'446 '+kind});equal(draft.data?.code,'NOTICE_SAVED','446 allowed kind draft '+kind);
 const id=draft.data.id;
 const privateRead=await rpc('get_my_notice_detail',outsider.token,{p_notice_id:id});check(!privateRead.ok,'446 draft private '+kind);
 const post=await leadSave({p_notice_id:id,p_notice_kind:kind,p_status:'published',p_title:'446 '+kind});equal(post.data?.code,'NOTICE_SAVED','446 publish allowed kind '+kind);
 const companyRead=await rpc('get_my_notice_detail',outsider.token,{p_notice_id:id});check(companyRead.ok&&companyRead.data.title==='446 '+kind,'446 company recipient different department '+kind);
 ownedId=id;
}
refused(await leadSave({p_status:'published'}),'446 cannot skip draft phase');
for(const kind of ['safety','working_hours','holiday','work_location']){
 const draft=await leadSave({p_notice_kind:kind});equal(draft.data?.lead_notice_mode,'review','446 sensitive draft routes to review '+kind);
 refused(await leadSave({p_notice_id:draft.data.id,p_notice_kind:kind,p_status:'published'}),'446 sensitive kind cannot publish '+kind);
 refused(await leadSave({p_notice_id:draft.data.id,p_status:'published'}),'446 review draft cannot launder classification '+kind);
}
for(const importance of ['important','urgent'])refused(await leadSave({p_notice_id:ownedId,p_importance:importance,p_status:'published'}),'446 importance escalation denied '+importance);
refused(await leadSave({p_notice_id:ownedId,p_requires_acknowledgement:true,p_status:'published'}),'446 acknowledgement escalation denied');
refused(await leadSave({p_notice_id:ownedId,p_status:'published',p_confirm_routine:false}),'446 affirmative routine confirmation required');
for(const scope of ['department','work_group','profile'])refused(await leadSave({...target(scope,department('promotion'))}),'446 rejects noncompany target '+scope);
refused(await leadSave({p_target_department_id:department('promotion')}),'446 mismatched company ids denied');
refused(await leadSave({p_related_schedule_id:otherLead.id}),'446 forged related schedule denied');
refused(await leadSave({p_related_work_guide_id:otherLead.id}),'446 forged related guide denied');
refused(await rpc('save_lead_notice',undefined,routinePayload({})),'446 anonymous writer denied');
refused(await rpc('save_lead_notice',recipient.token,routinePayload({})),'446 employee cannot call guarded writer');
refused(await rpc('save_lead_notice',operations.token,routinePayload({})),'446 operations uses unchanged original writer');
refused(await rpc('save_lead_notice',otherLead.token,routinePayload({p_notice_id:ownedId,p_status:'inactive'})),'446 other lead cannot stop own direct notice');
refused(await leadSave({p_notice_id:promotionDraft.data.id,p_status:'published'}),'446 creator cannot use direct path on operations-approved manuscript');
refused(await leadSave({p_notice_id:privateDraft.data.id,p_status:'inactive'}),'446 cannot stop someone elses legacy notice');
refused(await rpc('save_notice',promotion.token,noticePayload({...target('company'),p_notice_id:ownedId,p_status:'draft'})),'446 old writer cannot downgrade direct published notice');
refused(await leadSave({p_notice_id:ownedId,p_status:'draft'}),'446 dedicated writer cannot downgrade published notice');
refused(await rpc('save_notice',promotion.token,noticePayload({...target('department',department('promotion')),p_notice_id:ownedId,p_status:'draft'})),'446 cannot launder direct notice through forged legacy department target');
refused(await leadSave({p_notice_id:ownedId,p_status:'cancelled'}),'446 lead cannot forge arbitrary status');
refused(await rpc('save_lead_notice',promotion.token,{...routinePayload({}),p_created_by:otherLead.id}),'446 cannot spoof creator parameter');
const rawPatch=await request('/rest/v1/notices?id=eq.'+ownedId,{method:'PATCH',token:promotion.token,headers:{'Content-Type':'application/json'},body:JSON.stringify({lead_notice_mode:'routine',created_by:promotion.id})});check(!rawPatch.ok,'446 markers not client writable');
const rawDelete=await request('/rest/v1/notices?id=eq.'+ownedId,{method:'DELETE',token:promotion.token});check(!rawDelete.ok,'446 no physical notice delete');
const mediaPath=ownedId+'/446-own.png';
const leadUpload=await request('/storage/v1/object/notice-media/'+encodeURIComponent(mediaPath),{method:'POST',token:promotion.token,headers:{'Content-Type':'image/png','x-upsert':'false'},body:png});check(leadUpload.ok,'446 owner uploads own routine photo');
const ownMedia=await rpc('add_notice_media',promotion.token,{p_notice_id:ownedId,p_storage_path:mediaPath,p_mime_type:'image/png',p_alt_text:'446 photo',p_display_order:0});equal(ownMedia.data?.code,'NOTICE_MEDIA_ADDED','446 own photo metadata');
const foreignUpload=await request('/storage/v1/object/notice-media/'+encodeURIComponent(ownedId+'/446-forged.png'),{method:'POST',token:otherLead.token,headers:{'Content-Type':'image/png','x-upsert':'false'},body:png});check(!foreignUpload.ok,'446 other lead cannot upload into owner notice');
refused(await rpc('update_notice_media',otherLead.token,{p_media_id:ownMedia.data.id,p_alt_text:'forged',p_display_order:0}),'446 other lead cannot mutate media');
refused(await rpc('archive_notice_media',otherLead.token,{p_media_id:ownMedia.data.id,p_reason:'forged'}),'446 other lead cannot archive media');
const foreignDelete=await request('/storage/v1/object/notice-media/'+encodeURIComponent(mediaPath),{method:'DELETE',token:otherLead.token});check(!foreignDelete.ok,'446 other lead cannot delete Storage object');
refused(await rpc('add_notice_media',promotion.token,{p_notice_id:ownedId,p_storage_path:promotionDraft.data.id+'/forged.png',p_mime_type:'image/png',p_alt_text:'forged',p_display_order:1}),'446 forged media path denied');
const edit=await leadSave({p_notice_id:ownedId,p_status:'published',p_title:'446 edited'});equal(edit.data?.code,'NOTICE_SAVED','446 own published edit');
const edited=await rpc('get_my_notice_detail',recipient.token,{p_notice_id:ownedId});check(edited.ok&&edited.data.title==='446 edited'&&edited.data.media.length===1,'446 id and media survive edit');
const stopped=await leadSave({p_notice_id:ownedId,p_status:'inactive'});equal(stopped.data?.code,'NOTICE_SAVED','446 owner stops publication');
const stoppedView=await rpc('get_my_notice_detail',recipient.token,{p_notice_id:ownedId});check(!stoppedView.ok,'446 stopped hidden from employee');
const leadHistory=await rpc('list_manageable_notices',promotion.token,{p_limit:200});check(leadHistory.data.some(n=>n.id===ownedId&&n.status==='inactive'&&n.lead_direct_published_at),'446 stopped owned history remains manageable');
const scheduledDraft=await leadSave({p_title:'446 reservation'});const scheduledId=scheduledDraft.data.id;
const scheduled=await leadSave({p_notice_id:scheduledId,p_status:'published',p_publish_start_at:new Date(Date.now()+86400000).toISOString(),p_publish_end_at:new Date(Date.now()+172800000).toISOString()});equal(scheduled.data?.code,'NOTICE_SAVED','446 lead reserves');
check(!(await rpc('get_my_notice_detail',outsider.token,{p_notice_id:scheduledId})).ok,'446 reservation unavailable before start');
const privateMediaPath=scheduledId+'/446-reservation.png';check((await request('/storage/v1/object/notice-media/'+encodeURIComponent(privateMediaPath),{method:'POST',token:promotion.token,headers:{'Content-Type':'image/png','x-upsert':'false'},body:png})).ok,'446 owner uploads scheduled photo');
check(!(await request('/storage/v1/object/authenticated/notice-media/'+encodeURIComponent(privateMediaPath),{token:otherLead.token})).ok,'446 private scheduled photo unreadable by other lead');
const expired=await leadSave({p_notice_id:scheduledId,p_status:'published',p_publish_start_at:new Date(Date.now()-7200000).toISOString(),p_publish_end_at:new Date(Date.now()-3600000).toISOString()});equal(expired.data?.code,'NOTICE_SAVED','446 past window preserved by server');
check(!(await rpc('get_my_notice_detail',outsider.token,{p_notice_id:scheduledId})).ok,'446 expired notice unavailable');
const reviewDraft=await leadSave({p_notice_kind:'safety',p_importance:'important',p_requires_acknowledgement:true});equal(reviewDraft.data?.code,'NOTICE_SAVED','446 sensitive company draft');
const reviewId=reviewDraft.data.id;
equal((await rpc('submit_notice_for_operations_review',promotion.token,{p_notice_id:reviewId,p_reason:'446 safety review'})).data?.code,'NOTICE_SUBMITTED_FOR_REVIEW','446 company draft existing submit path');
refused(await leadSave({p_notice_id:reviewId}),'446 submitted record locked against lead edits');
const opsPublish=await rpc('save_notice',operations.token,noticePayload({...target('company'),p_notice_id:reviewId,p_status:'published'}));equal(opsPublish.data?.code,'NOTICE_SAVED','446 operations publishes sensitive company notice');
refused(await leadSave({p_notice_id:reviewId,p_status:'inactive'}),'446 creator cannot stop reviewed own manuscript');
const reviewed=await rpc('list_manageable_notices',operations.token,{p_limit:200});check(reviewed.data.some(n=>n.id===reviewId&&n.review_state==='reviewed'&&n.reviewed_by===operations.id),'446 approval history preserved');
const takeover=await rpc('save_notice',operations.token,noticePayload({...target('company'),p_notice_id:scheduledId,p_status:'published',p_notice_kind:'general',p_importance:'normal',p_requires_acknowledgement:false}));equal(takeover.data?.code,'NOTICE_SAVED','446 operations can take over direct notice');
refused(await leadSave({p_notice_id:scheduledId,p_status:'inactive'}),'446 operations takeover revokes lead direct control');
const retarget=await rpc('save_notice',operations.token,noticePayload({...target('profile',outsider.id),p_notice_id:scheduledId,p_status:'published'}));equal(retarget.data?.code,'NOTICE_SAVED','446 operations private retarget still works');
const ownerListAfterRetarget=await rpc('list_manageable_notices',promotion.token,{p_limit:200});check(!ownerListAfterRetarget.data.some(n=>n.id===scheduledId),'446 origin ownership does not reveal operations private retarget');
check(!(await request('/storage/v1/object/authenticated/notice-media/'+encodeURIComponent(privateMediaPath),{token:promotion.token})).ok,'446 origin ownership cannot read foreign private photo');
const suspend=await rpc('change_account_status',adminToken,{p_target_profile_id:otherLead.id,p_new_status:'suspended',p_reason_summary:'446 isolated active guard'});equal(suspend.data?.code,'STATUS_CHANGED','446 suspend synthetic lead');
refused(await rpc('save_lead_notice',otherLead.token,routinePayload({})),'446 inactive actor denied');
console.log('NOTICE_446_ROUTINE_AUTH_PASS');

// Writes below are synthetic, isolated CI fixtures, never hosted user notices.
check(['127.0.0.1','localhost','kong'].includes(new URL(apiUrl).hostname),'history writes require an isolated DB');
const historyPayload = overrides => noticePayload({...target('company'),p_title:'History ops published',p_status:'published',...overrides});
const historySave=await rpc('save_notice',operations.token,historyPayload({}));
equal(historySave.data?.code,'NOTICE_SAVED','operations creates company publication');
const historyId=historySave.data.id;
const exactBefore=await rpc('get_manageable_notice',operations.token,{p_notice_id:historyId});
check(exactBefore.ok&&exactBefore.data.id===historyId&&exactBefore.data.can_edit,'exact operations detail');
check(exactBefore.data.can_read_ack_summary===true,'operations keeps acknowledgement summary access');
check(Object.hasOwn(exactBefore.data,'change_reason'),'authorized management retains original edit metadata');
const historyPhotoPath=historyId+'/history-edit.png';
check((await request('/storage/v1/object/notice-media/'+encodeURIComponent(historyPhotoPath),{method:'POST',token:operations.token,headers:{'Content-Type':'image/png','x-upsert':'false'},body:png})).ok,'operations uploads published notice photo');
const historyPhoto=await rpc('add_notice_media',operations.token,{p_notice_id:historyId,p_storage_path:historyPhotoPath,p_mime_type:'image/png',p_alt_text:'Before photo edit',p_display_order:0});
equal(historyPhoto.data?.code,'NOTICE_MEDIA_ADDED','published photo registration');
const historyEdited=await rpc('save_notice',operations.token,historyPayload({p_notice_id:historyId,p_title:'History corrected',p_body_easy:'Corrected published body',p_publish_start_at:exactBefore.data.publish_start_at,p_publish_end_at:exactBefore.data.publish_end_at,p_related_link_url:'https://example.com/history',p_related_link_label:'History link'}));
equal(historyEdited.data?.id,historyId,'operations correction keeps exact ID');
check(historyEdited.data.version_no>exactBefore.data.version_no,'correction increments version');
check((await rpc('update_notice_media',operations.token,{p_media_id:historyPhoto.data.id,p_alt_text:'Corrected photo',p_display_order:0})).data?.ok,'operations edits published photo metadata');
const exactAfter=await rpc('get_manageable_notice',operations.token,{p_notice_id:historyId});
equal(exactAfter.data?.body_easy,'Corrected published body','body readback confirms actual update');
equal(exactAfter.data?.status,'published','published status preserved');
equal(exactAfter.data?.target_scope,'company','audience preserved');
equal(exactAfter.data?.publish_start_at,exactBefore.data.publish_start_at,'exact timestamp preserved');
equal(exactAfter.data?.media?.[0]?.alt_text,'Corrected photo','photo readback');
const employeeAfter=await rpc('get_my_notice_detail',recipient.token,{p_notice_id:historyId});
check(employeeAfter.ok&&employeeAfter.data.body_easy==='Corrected published body'&&employeeAfter.data.version_no===exactAfter.data.version_no,'employee app sees corrected same-ID version');
// The outbox is intentionally not exposed by Data API. Inspect only this local
// synthetic notice via the same Docker/psql boundary as the push regression.
check(/^[0-9a-f-]{36}$/i.test(historyId)&&Number.isInteger(exactAfter.data.version_no),'safe isolated event identifiers');
const fixtureContainer=execFileSync('docker',['ps','--filter','name=supabase_db_taejang-homepage-phase1a','--format','{{.ID}}'],{encoding:'utf8'}).trim();
check(Boolean(fixtureContainer),'isolated outbox container exists');
const versionEventCount=execFileSync('docker',['exec',fixtureContainer,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-tA','-c',
 `select count(*) from public.notification_events where notice_id='${historyId}'::uuid and notice_version=${exactAfter.data.version_no}`],{encoding:'utf8'}).trim();
equal(versionEventCount,'1','corrected published version has exactly one notification event');
const historyAudit=await rpc('get_target_audit_trail',operations.token,{p_target_type:'notice',p_target_id:historyId,p_limit:100});
check(historyAudit.ok&&historyAudit.data.some(row=>row.action==='notice_updated'||row.action==='notice_published'),'same-ID correction audit retained');
const leadRead=await rpc('get_manageable_notice',promotion.token,{p_notice_id:historyId});
check(leadRead.ok&&leadRead.data.can_edit===false&&leadRead.data.can_lead_edit===false,'lead can read other publisher but cannot edit');
check(leadRead.data.can_read_ack_summary===false,'read-only company notice never grants acknowledgement management');
check(!Object.hasOwn(leadRead.data,'change_reason')&&!Object.hasOwn(leadRead.data,'updated_by'),'new foreign-public read scope excludes internal edit reasons and actor IDs');
check(!(await rpc('get_notice_ack_summary',promotion.token,{p_notice_id:historyId})).ok,'acknowledgement summary remains server denied');
check((await request('/storage/v1/object/authenticated/notice-media/'+encodeURIComponent(historyPhotoPath),{token:promotion.token})).ok,'lead can read published company photo');
refused(await rpc('save_notice',promotion.token,historyPayload({p_notice_id:historyId})),'read permission never authorizes original writer');
refused(await leadSave({p_notice_id:historyId,p_status:'inactive'}),'read permission never authorizes lead writer');
refused(await rpc('update_notice_media',promotion.token,{p_media_id:historyPhoto.data.id,p_alt_text:'forged',p_display_order:0}),'read permission never authorizes media edits');
check(!(await rpc('archive_notice',promotion.token,{p_notice_id:historyId,p_reason:'forged'})).ok,'read permission cannot archive foreign publication');
const historyExpired=await rpc('save_notice',operations.token,historyPayload({p_title:'History expired',p_publish_start_at:new Date(Date.now()-7200000).toISOString(),p_publish_end_at:new Date(Date.now()-3600000).toISOString()}));
const historyScheduled=await rpc('save_notice',operations.token,historyPayload({p_title:'History future private',p_publish_start_at:new Date(Date.now()+3600000).toISOString()}));
const historyPrivate=await rpc('save_notice',operations.token,historyPayload({...target('department',department('operations')),p_title:'History unauthorized department'}));
const historyDraft=await rpc('save_notice',operations.token,historyPayload({p_title:'History foreign draft',p_status:'draft'}));
const leadPage=await rpc('list_manageable_notices_page',promotion.token,{p_limit:100,p_search:'History'});
check(leadPage.ok&&leadPage.data.items.some(row=>row.id===historyId)&&leadPage.data.items.some(row=>row.id===historyExpired.data.id),'lead reads published and expired company history');
for(const hidden of [historyScheduled,historyPrivate,historyDraft]){
 check(!leadPage.data.items.some(row=>row.id===hidden.data.id),'page excludes unauthorized or not-yet-public foreign item');
 check(!(await rpc('get_manageable_notice',promotion.token,{p_notice_id:hidden.data.id})).ok,'exact read enforces same privacy boundary');
}
check(!(await rpc('get_my_notice_detail',recipient.token,{p_notice_id:historyExpired.data.id})).ok,'expired history is not current employee content');
check(!(await rpc('list_manageable_notices_page',recipient.token,{})).ok,'ordinary employee cannot query management history');
check(!(await rpc('list_manageable_notices_page',undefined,{})).ok,'anonymous history denied');
check(!(await rpc('private_notice_management_json',promotion.token,{p_notice_id:historyId})).ok,'private JSON helper not executable by client');
// A preset keeps the operator identity, whereas an actual lead has its own
// account/ownership. Both must use the same server read/write boundary.
equal((await rpc('set_role_simulation_mode',operations.token,{p_role_code:'promotion_lead'})).data?.code,'ROLE_SIMULATION_SET','lead role preview starts');
const previewPage=await rpc('list_manageable_notices_page',operations.token,{p_limit:100,p_search:'History'});
check(previewPage.ok&&previewPage.data.items.some(row=>row.id===historyId),'lead preset reads public company notice');
check(!previewPage.data.items.some(row=>row.id===historyScheduled.data.id),'lead preset cannot read unpublished future company notice');
check((await rpc('get_today_board_admin_options',operations.token)).ok,'lead preset independently obtains notice options');
equal((await rpc('set_role_simulation_mode',operations.token,{p_role_code:'actual'})).data?.code,'ROLE_SIMULATION_CLEARED','operator identity restored');
check((await rpc('archive_notice',operations.token,{p_notice_id:historyId,p_reason:'Isolated archive flow'})).data?.ok,'explicit existing archive RPC');
const archivedDetail=await rpc('get_manageable_notice',operations.token,{p_notice_id:historyId});
check(archivedDetail.data.archived_at&&archivedDetail.data.can_edit===false&&archivedDetail.data.can_restore,'archive readable and immutable until restore');
const archivePage=await rpc('list_manageable_notices_page',operations.token,{p_archive:true,p_search:'History corrected'});
equal(archivePage.data?.items?.[0]?.id,historyId,'archive search finds original record without data movement');
check(!(await rpc('get_manageable_notice',promotion.token,{p_notice_id:historyId})).ok,'foreign archive not disclosed');
check((await rpc('restore_notice',operations.token,{p_notice_id:historyId,p_reason:'Isolated restore flow'})).data?.ok,'existing restore RPC retains history');

// Reproduce the hosted PGRST303 path with genuinely expired, signed JWTs from
// the isolated GoTrue container. Never print the local signing secret or tokens.
const localSigningSecret=execFileSync('docker',['exec','supabase_auth_taejang-homepage-phase1a','printenv','GOTRUE_JWT_SECRET'],{encoding:'utf8'}).trim();
check(Boolean(localSigningSecret),'isolated JWT signer is available');
const appSource=readFileSync('app/assets/app.js','utf8');
const realTransport=appSource.slice(appSource.indexOf('  let sessionRefresh = null;'),appSource.indexOf('  async function context()'));
check(realTransport.includes('retryAuthentication'),'test uses refreshed production RPC transport');
async function verifyExpiredNoticeWrite(actor,name,payload){
 const before=await rpc('get_manageable_notice',actor.token,{p_notice_id:payload.p_notice_id});
 const claims={...JSON.parse(Buffer.from(actor.token.split('.')[1],'base64url')),exp:Math.floor(Date.now()/1000)-3600};
 const unsigned=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
 const expiredToken=unsigned+'.'+createHmac('sha256',localSigningSecret).update(unsigned).digest('base64url');
 const rejected=await rpc(name,expiredToken,payload);
 equal(rejected.status,401,'expired notice write rejected before execution');equal(rejected.data?.code,'PGRST303','real claims-expiration error reproduced');
 const transportState={config:{url:apiUrl,publishableKey:key},session:{...actor.session,access_token:expiredToken}};
 const transportCalls=[];
 const sandbox={state:transportState,fetch:async(url,options)=>{
  const result=await fetch(url,options);transportCalls.push({path:new URL(url).pathname,status:result.status});return result;
 },storeSession:session=>{transportState.session=session},clearSession:()=>{transportState.session=null}};
 vm.runInNewContext(realTransport+'\nglobalThis.transportRpc=rpc;',sandbox);
 const saved=await sandbox.transportRpc(name,payload);
 equal(saved.id,payload.p_notice_id,'refresh recovers same-ID write');
 const after=await rpc('get_manageable_notice',transportState.session.access_token,{p_notice_id:payload.p_notice_id});
 equal(after.data.version_no,before.data.version_no+1,'authentication retry executes one update only');
 equal(after.data.body_easy,payload.p_body_easy,'post-refresh correction readback');
 equal(transportCalls.filter(call=>call.path==='/auth/v1/token').length,1,'one actual GoTrue refresh');
 equal(transportCalls.filter(call=>call.path==='/rest/v1/rpc/'+name&&call.status===200).length,1,'one accepted RPC mutation');
}
await verifyExpiredNoticeWrite(operations,'save_notice',historyPayload({p_notice_id:historyId,p_title:'History refreshed correction',p_body_easy:'Corrected after expired operations session'}));
const expiredLeadDraft=await leadSave({p_title:'History lead refresh draft'});
await verifyExpiredNoticeWrite(promotion,'save_lead_notice',routinePayload({p_notice_id:expiredLeadDraft.data.id,p_status:'published',p_confirm_routine:true,p_body_easy:'Published after expired lead session'}));
console.log('NOTICE_EXPIRED_SESSION_AUTH_PASS');
// >200 records: private drafts create no employee publication notifications.
for(let offset=0;offset<205;offset+=10){
 const chunk=await Promise.all(Array.from({length:Math.min(10,205-offset)},(_,i)=>rpc('save_notice',operations.token,historyPayload({p_title:'Pagination isolation '+String(offset+i).padStart(3,'0'),p_status:'draft'}))));
 check(chunk.every(result=>result.data?.ok),'isolated pagination fixture saves');
}
const pages=[];
for(const offset of [0,100,200]){
 const page=await rpc('list_manageable_notices_page',operations.token,{p_limit:100,p_offset:offset,p_search:'Pagination isolation'});
 check(page.ok&&page.data.total===205,'server count includes records beyond old 200 cap');
 pages.push(...page.data.items);
 equal(page.data.has_more,offset<200,'has-more boundary');
}
equal(new Set(pages.map(row=>row.id)).size,205,'stable paging finds every unique record');
const oldestSearch=await rpc('list_manageable_notices_page',operations.token,{p_search:'Pagination isolation 000'});
equal(oldestSearch.data?.total,1,'server search finds oldest record beyond first page');
console.log('NOTICE_HISTORY_EDIT_AUTH_PASS');

// The same synthetic accounts also exercise actual browser entry and guarded
// save/publish/readback, including unrelated task API failure. No hosted writes.
const { noticeBrowserFlow } = await import('./helpers/notice-browser-flow.mjs');
await noticeBrowserFlow({ apiUrl, publishableKey: key, operations, lead: promotion, foreignNoticeId: historyId });

console.log('NOTICE_AUTHORING_UX_AUTH_PASS');

console.log(`Issue 300 notice review/media Auth, RLS, and Storage integration passed: ${assertions} assertions`);

import { api, EMAIL_DOMAIN, PREFIX, qaEmail, readManifest, stagingConfig, printTarget, writeManifest } from './shared.mjs';

const users = [
  ['super-admin-1', '검수 최고관리자 1', 'super_admin', 'system_super_admin', 'staging_qa_operations'],
  ['super-admin-2', '검수 최고관리자 2', 'super_admin', 'system_super_admin', 'staging_qa_operations'],
  ['ceo', '검수 대표', 'ceo', 'ceo', 'staging_qa_operations'],
  ['operations', '검수 운영총괄', 'operations_manager', 'operations_manager', 'staging_qa_operations'],
  ['department-lead', '검수 팀장', 'department_lead', 'department_lead', 'staging_qa_field'],
  ['field-lead', '검수 현장책임자', 'field_lead', 'general_field_lead', 'staging_qa_field'],
  ['office', '검수 사무직', 'office_staff', 'staff', 'staging_qa_operations'],
  ['worker-1', '검수 근로자 1', 'general_worker', 'general_worker', 'staging_qa_field'],
  ['worker-2', '검수 근로자 2', 'general_worker', 'general_worker', 'staging_qa_operations']
];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const target = (scope, id) => ({ target_scope: scope, target_department_id: scope === 'department' ? id : null, target_work_group_id: scope === 'work_group' ? id : null, target_profile_id: scope === 'profile' ? id : null });
try {
  const config = stagingConfig({ serviceRole: true, mutation: true }); printTarget(config, 'Phase 1 QA seed');
  if (!process.env.STAGING_QA_PASSWORD || process.env.STAGING_QA_PASSWORD.length < 12) throw new Error('STAGING_QA_PASSWORD (at least 12 characters) is required and is never printed.');
  const prior = readManifest(); if (prior?.project_ref === config.ref && prior?.seed_state === 'complete') { console.log('Existing complete manifest found. Seed is idempotent; run verify-phase1 or cleanup-phase1.'); process.exit(0); }
  const existing = await api(config, '/auth/v1/admin/users?per_page=1000');
  const existingByEmail = new Map((existing.users || []).map(user => [user.email, user]));
  const ids = {};
  for (const [slug, display_name] of users) {
    const email = qaEmail(slug); let user = existingByEmail.get(email);
    if (!user) user = await api(config, '/auth/v1/admin/users', { method: 'POST', body: { email, password: process.env.STAGING_QA_PASSWORD, email_confirm: true, user_metadata: { display_name, staging_qa: true, qa_namespace: 'phase1' } } });
    if (user.user_metadata?.staging_qa !== true) throw new Error(`Refuse to reuse non-QA auth user ${email}.`);
    ids[slug] = user.id;
  }
  let departments = await api(config, '/rest/v1/departments?select=id,code');
  for (const [code, name, sort_order] of [['staging_qa_operations', `${PREFIX} 검수운영부`, 900], ['staging_qa_field', `${PREFIX} 검수현장부`, 901]]) {
    if (!departments.some(row => row.code === code)) await api(config, '/rest/v1/departments', { method: 'POST', body: { code, name, active: true, sort_order }, prefer: 'return=minimal' });
  }
  departments = await api(config, '/rest/v1/departments?select=id,code'); const positions = await api(config, '/rest/v1/positions?select=id,code'); const roles = await api(config, '/rest/v1/roles?select=id,code');
  const byCode = rows => Object.fromEntries(rows.map(row => [row.code, row.id])); const departmentId = byCode(departments), positionId = byCode(positions), roleId = byCode(roles);
  for (const [, , role, position, department] of users) if (!roleId[role] || !positionId[position] || !departmentId[department]) throw new Error('Expected migration reference data is missing. Apply and verify migrations first.');
  for (const [slug, , role, position, department] of users) {
    await api(config, `/rest/v1/profiles?id=eq.${ids[slug]}`, { method: 'PATCH', body: { account_status: 'active', department_id: departmentId[department], position_id: positionId[position], approved_at: new Date().toISOString(), status_reason: `${PREFIX} Phase 1 QA account` }, prefer: 'return=minimal' });
    const existingRoles = await api(config, `/rest/v1/profile_roles?profile_id=eq.${ids[slug]}&role_id=eq.${roleId[role]}&revoked_at=is.null&select=id`);
    if (!existingRoles.length) await api(config, '/rest/v1/profile_roles', { method: 'POST', body: { profile_id: ids[slug], role_id: roleId[role], scope_type: 'company', scope_id: null, granted_by: ids['super-admin-1'] }, prefer: 'return=minimal' });
  }
  const groups = await api(config, '/rest/v1/work_groups?select=id,name'); const groupByName = Object.fromEntries(groups.map(row => [row.name, row.id]));
  for (const [name, department, sort_order] of [[`${PREFIX} 현장 A반`, 'staging_qa_field', 910], [`${PREFIX} 운영 B반`, 'staging_qa_operations', 920]]) if (!groupByName[name]) { const created = await api(config, '/rest/v1/work_groups', { method: 'POST', body: { name, department_id: departmentId[department], active: true, sort_order, created_by: ids['super-admin-1'], updated_by: ids['super-admin-1'] }, prefer: 'return=representation' }); groupByName[name] = created[0].id; }
  const memberships = [[groupByName[`${PREFIX} 현장 A반`], ids['field-lead'], 'lead', null], [groupByName[`${PREFIX} 현장 A반`], ids['worker-1'], 'worker', null], [groupByName[`${PREFIX} 운영 B반`], ids['worker-2'], 'worker', null], [groupByName[`${PREFIX} 현장 A반`], ids['office'], 'assistant', '2020-01-01']];
  for (const [work_group_id, profile_id, member_type, end_date] of memberships) { const present = await api(config, `/rest/v1/work_group_members?work_group_id=eq.${work_group_id}&profile_id=eq.${profile_id}&member_type=eq.${member_type}&select=id`); if (!present.length) await api(config, '/rest/v1/work_group_members', { method: 'POST', body: { work_group_id, profile_id, member_type, start_date: end_date ? '2019-01-01' : today(), end_date, assigned_by: ids['super-admin-1'] }, prefer: 'return=minimal' }); }
  const existingContent = await api(config, `/rest/v1/today_information_items?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`); if (!existingContent.length) {
    const actor = ids['super-admin-1']; const date = today();
    await api(config, '/rest/v1/today_information_items', { method: 'POST', body: { information_date: date, kind: 'work_hours', title: `${PREFIX} 오늘 근무 안내`, body_easy: '오늘의 검수용 근무시간입니다.', location: '검수 교육실', start_time: '09:00', end_time: '12:00', important: false, ...target('company'), status: 'published', change_reason: `${PREFIX} seed`, created_by: actor, updated_by: actor }, prefer: 'return=minimal' });
    await api(config, '/rest/v1/daily_work_assignments', { method: 'POST', body: { work_date: date, title: `${PREFIX} 오늘 업무`, location: '검수 작업장', start_time: '09:00', end_time: '10:00', lead_profile_id: ids['field-lead'], ...target('work_group', groupByName[`${PREFIX} 현장 A반`]), status: 'published', change_reason: `${PREFIX} seed`, created_by: actor, updated_by: actor }, prefer: 'return=minimal' });
    const guide = await api(config, '/rest/v1/work_guides', { method: 'POST', body: { department_id: departmentId.staging_qa_field, title: `${PREFIX} 포장 작업방법`, summary_text: '검수용 세 단계 작업방법입니다.', status: 'published', published_at: new Date().toISOString(), version_no: 1, change_reason: `${PREFIX} seed`, created_by: actor, updated_by: actor, category: 'packing', guide_format: 'procedure', audience_scope: 'department', audience_department_id: departmentId.staging_qa_field }, prefer: 'return=representation' });
    await api(config, '/rest/v1/work_guide_steps', { method: 'POST', body: [1, 2, 3].map(step_order => ({ work_guide_id: guide[0].id, step_order, title: `${PREFIX} 단계 ${step_order}`, easy_text: `검수용 작업방법 ${step_order}단계입니다.`, status: 'published', created_by: actor, updated_by: actor })), prefer: 'return=minimal' });
    const now = new Date(); const later = new Date(now.getTime() + 3 * 86400000); const tomorrow = new Date(now.getTime() + 86400000);
    const scheduleRows = [
      ['전사 일정', 'company', null, 'published'], ['부서 일정', 'department', departmentId.staging_qa_field, 'published'], ['작업반 일정', 'work_group', groupByName[`${PREFIX} 현장 A반`], 'published'], ['개인 일정', 'profile', ids['worker-1'], 'published'], ['취소 일정', 'profile', ids['worker-1'], 'cancelled']
    ].map(([label, scope, id, status]) => ({ schedule_type: 'training', title: `${PREFIX} ${label}`, starts_at: tomorrow.toISOString(), ends_at: later.toISOString(), all_day: false, location: '검수 교육실', manager_label: '검수 담당자', easy_text: '검수용 일정입니다.', ...target(scope, id), status, change_reason: `${PREFIX} seed`, created_by: actor, updated_by: actor }));
    const schedules = await api(config, '/rest/v1/schedule_items', { method: 'POST', body: scheduleRows, prefer: 'return=representation' });
    const noticeRows = [
      ['중요공지', 'important', false, 'company', null, 'published'], ['긴급공지', 'urgent', true, 'company', null, 'published'], ['재확인 공지', 'urgent', true, 'profile', ids['worker-1'], 'published'], ['초안 공지', 'normal', false, 'company', null, 'draft']
    ].map(([label, importance, requires_acknowledgement, scope, id, status]) => ({ notice_kind: 'safety', importance, title: `${PREFIX} ${label}`, body_easy: '검수용 공지입니다.', publish_start_at: new Date(now.getTime() - 3600000).toISOString(), publish_end_at: later.toISOString(), effective_start_date: today(), related_schedule_id: schedules[0].id, related_work_guide_id: guide[0].id, requires_acknowledgement, ...target(scope, id), status, published_at: status === 'published' ? now.toISOString() : null, change_reason: `${PREFIX} seed`, created_by: actor, updated_by: actor }));
    const notices = await api(config, '/rest/v1/notices', { method: 'POST', body: noticeRows, prefer: 'return=representation' });
    await api(config, '/rest/v1/notice_acknowledgements', { method: 'POST', body: { notice_id: notices[1].id, notice_version: 1, profile_id: ids['worker-1'] }, prefer: 'return=minimal' });
    const guidanceRows = [
      ['전사 안내', 'company', null, 'published', null, null], ['부서 안내', 'department', departmentId.staging_qa_field, 'published', null, null], ['작업반 안내', 'work_group', groupByName[`${PREFIX} 현장 A반`], 'published', null, null], ['개인 안내', 'profile', ids['worker-1'], 'published', null, null], ['초안 자료', 'company', null, 'draft', null, null], ['사용 중지 자료', 'company', null, 'inactive', null, null], ['미래 적용 자료', 'company', null, 'published', '2999-01-01', null], ['종료 자료', 'company', null, 'published', null, '2020-01-01']
    ].map(([label, scope, id, status, effective_from, effective_until], index) => ({ category: 'company_life', title: `${PREFIX} ${label}`, summary_easy: '검수용 안내입니다.', body_easy: '검수 범위와 기간을 확인하세요.', related_work_guide_id: guide[0].id, related_schedule_id: schedules[0].id, ...target(scope, id), display_order: index, is_featured: index === 0, status, effective_from, effective_until, change_reason: `${PREFIX} seed`, created_by: actor, updated_by: actor }));
    await api(config, '/rest/v1/staff_guidance_items', { method: 'POST', body: guidanceRows, prefer: 'return=minimal' });
  }
  writeManifest({ schema_version: 1, seed_state: 'complete', project_ref: config.ref, created_at: new Date().toISOString(), qa_prefix: PREFIX, qa_email_domain: EMAIL_DOMAIN, user_ids: ids, work_group_names: Object.keys(groupByName).filter(name => name.startsWith(PREFIX)) });
  console.log(`Seed complete: ${users.length} virtual accounts, 2 QA work groups, and base Today/work-guide content. Password was not printed.`);
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }

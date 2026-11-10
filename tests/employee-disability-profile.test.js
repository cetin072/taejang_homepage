'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261110093000_employee_disability_profile.sql','utf8');
const ui=fs.readFileSync('app/assets/employee-management-views.js','utf8');
test('current sixteen official types agree between input and database',()=>{
 const types=['physical','brain_lesion','visual','hearing','speech','intellectual','autism','mental','kidney','heart','respiratory','liver','facial','ostomy','epilepsy','pancreatic'];
 for(const type of types){assert.ok(sql.includes("'"+type+"'"));assert.ok(ui.includes("['"+type+"'"));}
 assert.match(ui,/췌장장애/);assert.match(sql,/welfare_severity text/);assert.match(sql,/employment_severity text/);
});
test('health data is separate and server gated, not granted by menu alone',()=>{
 assert.match(sql,/create table private\.employee_disability_profiles/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on private\.employee_disability_profiles from public,anon,authenticated/);
 assert.match(sql,/private_actual_role_codes/);assert.match(sql,/private_effective_role_codes/);
 assert.match(sql,/where code in \('operations_manager','promotion_lead'\)/);
 assert.match(sql,/private_menu_denied\('employee.manage'\)/);
 assert.equal((sql.match(/perform public.private_assert_employee_menu\(\)/g)||[]).length,2);
 assert.doesNotMatch(sql,/update public\.(profiles|employees|people)|alter function public\.get_employee_management_context/);
});
test('updates preserve edit guard and concurrent data; audit excludes health values',()=>{
 assert.match(sql,/private_actor_can\('employee.update'\)/);
 assert.match(sql,/for update/);assert.match(sql,/EMPLOYEE_DISABILITY_CONFLICT/);
 assert.match(sql,/p_expected_revision<>coalesce\(current_revision,0\)/);
 assert.match(sql,/on delete restrict/);
 assert.match(sql,/check\(disability_status='yes' or/);
 assert.match(sql,/'직원 장애정보 수정','\{\}'::jsonb/);
});
test('UI stays in basic info, does not infer employment severity, preserves failed input',()=>{
 assert.match(ui,/basic.append\(disability\)/);
 assert.match(ui,/\['이메일', employee.linked_profile/);
 assert.match(ui,/서로 자동 환산하지 않습니다/);
 assert.match(ui,/if \(!snapshot.can_edit\) return/);
 assert.match(ui,/if\(!panel.isConnected\)return/);
 assert.match(ui,/입력은 보존했습니다/);
 const feature=ui.slice(ui.indexOf('function disabilityProfile'),ui.indexOf('function employeeProfile'));
 assert.doesNotMatch(feature,/localStorage|sessionStorage|console\./);
});

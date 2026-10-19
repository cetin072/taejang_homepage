'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = require('node:path').resolve(__dirname, '..');
const read = name => fs.readFileSync(require('node:path').join(root,name),'utf8');
const moduleSource = read('app/assets/employee-field-audit.js');
const controller = read('app/assets/employee-management.js');
const boot = read('app/assets/app-ui.js');
const sql = read('supabase/migrations/20261014161000_employee_field_audit_lead.sql');

test('staff management has one surface: no redundant survey entry or loading',()=>{
  assert.doesNotThrow(()=>new vm.Script(moduleSource));
  assert.doesNotThrow(()=>new vm.Script(controller));
  assert.doesNotThrow(()=>new vm.Script(read('app/assets/employee-management-views.js')));
  assert.doesNotMatch(controller,/📋 직원 현장 전수조사|TaejangEmployeeFieldAudit\?\.open/);
  assert.doesNotMatch(boot,/assets\/employee-field-audit\.js', 'employee-field-audit'/);
  assert.match(controller,/TaejangEmployeeManagement = \{ openEmployeeManagement, uploadEmployeePhoto \}/);
  assert.match(boot,/assets\/employee-management\.js', 'employee-management'/);
  assert.match(read('app/assets/employee-management-views.js'),/앱 설치 및 현장 확인/);
  assert.match(read('app/assets/employee-management-views.js'),/주민등록번호 등록·조회/);
});

test('manual app status is separate from account linkage, push devices, and attendance activity',()=>{
  for(const key of ['unchecked','installed','not_installed','login_error']) assert.match(moduleSource,new RegExp(key));
  assert.match(moduleSource,/설치 여부는 자동 추정하지 않습니다/);
  assert.match(moduleSource,/employee\.account_connected/);
  assert.match(moduleSource,/employee\.has_app_use/);
  assert.match(moduleSource,/employee\.app_install_status === 'installed'/);
  assert.doesNotMatch(moduleSource,/notification_devices|push_token|ExpoPushToken/);
  assert.match(moduleSource,/employee\.identity_verified/);
  assert.match(moduleSource,/employee\.profile_photo_path/);
  assert.match(moduleSource,/field_audit_manage/);
});

test('mobile portrait uses existing private storage and never legal ID photo or private data',()=>{
  assert.match(moduleSource,/setAttribute\('capture','user'\)/);
  assert.match(moduleSource,/image\/jpeg,image\/png,image\/webp/);
  assert.match(moduleSource,/uploadEmployeePhoto\(employee,'profile',chosen\)/);
  assert.match(moduleSource,/set_employee_photo/);
  assert.doesNotMatch(moduleSource,/id_photo|resident_number|salary|signup_phone/);
  assert.match(moduleSource,/get_employee_field_audit/);
  assert.match(moduleSource,/photo_path!==photoPath/);
  assert.match(sql,/private_employee_media_allowed/);
  assert.match(sql,/private_set_employee_photo_pre148/);
});

test('new RPCs limit lead authority to basic workers and keep payroll, employee ID, and profile intact',()=>{
  assert.match(sql,/employee\.field_audit_manage/);
  assert.match(sql,/EMPLOYEE_BASIC_MANAGER_REVIEW_REQUIRED/);
  assert.match(sql,/PROTECTED_EMPLOYEE_CHANGE_FORBIDDEN/);
  assert.match(sql,/employee\.employment_status in \('active','leave'\)/);
  assert.match(sql,/EMPLOYEE_BASIC_STALE_RELOAD_REQUIRED/);
  assert.match(sql,/private_append_audit/);
  assert.doesNotMatch(sql,/update public\.profiles\s+set|update auth\.users\s+set|delete from public\.employees|private_insert_employee/);
});

test('lead resident access is single-employee and Vault-backed without salary escalation',()=>{
  const privacy=read('supabase/migrations/20261016100000_lead_staff_roster_resident_number.sql');
  assert.match(privacy,/employee\.resident_number_manage/);
  assert.match(privacy,/private_can_manage_employee_resident_number/);
  assert.match(privacy,/vault\.decrypted_secrets/);
  assert.match(privacy,/employee_resident_number_viewed/);
  assert.match(privacy,/EMPLOYEE_RESIDENT_NUMBER_FORBIDDEN/);
  assert.match(privacy,/p_purpose not in \('support_program','employee_administration'\)/);
  assert.match(privacy,/private_employee_is_protected/);
  assert.doesNotMatch(privacy,/insert into public\.role_capability_grants[^;]*payroll\./i);
  assert.doesNotMatch(privacy,/grant execute on function public\.bulk_set_employee_resident_registration_numbers/);
  assert.match(controller,/get_employee_resident_registration_number/);
  assert.match(controller,/set_employee_resident_registration_number/);
  assert.match(controller,/window\.setTimeout\(hide,30000\)/);
  assert.doesNotMatch(controller,/localStorage\.setItem\([^)]*resident|sessionStorage\.setItem\([^)]*resident/i);
  assert.match(controller,/update_employee_field_audit_basic/);
  assert.match(read('app/assets/employee-management-views.js'),/현장 확인 저장/);
});

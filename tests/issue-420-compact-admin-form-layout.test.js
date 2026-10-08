'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const approval=read('app/assets/phase-c-account-approval.js');
const employee=read('app/assets/employee-management.js');
const css=read('app/assets/dashboard-shell.css');
const browser=read('tests/browser/compact-admin-form-gate.html');
const runner=read('scripts/run-promotion-browser-gate.mjs');

test('approved signup inputs are compact while retaining immutable approval contracts',()=>{
  assert.match(approval,/phase-c-signup-approval-card app-compact-container/);
  assert.match(approval,/const identityFields = el\('div', null, 'app-compact-fields'\)/);
  assert.match(approval,/identityFields\.append\(/);
  assert.match(approval,/field\('부서', department\)/);
  assert.match(approval,/field\('직책', position\)/);
  assert.match(approval,/field\('업무 권한', role\)/);
  assert.match(approval,/const decisionReasons = el\('div', null, 'phase-c-signup-reasons'\)/);
  assert.match(approval,/field\('승인 처리 사유', reason\)/);
  assert.match(approval,/field\('거절 사유', rejectReason\)/);
  assert.match(approval,/form\.append\(identityFields, attendanceField, decisionReasons\)/);
  assert.match(approval,/selectControl\(options\?\.roles, '업무 권한 선택', 'code'\)/);
  assert.match(approval,/p_role_code: controls\.role\.value/);
  assert.match(approval,/p_department_id: controls\.department\.value/);
  assert.match(approval,/p_position_id: controls\.position\.value/);
  assert.match(approval,/p_attendance_required: controls\.attendance\.checked/);
  assert.match(approval,/직원 생성 후 가입 승인/);
  assert.match(approval,/가입 거절/);
});

test('shared manager compact field grid is responsive but never overrides general worker screens',()=>{
  assert.match(css,/#desktop-app-shell \.app-compact-container\s*\{\s*container-type:\s*inline-size/);
  assert.match(css,/#desktop-app-shell \.app-compact-fields\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css,/@container \(max-width: 640px\)/);
  assert.match(css,/@container \(max-width: 420px\)/);
  assert.match(css,/@media \(max-width: 760px\)/);
  assert.match(css,/\.app-compact-fields :is\(select, input:not\(\[type="checkbox"\]\), textarea\)[\s\S]*?min-height:\s*44px/);
  assert.match(css,/#desktop-app-shell \.dashboard-main :is\(\.form-grid, \.employee-form-grid, \.promotion-form-grid\) > label/);
  assert.doesNotMatch(css,/(?:^|\n)\s*body\s+label\s*\{/);
  assert.match(browser,/COMPACT_ADMIN_FORM_GATE_PASS/);
  assert.match(runner,/compact-admin-form-gate\.html/);
});

test('staff core form reuses compact grid; sensitive and insurance forms keep existing layout',()=>{
  const core=employee.slice(employee.indexOf('function makeEmployeeForm('),employee.indexOf('function normalizeResidentNumber('));
  assert.match(core,/employee-form app-compact-container/);
  assert.match(core,/employee-form-grid app-compact-fields/);
  const rest=employee.slice(employee.indexOf('function normalizeResidentNumber('));
  assert.doesNotMatch(rest,/employee-form-grid app-compact-fields/);
  assert.match(employee,/\.employee-form-grid\s*\{\s*display:grid;\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('signup applicant summary uses a compact 3-item row and responsive decision reasons',()=>{
  assert.match(approval,/phase-c-signup-applicant-item/);
  assert.match(approval,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(approval,/\.phase-c-signup-reasons\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(approval,/@container\(max-width:640px\)/);
  assert.match(approval,/@container\(max-width:420px\)/);
  assert.match(approval,/min-height:44px/);
  assert.doesNotMatch(approval,/create_role|insert into public\.roles/);
});

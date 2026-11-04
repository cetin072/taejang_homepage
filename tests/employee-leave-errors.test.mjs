import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(new URL('../app/assets/employee-leave.js',import.meta.url),'utf8');
const window={};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.testLeaveError=errorText;})();'),{window});

test('self approval code is not mistaken for the shorter FORBIDDEN code',()=>{
  assert.equal(window.testLeaveError(new Error('SELF_APPROVAL_FORBIDDEN')),'본인의 연차는 직접 승인할 수 없습니다.');
  assert.equal(window.testLeaveError(new Error('RPC error: SELF_APPROVAL_FORBIDDEN (42501)')),'본인의 연차는 직접 승인할 수 없습니다.');
});
test('generic permission denial and subordinate-only denial remain distinct',()=>{
  assert.equal(window.testLeaveError(new Error('FORBIDDEN')),'현재 권한으로 처리할 수 없습니다.');
  assert.match(window.testLeaveError(new Error('PROTECTED_EMPLOYEE_REVIEW_REQUIRED')),/하위 직급/);
  assert.match(window.testLeaveError(new Error('UNKNOWN_FORBIDDEN_SUFFIX')),/저장하지 못했습니다/);
});
test('overlapping work schedule error keeps its specific explanation',()=>{
  assert.match(window.testLeaveError(new Error('WORK_TERMS_ATTENDANCE_CONFLICT')),/선택한 적용일에는 이미 출근 기록/);
  assert.match(window.testLeaveError(new Error('ATTENDANCE_CONFLICT')),/기존 근태와 충돌/);
});

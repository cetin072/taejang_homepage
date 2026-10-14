'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const views = require('../app/assets/employee-management-views.js');
const rows = [
  { id:'linked', full_name:'가상 직원', hired_on:'2026-01-02', employee_id:'TJ-001', employment_status:'active', linked_profile:{account_status:'active'}, profile_photo_path:'fixture/profile.png' },
  { id:'unlinked', full_name:'가상 직원', hired_on:'2026-01-02', employee_id:'TJ-002', employment_status:'departed' },
  { id:'namesake', full_name:'가상 직원', hired_on:'2026-02-03', employee_id:'TJ-003', employment_status:'leave', linked_profile:{account_status:'suspended'} },
  { id:'unknown', full_name:'확인 대상', employee_id:'TJ-004', employment_status:'active', linked_profile:{account_status:'pending'} },
  { id:'empty', full_name:'가상 직원', employee_id:'TJ-005', employment_status:'active' }
];
test('connection candidates require both exact name and hire date with linked/unlinked mix', () => {
  assert.deepEqual([...views.connectionReviewIds(rows)], ['linked', 'unlinked']);
  assert.equal(views.connectionReviewIds([rows[0], rows[2]]).size, 0);
  assert.equal(views.connectionReviewIds([rows[1], {...rows[1], id:'another'}]).size, 0);
});
test('linked, unlinked, inactive and unknown profile states remain separate from review warning', () => {
  const ids = views.connectionReviewIds(rows);
  assert.deepEqual(views.accountState(rows[0],ids), { linked:true, review:true, label:'앱 연결됨' });
  assert.equal(views.accountState(rows[1],ids).label, '앱 미연결');
  assert.equal(views.accountState(rows[2],ids).label, '계정 비활성');
  assert.equal(views.accountState(rows[3],ids).review, true);
});
test('search and combined employment, account and photo filters keep null-safe context semantics', () => {
  const ids=views.connectionReviewIds(rows), base={search:'',employment:'',account:'',photo:''};
  const filter = changes => views.filterEmployees(rows,{...base,...changes},ids).map(row=>row.id);
  assert.deepEqual(filter({search:'tj-003'}), ['namesake']);
  assert.deepEqual(filter({search:'확인'}), ['unknown']);
  assert.deepEqual(filter({employment:'active'}), ['linked','namesake','unknown','empty']);
  assert.deepEqual(filter({employment:'departed'}), ['unlinked']);
  assert.deepEqual(filter({account:'linked'}), ['linked','namesake','unknown']);
  assert.deepEqual(filter({account:'unlinked'}), ['unlinked','empty']);
  assert.deepEqual(filter({account:'review'}), ['linked','unlinked','unknown']);
  assert.deepEqual(filter({photo:'yes'}), ['linked']);
  assert.deepEqual(filter({photo:'no',account:'unlinked'}), ['unlinked','empty']);
});
test('new view asset parses, is loaded, and optional recovery tools target the selected UUID only', () => {
  const read = file=>fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');
  assert.doesNotThrow(()=>new vm.Script(read('app/assets/employee-management-views.js')));
  assert.match(read('app/assets/app-ui.js'), /assets\/employee-management-views\.js/);
  const controls=read('app/assets/operations-delete-controls.js');
  assert.match(controls, /querySelectorAll\('\[data-employee-profile\]'\)/);
  assert.match(controls, /card\.dataset\.employeeProfile/);
  assert.doesNotMatch(controls, /\.employee-grid \.employee-card/);
});

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
const positions = [
  {id:'worker',code:'general_worker',name:'일반 근로자'},
  {id:'ops',code:'operations_manager',name:'운영총괄'},
  {id:'lead',code:'department_lead',name:'팀장'},
  {id:'staff',code:'staff',name:'담당자'}
];
const orderedEmployees = [
  {id:'w',employee_id:'TJ-1',position_id:'worker',full_name:'나',department_name:'하',hired_on:'2026-01-01'},
  {id:'l2',employee_id:'TJ-20',position_id:'lead',full_name:'다',department_name:'가',hired_on:'2026-03-01'},
  {id:'o',employee_id:'TJ-3',position_id:'ops',full_name:'라',department_name:'다',hired_on:'2026-02-01'},
  {id:'l1',employee_id:'TJ-2',position_id:'lead',full_name:'가',department_name:'나',hired_on:'2026-04-01'},
  {id:'s',employee_id:'TJ-4',position_id:'staff',full_name:'마',department_name:'라',hired_on:'2026-01-02'},
  {id:'missing',employee_id:'TJ-5'}, {id:'stale',employee_id:'TJ-6',position_id:'old'},
  {id:'mismatch',employee_id:'TJ-7',position_id:'ops',position_name:'다른 데이터'},
  {id:'retired',employee_id:'TJ-0',position_id:'ops',employment_status:'departed'}
];
test('position order reuses DB-ranked options, moves general_worker last and groups unknown and departed employees',()=>{
  const original=structuredClone(orderedEmployees);
  assert.deepEqual(views.sortEmployees(orderedEmployees,positions).map(e=>e.id),['o','l1','l2','s','w','missing','stale','mismatch','retired']);
  assert.deepEqual(orderedEmployees,original,'input context is not mutated');
  const ranks=views.positionRanks(positions);
  assert.equal(views.positionIssue(orderedEmployees[5],ranks),'직책 미지정');
  assert.equal(views.positionIssue(orderedEmployees[7],ranks),'직책 정보 확인 필요');
  const numeric=[{id:'lead',sort_order:40},{id:'ops',sort_order:20}];
  assert.deepEqual(views.sortEmployees(orderedEmployees.slice(1,4),numeric).map(e=>e.id),['o','l1','l2']);
});
test('all six sort modes compose with filters and retain retired employees at the bottom',()=>{
 const rows=orderedEmployees.slice(0,5),ids=sort=>views.sortEmployees(rows,positions,sort).map(e=>e.id);
 assert.deepEqual(ids('employee_asc'),['w','l1','o','s','l2']);
 assert.deepEqual(ids('employee_desc'),['l2','s','o','l1','w']);
 assert.deepEqual(ids('name'),['l1','w','l2','o','s']);
 assert.deepEqual(ids('department'),['l2','l1','o','s','w']);
 assert.deepEqual(ids('hired'),['l1','l2','o','s','w']);
 for(const sort of ['position','employee_asc','employee_desc','name','department','hired'])
   assert.equal(views.sortEmployees(orderedEmployees,positions,sort).at(-1).id,'retired');
 const filtered=views.filterEmployees(rows,{search:'TJ-2',employment:'',account:'',photo:''},new Set());
 assert.deepEqual(views.sortEmployees(filtered,positions,'employee_desc').map(e=>e.id),['l2','l1']);
});
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

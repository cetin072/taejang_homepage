#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20260723000200_general_worker_today_board.sql');
const SQL = fs.readFileSync(MIGRATION, 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app/assets/app.js'), 'utf8');
const board = require(path.join(ROOT, 'app/assets/today-board.js'));

test('Today migration contains the minimum extensible data model with RLS', () => {
  for (const table of ['work_groups', 'work_group_members', 'work_guides', 'daily_work_assignments', 'today_information_items']) {
    assert.match(SQL, new RegExp(`create table public\\.${table} \\(`, 'i'));
    assert.match(SQL, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  for (const scope of ['company', 'department', 'work_group', 'profile']) {
    assert.match(SQL, new RegExp(`'${scope}'`));
  }
});

test('general-worker task data intentionally excludes progress, output, and attendance fields', () => {
  const table = SQL.match(/create table public\.daily_work_assignments \([\s\S]*?\n\);/i)?.[0] || '';
  for (const forbidden of ['progress', 'quantity', 'output', 'clock_in', 'clock_out', 'started_at', 'completed_at', 'performance_score']) {
    assert.doesNotMatch(table, new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
});

test('general-worker RLS checks active state and target scope in the database', () => {
  assert.match(SQL, /create or replace function public\.today_target_matches_current_user/i);
  assert.match(SQL, /public\.current_profile_is_active\(\)/i);
  assert.match(SQL, /current_user_in_work_group/i);
  assert.match(SQL, /daily_work_assignments_read[\s\S]*today_target_matches_current_user/i);
  assert.match(SQL, /today_information_items_read[\s\S]*today_target_matches_current_user/i);
});

test('manager writes use guarded RPCs and direct writes remain unavailable', () => {
  for (const name of ['save_daily_work_assignment', 'save_today_information_item', 'save_work_guide_stub']) {
    const fn = SQL.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'))?.[0] || '';
    assert.match(fn, /security definer/i);
    assert.match(fn, /current_user_can_manage/i);
  }
  assert.match(SQL, /revoke all on table[\s\S]*daily_work_assignments[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(SQL, /grant (insert|update|delete)[\s\S]*daily_work_assignments[\s\S]*to authenticated/i);
});

test('important task mutations append compact audit events', () => {
  assert.match(SQL, /daily_work_created/);
  assert.match(SQL, /daily_work_updated/);
  assert.match(SQL, /today_information_created/);
  assert.match(SQL, /today_information_updated/);
  assert.match(SQL, /previous_work_guide_id/);
  assert.doesNotMatch(SQL, /jsonb_build_object\([\s\S]{0,300}'body_easy'/i);
});

test('Today screen follows the required read-first information order', () => {
  const ids = [
    'today-date',
    'today-worker-name',
    'work-hours-list',
    'task-list',
    'information-list',
    'work-guide-panel'
  ];
  const positions = ids.map(id => HTML.indexOf(`id="${id}"`));
  positions.forEach(position => assert.ok(position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(HTML, /id="refresh-board"/);
});

test('Today detail has no worker progress, completion, quantity, or attendance actions', () => {
  const workerSection = HTML.match(/<section id="general-worker-board"[\s\S]*?<\/section>\s*<section id="today-admin-panel"/)?.[0] || '';
  for (const forbidden of ['업무 시작', '업무 완료', '진행률', '생산수량', '실적 입력', '출근', '퇴근', '문제 보고']) {
    assert.doesNotMatch(workerSection, new RegExp(forbidden));
  }
  assert.match(workerSection, /작업방법/);
});

test('empty, cancelled, guide-missing, loading, and error states use actionable easy messages', () => {
  assert.equal(board.emptyMessage(), '오늘 등록된 업무가 없습니다. 담당 반장에게 확인하세요.');
  assert.equal(board.guideMessage(null), '등록된 작업방법이 없습니다. 담당 반장에게 확인하세요.');
  assert.match(APP, /이 업무는 취소되었습니다\. 담당 반장에게 확인하세요\./);
  assert.match(APP, /오늘 정보를 불러오고 있습니다\./);
  assert.match(APP, /정보를 불러오지 못했습니다\. 잠시 후 새로고침해주세요\./);
});

test('multiple tasks are sorted by start time without automatic performance judgment', () => {
  const sorted = board.sortByTime([
    { title: '나중 업무', start_time: '13:00:00' },
    { title: '시간 미정', start_time: null },
    { title: '먼저 업무', start_time: '09:00:00' }
  ]);
  assert.deepEqual(sorted.map(item => item.title), ['먼저 업무', '나중 업무', '시간 미정']);
  assert.doesNotMatch(APP, /현재 진행|지연 판단|실적 판단|자동 완료/);
});

test('manager interface supports create, edit, cancel, deactivate, target scope, and change reason', () => {
  for (const id of ['task-form', 'information-form', 'guide-form', 'task-scope', 'information-scope', 'task-reason', 'information-reason']) {
    assert.match(HTML, new RegExp(`id="${id}"`));
  }
  assert.match(HTML, /value="cancelled">취소/);
  assert.match(HTML, /value="inactive">사용 중지/);
  assert.match(APP, /save_daily_work_assignment/);
  assert.match(APP, /save_today_information_item/);
  assert.match(APP, /fillTaskForm/);
  assert.match(APP, /fillInformationForm/);
});

test('CI runs migrations, pgTAP, legacy Auth tests, and Today Auth/Data API tests', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/phase1a-supabase-integration.yml'), 'utf8');
  assert.match(workflow, /supabase db reset/);
  assert.match(workflow, /supabase test db supabase\/tests\/database\/\*\.test\.sql/);
  assert.match(workflow, /phase1a-auth-integration\.mjs/);
  assert.match(workflow, /today-board-auth-integration\.mjs/);
  assert.doesNotMatch(workflow, /secrets\.|supabase link|db push/i);
});

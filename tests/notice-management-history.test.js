'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/20261019141647_notice_management_history_read_scope.sql','utf8');
const client=fs.readFileSync('app/assets/notice-admin.js','utf8');
const recovery=fs.readFileSync('app/assets/operations-delete-controls.js','utf8');
test('notice history adds read scope without replacing writers, RLS, approval or data',()=>{
 assert.match(migration,/n\.status='published' and n\.archived_at is null and n\.target_scope='company' and n\.publish_start_at<=now\(\)/);
 assert.match(migration,/n\.created_by=auth\.uid\(\)/);
 assert.match(migration,/'can_edit',n\.archived_at is null and public\.current_user_can_manage_notice/);
 assert.doesNotMatch(migration,/create (?:or replace )?function public\.(?:save_notice|save_lead_notice|current_user_can_manage_notice|submit_notice)/i);
 assert.doesNotMatch(migration,/\b(?:create|alter|drop) (?:table|policy)|\b(?:insert into|update public|delete from)\b/i);
 assert.doesNotMatch(migration,/alter function public\.current_user_can_view_notice/);
 assert.match(migration,/revoke all on function public\.private_can_read_notice_management[\s\S]*from public,anon,authenticated/);
});
test('notice list is paginated and filtered before the server page limit',()=>{
 assert.match(migration,/filtered as materialized/);
 assert.match(migration,/from filtered n order by ordinal limit p_limit offset p_offset/);
 assert.match(migration,/'total',\(select count\(\*\) from filtered\)/);
 assert.match(client,/list_manageable_notices_page/);
 assert.match(client,/서버 목록 기능 업데이트 필요/);
 assert.match(client,/목록 조회 실패 — 이전 결과/);
});
test('save confirmation verifies exact ID, payload, version and media rather than capped list presence',()=>{
 assert.match(client,/get_manageable_notice/);
 assert.match(client,/matchesSaved\(verified, finalPayload\)/);
 assert.match(client,/verified\.version_no < result\.version_no/);
 assert.match(client,/stored\.id === photo\.id/);
 assert.match(client,/pendingWrite = \{ id: result\.id, payload: finalPayload \}/);
 assert.match(client,/action === 'publish' && previousStatus === 'draft'/);
 assert.match(client,/createResponseUncertain && !ui\.element\('notice-id'\)\.value/);
});
test('notice recovery tools take the displayed item ID, never a separately queried index',()=>{
 assert.doesNotMatch(recovery,/key: 'notices', listId: 'notice-admin-list'/);
 assert.match(client,/decorateNoticeCard\(item, card/);
 assert.match(recovery,/decorateNoticeCard\(item, card, refresh\)/);
 assert.match(client,/activeView === 'archive'/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260921002000_issue_300_notice_review_media.sql');
const admin = read('app/assets/notice-admin.js');
const media = read('app/assets/notice-media.js');
const worker = read('app/assets/notice-worker.js');

test('notice review and photo contracts keep publication and direct access guarded', () => {
  assert.match(migration, /create table if not exists public\.notice_media/);
  assert.match(migration, /alter table public\.notice_media enable row level security/);
  assert.match(migration, /revoke all on table public\.notice_media from public, anon, authenticated/);
  assert.match(migration, /create or replace function public\.submit_notice_for_operations_review/);
  assert.match(migration, /p_status <> 'draft'/);
  assert.match(migration, /OPERATIONS_REVIEW_REQUIRED/);
  assert.match(migration, /create policy "notice media upload"/);
  assert.match(migration, /create policy "notice media read"/);
  assert.match(migration, /create policy "notice media delete"/);
  assert.match(migration, /current_user_can_view_notice/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete) on table public\.notice_media to authenticated/i);
});

test('notice photo UI preserves safe authoring, preview, and worker lightbox behavior', () => {
  assert.match(admin, /app\.can\?\.\('notice\.manage'\)/);
  assert.match(admin, /MAX_PHOTOS/);
  assert.match(admin, /OPERATIONS_REVIEW_REQUIRED/);
  assert.match(admin, /운영총괄 상신/);
  assert.match(admin, /운영총괄 검토 대기/);
  assert.match(admin, /ui\.element\('notice-id'\)\.value = result\.id/);
  assert.match(admin, /NOTICE_SAVED_MEDIA_FAILED/);
  assert.match(admin, /value = '공지 작성·수정'/);
  assert.match(admin, /value\.trim\(\) \|\| '공지 작성·수정'/);
  assert.ok(
    admin.indexOf("ui.element('notice-id').value = result.id") < admin.indexOf('await persistMedia(result.id, reason)'),
    'saved notice id is retained before media persistence so retries cannot duplicate a new notice'
  );
  assert.match(media, /MAX_SOURCE_FILE_BYTES = 15 \* 1024 \* 1024/);
  assert.match(media, /MAX_UPLOAD_FILE_BYTES = 2 \* 1024 \* 1024/);
  assert.match(media, /TARGET_UPLOAD_FILE_BYTES = 1400 \* 1024/);
  assert.match(media, /MAX_IMAGE_EDGE = 1600/);
  assert.match(media, /optimizeForUpload/);
  assert.match(media, /image\/jpeg/);
  assert.match(media, /x-upsert': 'false'/);
  assert.doesNotMatch(media, /'Cache-Control': '3600'/);
  assert.match(media, /signedUrl/);
  assert.match(media, /dialog\.showModal\(\)/);
  assert.match(worker, /renderGallery/);
});

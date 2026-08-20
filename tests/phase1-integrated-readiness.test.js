const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('readiness timezone patch uses one KST calendar date for worker-facing defaults', () => {
  const sql = read('supabase/migrations/20260724000200_phase1_readiness_kst_dates.sql');
  assert.match(sql, /create or replace function public\.korea_current_date\(\)/);
  assert.match(sql, /now\(\) at time zone 'Asia\/Seoul'/);
  assert.match(sql, /p_from_date date default public\.korea_current_date\(\)/);
  assert.match(sql, /p_reference_date date default public\.korea_current_date\(\)/);
  assert.match(sql, /effective_from <= public\.korea_current_date\(\)/);
  assert.match(sql, /current_user_in_work_group\(uuid\) set timezone to 'Asia\/Seoul'/);
  assert.match(sql, /current_user_can_manage_work_guide\(uuid\) set timezone to 'Asia\/Seoul'/);
  assert.match(sql, /get_notice_ack_summary\(uuid\) set timezone to 'Asia\/Seoul'/);
});

test('worker screens send an explicit KST board date and retain their five read-only entries', () => {
  const app = read('app/assets/app.js');
  const schedule = read('app/assets/schedule-worker.js');
  const html = read('app/index.html');
  assert.match(app, /timeZone: 'Asia\/Seoul'/);
  assert.match(schedule, /p_from_date: window\.TaejangApp\.getBoardDate\(\)/);
  for (const id of ['task-list', 'open-work-guide-list', 'open-schedule-list', 'open-notice-list', 'open-guidance-list']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('all audited public activity cards use an approved category and the certification post uses its approved photo', () => {
  const content = read('assets/js/content.js');
  const expectedCategories = {
    'environment-cleanup-first': '환경·사회공헌',
    'standard-workplace-certification': '회사 소식'
  };
  for (const id of Object.keys(expectedCategories)) {
    const record = content.slice(content.indexOf(`id: "${id}"`), content.indexOf('\n    },', content.indexOf(`id: "${id}"`)));
    assert.match(record, new RegExp(`category: "${expectedCategories[id]}"`));
    assert.match(record, /listingPhoto: \{/);
    assert.match(record, /photo: \{/);
    if (id === 'environment-cleanup-first') {
      assert.match(record, /thumb: null/);
      assert.match(record, /hero: null/);
    } else {
      assert.match(record, /thumb: "assets\/images\/archive\/standard-workplace-certification\.webp"/);
      assert.match(record, /hero: "assets\/images\/archive\/standard-workplace-certification\.webp"/);
      assert.match(record, /alt: \{/);
    }
  }
});

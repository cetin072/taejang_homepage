const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root=path.join(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase','migrations','20260910085000_support_radar_kpi_v1.sql'),'utf8');
const report=fs.readFileSync(path.join(root,'app','assets','support-radar-report.js'),'utf8');

test('Phase 1 KPI query covers all agreed operating indicators',()=>{
  ['eligible_notice_count','application_count','selected_count','actual_cash_total','actual_in_kind_total','missed_important_count','average_hours_discovery_to_first_review']
    .forEach(key=>assert.match(sql,new RegExp(key)));
});

test('missed-important KPI requires a high-score relevant notice that passed without application',()=>{
  assert.match(sql,/overall_score>=85/);
  assert.match(sql,/hard_gate<>'fail'/);
  assert.match(sql,/recommended_application_mode<>'none'/);
  assert.match(sql,/not exists\(select 1 from public\.support_applications/);
});

test('weekly report renders cumulative KPIs without external delivery',()=>{
  assert.match(report,/support_get_kpis/);
  assert.match(report,/놓친 중요공고/);
  assert.match(report,/발견→첫 검토/);
  assert.doesNotMatch(report,/smtp|sendmail|kakao/i);
});

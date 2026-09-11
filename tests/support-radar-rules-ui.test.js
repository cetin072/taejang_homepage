const fs = require('fs');
const path = require('path');

const rules = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260909232000_support_radar_queries_and_rules.sql'), 'utf8');
const profileUi = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'support-radar.js'), 'utf8');
const noticeUi = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'support-radar-notices.js'), 'utf8');
const assignmentUi = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'support-radar-assignment.js'), 'utf8');
const radarCss = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'support-radar.css'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'app-ui.js'), 'utf8');

function expectContains(source, fragment, label = fragment) {
  if (!source.includes(fragment)) throw new Error(`Missing ${label}`);
}

[
  'create or replace function public.support_get_dashboard',
  'create or replace function public.support_list_notices',
  'create or replace function public.support_get_notice_detail',
  'create or replace function public.support_evaluate_notice_v1',
  "'support_rule_v1'",
  "direct_status := 'ineligible'",
  "joint_status := 'conditional'",
  "partner_status := 'conditional'",
  'eligibility_score',
  'strategic_score',
  'economic_score',
  'execution_score',
  'selection_score',
  'urgency_score',
  'support_notice_evaluated'
].forEach(fragment => expectContains(rules, fragment));

[
  '기업 프로필',
  '새 버전으로 저장',
  'support_get_company_profile',
  'support_save_company_profile'
].forEach(fragment => expectContains(profileUi, fragment));

[
  '전체 공고',
  '공고 직접 등록',
  'Rule Engine v1 평가 실행',
  '운영총괄 결정',
  '신청 진행',
  'support_get_dashboard',
  'support_list_notices',
  'support_get_notice_detail',
  'support_evaluate_notice_v1',
  'support_set_decision',
  'support_update_application_status'
].forEach(fragment => expectContains(noticeUi, fragment));

[
  "if(decision!=='apply') return;",
  "apply: '신청'",
  "hold: '보류'",
  "exclude: '제외'",
  '담당자 배정'
].forEach(fragment => expectContains(assignmentUi, fragment, `decision-before-assignment UX: ${fragment}`));

[
  'label:has(input[type="checkbox"])',
  '.support-radar-row input[type="checkbox"]{width:1.15rem',
  'cursor:pointer'
].forEach(fragment => expectContains(radarCss, fragment, `compact checkbox UX: ${fragment}`));

expectContains(loader, "['assets/support-radar.js', 'support-radar']", 'support-radar loader');
expectContains(loader, "['assets/support-radar-notices.js', 'support-radar-notices']", 'support-radar-notices loader');
expectContains(loader, "['assets/support-radar-assignment.js', 'support-radar-assignment']", 'support-radar-assignment loader');

if (/grant\s+(insert|update|delete|all)\s+on\s+public\.support_/i.test(rules)) {
  throw new Error('Rule/query migration must not expose direct support-table mutations.');
}

if (/drop\s+table|truncate\s+table|delete\s+from\s+public\./i.test(rules)) {
  throw new Error('Rule/query migration must remain forward-only and non-destructive.');
}

console.log('support-radar-rules-ui.test.js: PASS');

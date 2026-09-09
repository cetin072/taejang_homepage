const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'prototypes/payroll-backend/attendance_persistence_candidate.sql');
const candidate = fs.readFileSync(candidatePath, 'utf8');

test('attendance persistence candidate remains rollback-only and outside migrations', () => {
  assert.match(candidate, /Status: CANDIDATE ONLY\. ROLLBACK-ONLY/i);
  assert.match(candidate.trim(), /rollback;$/i);
  assert.equal(
    fs.existsSync(path.join(root, 'supabase/migrations/attendance_persistence_candidate.sql')),
    false
  );
});

test('attendance persistence records immutable source identity and canonical employee linkage', () => {
  assert.match(candidate, /create table if not exists public\.payroll_attendance_import_batches/i);
  assert.match(candidate, /source_file_id text not null/i);
  assert.match(candidate, /source_fingerprint text not null/i);
  assert.match(candidate, /unique \(source_fingerprint\)/i);
  assert.match(candidate, /create table if not exists public\.payroll_attendance_rows/i);
  assert.match(candidate, /source_key text not null unique/i);
  assert.match(candidate, /employee_uuid uuid references public\.employees\(id\)/i);
  assert.match(candidate, /work_date date not null/i);
});

test('clock values are evidence only and never become paid hours through clock-span arithmetic', () => {
  assert.match(candidate, /clock_in_raw text/i);
  assert.match(candidate, /clock_out_raw text/i);
  assert.match(candidate, /Never derive paid hours from clock span automatically/i);
  assert.doesNotMatch(candidate, /clock_out_raw\s*-\s*clock_in_raw/i);
  assert.doesNotMatch(candidate, /extract\s*\([\s\S]*clock_(?:in|out)_raw/i);
  assert.doesNotMatch(candidate, /generated always as[\s\S]*clock_(?:in|out)_raw/i);
});

test('ambiguous, unmatched and lifecycle-conflict records cannot masquerade as matched employees', () => {
  assert.match(candidate, /match_status in \('matched','unmatched','ambiguous','lifecycle_conflict'\)/i);
  assert.match(candidate, /check \(match_status='matched' or employee_uuid is null\)/i);
  assert.match(candidate, /check \(match_status<>'matched' or employee_uuid is not null\)/i);
  assert.match(candidate, /record_status in \([\s\S]*'review_required'/i);
});

test('confirmed correction requires explicit confirmed review state and confirmed hours', () => {
  assert.match(candidate, /auto_decision<>'confirmed_correction'[\s\S]*review_status='confirmed'[\s\S]*confirmed_hours is not null/i);
  assert.match(candidate, /create table if not exists public\.payroll_attendance_corrections/i);
  assert.match(candidate, /correction_key text not null unique/i);
  assert.match(candidate, /reason text not null/i);
  assert.match(candidate, /evidence_ref text/i);
});

test('attendance tables remain fail-closed and contain no Sensitive HR identity columns', () => {
  assert.match(candidate, /alter table public\.payroll_attendance_import_batches enable row level security/i);
  assert.match(candidate, /alter table public\.payroll_attendance_rows enable row level security/i);
  assert.match(candidate, /alter table public\.payroll_attendance_corrections enable row level security/i);
  assert.match(candidate, /revoke all on[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(candidate, /resident[_-]?registration/i);
  assert.doesNotMatch(candidate, /disability_(?:type|grade|number|card)/i);
  assert.doesNotMatch(candidate, /bank_(?:account|number)/i);
  assert.doesNotMatch(candidate, /health_/i);
});

test('import acceptance is explicit and unresolved records are documented as blockers', () => {
  assert.match(candidate, /status in \('imported','normalized','review_required','accepted','voided'\)/i);
  assert.match(candidate, /status='accepted'[\s\S]*accepted_at is not null[\s\S]*accepted_by is not null/i);
  assert.match(candidate, /Any unmatched\/ambiguous\/partial\/manual-review row remains a calculation blocker/i);
});

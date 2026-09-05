const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'docs/operations/PAYROLL_ATTENDANCE_IMPORT_APPS_SCRIPT.gs'),
  'utf8'
);

function pad(value) {
  return String(value).padStart(2, '0');
}

const sandbox = {
  console,
  Date,
  Utilities: {
    formatDate(date, _timeZone, pattern) {
      const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      if (pattern === 'yyyy-MM-dd') return datePart;
      if (pattern === 'yyyy-MM-dd HH:mm:ss') {
        return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      }
      throw new Error(`Unsupported test date pattern: ${pattern}`);
    },
  },
  Session: {
    getActiveUser() {
      return { getEmail: () => 'qa@example.invalid' };
    },
  },
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'PAYROLL_ATTENDANCE_IMPORT_APPS_SCRIPT.gs' });

const {
  payrollParseAttendanceDateHeader_,
  payrollExtractAttendanceRows_,
  payrollDeriveOriginalStatus_,
  payrollNormalizeDisplayValue_,
} = sandbox;

function makeHeaders() {
  const header1 = Array(12).fill('');
  const header2 = Array(12).fill('');
  header1[0] = '사번';
  header1[1] = '생년월일';
  header1[2] = '성명';
  header1[3] = '성별';
  header1[4] = '장애유형';
  header1[5] = '구분';
  header1[6] = '8월 3일';
  header1[8] = '8원 10일'; // 실제 원본에서 발견된 역사적 오탈자 형태
  header1[10] = '월차 사용일수'; // 근태 날짜 영역 종료 신호
  header2[6] = '출근';
  header2[7] = '퇴근';
  header2[8] = '출근';
  header2[9] = '퇴근';
  return [header1, header2];
}

function makeContext() {
  return {
    year: 2026,
    month: 8,
    sourceFileId: 'anonymous-fixture-file',
    sourceFileName: '태장 출퇴근부 익명검증.xlsx',
    sourceModifiedTime: '2026-08-31T00:00:00Z',
    sourceSheetName: '8월',
  };
}

test('date parser accepts supported historical typo but rejects wrong month and invalid dates', () => {
  assert.equal(payrollParseAttendanceDateHeader_('8월 3일', 2026, 8), '2026-08-03');
  assert.equal(payrollParseAttendanceDateHeader_('8원 10일', 2026, 8), '2026-08-10');
  assert.equal(payrollParseAttendanceDateHeader_('월차 사용일수', 2026, 8), '');
  assert.throws(
    () => payrollParseAttendanceDateHeader_('9월 1일', 2026, 8),
    /원본 날짜의 월이 대상월과 다릅니다/
  );
  assert.throws(
    () => payrollParseAttendanceDateHeader_('8월 32일', 2026, 8),
    /잘못된 원본 날짜입니다/
  );
});

test('display normalization preserves human-readable source text while trimming surrounding whitespace', () => {
  assert.equal(payrollNormalizeDisplayValue_(' 10:27 (수기) \r\n'), '10:27 (수기)');
  assert.equal(payrollNormalizeDisplayValue_(null), '');
});

test('original status classification preserves leave, absence, holiday and termination markers', () => {
  assert.match(payrollDeriveOriginalStatus_('월차(유급)', ''), /월차/);
  assert.match(payrollDeriveOriginalStatus_('', '결근(개인사정) (무급)'), /결근/);
  assert.match(payrollDeriveOriginalStatus_('대체공휴일', ''), /공휴일/);
  assert.match(payrollDeriveOriginalStatus_('중도퇴사', ''), /중도퇴사/);
  assert.equal(payrollDeriveOriginalStatus_('08:38', '12:00'), '');
});

test('anonymous source rows expand into date-level raw rows and keep manual markers without deriving paid hours', () => {
  const [header1, header2] = makeHeaders();
  const worker = Array(12).fill('');
  worker[0] = 'A-001';
  worker[1] = '000101';
  worker[2] = '익명근로자A';
  worker[3] = '여';
  worker[4] = '지적(중)';
  worker[5] = '오전';
  worker[6] = '08:38';
  worker[7] = '12:00';
  worker[8] = '10:27 (수기)';
  worker[9] = '12:00';

  const rows = payrollExtractAttendanceRows_([header1, header2, worker], makeContext());
  assert.equal(rows.length, 2);

  assert.equal(rows[0][4], '익명근로자A');
  assert.equal(rows[0][6], '08:38');
  assert.equal(rows[0][7], '12:00');
  assert.equal(rows[0][8], '');
  assert.equal(rows[0][9], 'N');
  assert.ok(rows[0][5] instanceof Date);
  assert.equal(rows[0][5].getFullYear(), 2026);
  assert.equal(rows[0][5].getMonth(), 7);
  assert.equal(rows[0][5].getDate(), 3);

  assert.equal(rows[1][6], '10:27 (수기)');
  assert.equal(rows[1][7], '12:00');
  assert.equal(rows[1][9], 'Y');
  assert.match(rows[1][12], /원본헤더=8원 10일/);

  // Raw import must not invent a payable-hours field from the clock span.
  assert.equal(rows[0].length, 14);
  assert.equal(rows[1].length, 14);
});

test('attendance raw extraction excludes birthdate and disability descriptors from A-F', () => {
  const [header1, header2] = makeHeaders();
  const worker = Array(12).fill('');
  worker[0] = 'A-002';
  worker[1] = 'SECRET-BIRTH-000101';
  worker[2] = '익명근로자B';
  worker[3] = '남';
  worker[4] = 'SECRET-DISABILITY';
  worker[5] = '오후';
  worker[6] = '월차(유급)';
  worker[8] = '결근(개인사정) (무급)';

  const rows = payrollExtractAttendanceRows_([header1, header2, worker], makeContext());
  assert.equal(rows.length, 2);
  const serialized = JSON.stringify(rows);

  assert.doesNotMatch(serialized, /SECRET-BIRTH/);
  assert.doesNotMatch(serialized, /SECRET-DISABILITY/);
  assert.match(rows[0][8], /월차/);
  assert.match(rows[1][8], /결근/);
});

test('malformed 출근/퇴근 column pairing fails closed instead of silently importing', () => {
  const [header1, header2] = makeHeaders();
  header2[7] = '비고';
  const worker = Array(12).fill('');
  worker[2] = '익명근로자C';
  worker[6] = '09:00';
  worker[7] = '12:00';

  assert.throws(
    () => payrollExtractAttendanceRows_([header1, header2, worker], makeContext()),
    /출퇴근 열 구조가 예상과 다릅니다/
  );
});

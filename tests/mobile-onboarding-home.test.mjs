import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('native signup asks only for the five applicant-owned fields', async () => {
  const home = await text('mobile/app/index.tsx');
  const provider = await text('mobile/src/providers/platform-provider.tsx');

  for (const label of ['이름', '이메일', '전화번호', '비밀번호', '입사일']) {
    assert.match(home, new RegExp(`label="${label}"`));
  }
  assert.match(home, /DateTimePicker/);
  assert.match(home, /입사일 달력 열기/);
  assert.match(home, /secureTextEntry=\{!visible\}/);
  assert.match(home, /비밀번호 찾기/);

  assert.match(provider, /signup_channel:\s*'native_employee'/);
  assert.match(provider, /display_name:\s*normalizedName/);
  assert.match(provider, /phone:\s*normalizedPhone/);
  assert.match(provider, /hired_on:\s*normalizedHiredOn/);

  const signupSection = home.slice(home.indexOf('신입직원 가입 요청'), home.indexOf('if (accessLoading'));
  assert.doesNotMatch(signupSection, /부서 선택|직책 선택|업무 권한 선택|근태 기록 대상|work_group/i);
});

test('pending native account gets only a simple approval-waiting state', async () => {
  const home = await text('mobile/app/index.tsx');
  assert.match(home, /access\?\.account_status === 'pending'/);
  assert.match(home, /가입 승인 대기/);
  assert.match(home, /승인 상태 확인/);
});

test('active mobile home has attendance, Today Work, notice, and one work-platform primary action', async () => {
  const home = await text('mobile/app/index.tsx');
  assert.equal((home.match(/<AttendanceCard/g) || []).length, 1);
  assert.equal((home.match(/<TodayWorkAction/g) || []).length, 1);
  assert.equal((home.match(/<NoticeHomeAction/g) || []).length, 1);
  assert.match(home, /justifyContent:\s*'space-between'/);
  assert.match(home, /actionHeight/);
  assert.match(home, /업무 플랫폼 열기/);
  assert.equal((home.match(/<PrimaryButton/g) || []).length, 1);
  assert.doesNotMatch(home, /로그인 상태|중요공지 알림 준비|직원앱 준비 완료/);
});

test('web onboarding UI creates the employee during approval instead of selecting a pre-created employee', async () => {
  const approval = await text('app/assets/phase-c-account-approval.js');
  assert.match(approval, /employee\.onboard/);
  assert.match(approval, /approve_employee_signup_request/);
  assert.match(approval, /list_employee_signup_requests/);
  assert.match(approval, /get_employee_signup_approval_options/);
  assert.match(approval, /직원 생성 후 가입 승인/);
  assert.doesNotMatch(approval, /get_signup_employee_options|연결할 직원 선택/);
});

test('holiday work UI is explicit per employee and does not treat arbitrary work notes as authorization', async () => {
  const admin = await text('app/assets/attendance-admin.js');
  assert.match(admin, /set_attendance_holiday_work_assignment/);
  assert.match(admin, /get_attendance_holiday_work_assignments/);
  assert.match(admin, /휴일근무 지정/);
});

# Phase 1A 인증·계정·권한 보안 기반 구현

상태: **개발 검증용 — 실제 Supabase 적용 전 로컬 통합 테스트 필요**

## 1. 적용 기준

이 구현은 다음 확정 문서를 우선한다.

- `PROJECT_CHARTER.md`
- `planning/MVP_FUNCTIONAL_SPECIFICATION_V1.md`
- `planning/ROLE_PERMISSION_MATRIX_V1.md`
- `planning/ROLE_SCREEN_MAP_AND_NAVIGATION_V1.md`
- `planning/ACCOUNT_ROLE_ASSIGNMENT_POLICY_V1.md`
- `planning/PHASE1A_DATA_MODEL_V1.md`
- `planning/PHASE1A_ACCESS_RLS_V1.md`
- `planning/PHASE1A_IMPLEMENTATION_PLAN_V1.md`
- `planning/STAFF_PWA_ENTRY_AND_INSTALLATION_V1.md`

기존 `prototypes/admin-phase1a/schema.sql`은 PR #14의 공개 콘텐츠 관리자 보안 초안이다. 해당 파일에는 `pending`과 최신 조직·직책·역할 모델이 없으므로 이번 업무플랫폼 migration과 같은 데이터베이스에 함께 적용하지 않는다.

## 2. 이번 구현 범위

- Supabase Auth 사용자 생성 후 `pending` 프로필 자동 생성
- `profiles`, `departments`, `positions`, `roles`, `profile_roles`
- `account_status_history`, `audit_logs`
- 직책과 다중 역할 분리
- 활성 상태와 역할을 매 요청 DB에서 확인하는 공통 함수
- 최고관리자 전용 가입 승인·보류·거절 기록·상태 변경·조직 배정·역할 변경 RPC
- 최초 최고관리자 1회 bootstrap
- 마지막 활성 최고관리자 보호
- 최소 로그인·회원가입·승인 대기·접근 불가·로그인 성공·가입 승인 화면
- pgTAP 통합 테스트와 Node 정적 보안 테스트

이번 단계에는 일반 근로자 정보게시판, 현장 기록, 상담, 홍보 승인, PWA 설치, 파일 업로드와 Storage 정책을 포함하지 않는다.

## 3. 파일 구조

| 경로 | 역할 |
| --- | --- |
| `supabase/migrations/20260723000100_phase1a_security_foundation.sql` | 실제 적용 후보 migration과 RLS·RPC |
| `supabase/tests/database/phase1a_security_foundation.test.sql` | Auth 프로필·RLS·상태·최고관리자·감사로그 pgTAP 테스트 |
| `tests/phase1a-security-foundation.test.js` | migration 구조·비밀값·최소 화면 정적 검사 |
| `staff/index.html` | 최소 인증·승인 흐름 확인 화면 |
| `staff/assets/staff.js` | Supabase Auth/Data API 호출과 상태별 화면 분기 |
| `staff/assets/staff.css` | 모바일 우선 최소 화면 스타일 |
| `netlify/functions/staff-config.mjs` | 브라우저에 공개 가능한 URL·publishable key만 전달 |
| `.env.example` | 필요한 공개 환경변수 이름 |

기존 공개 홈페이지 HTML/CSS/JavaScript는 수정하지 않는다. `/staff/`가 실패해도 기존 정적 홈페이지 파일은 그대로 제공된다.

## 4. 계정상태별 접근

| 상태 | 본인 최소 상태 확인 | 내부 기준정보·업무자료 | 변경 RPC |
| --- | --- | --- | --- |
| 비로그인 | 불가 | 불가 | 불가 |
| `pending` | 가능 | 불가 | 불가 |
| `active` | 가능 | 역할·범위 안에서 가능 | 역할에 따라 가능 |
| `suspended` | 접근 불가 안내에 필요한 상태만 가능 | 불가 | 불가 |
| `departed` | 접근 불가 안내에 필요한 상태만 가능 | 불가 | 불가 |
| `deleted` | 접근 불가 안내에 필요한 상태만 가능 | 불가 | 불가 |

`profiles`에는 이름, 업무 이메일, 상태, 부서, 직책과 승인 정보만 둔다. 건강·장애 세부정보와 상담 원문은 저장하지 않는다.

## 5. 회원가입·승인 흐름

1. 직원이 `/staff/`에서 이름·업무용 이메일·비밀번호로 회원가입한다.
2. Supabase Auth의 `auth.users` 행 생성 후 DB trigger가 `profiles.account_status = pending`을 만든다.
3. 가입 감사로그와 최초 상태 이력이 생성된다.
4. `pending` 사용자는 본인 최소 상태 외 내부 테이블을 조회하지 못한다.
5. 최고관리자가 실제 신원·소속을 확인한다.
6. 최고관리자가 부서·직책·역할을 선택해 승인 RPC를 실행한다.
7. RPC가 프로필을 `active`로 바꾸고 배정·상태이력·감사로그를 한 트랜잭션에 기록한다.
8. 사용자는 다시 로그인하거나 화면을 새로 열어 역할에 맞는 진입 상태를 확인한다.

이메일 확인을 켠 Supabase 프로젝트에서는 가입 직후 세션이 반환되지 않을 수 있다. 이 경우 이메일 확인 후 로그인해도 계정은 계속 `pending`이며 최고관리자 승인 전 내부자료는 보이지 않는다.

## 6. 초기 시스템 최고관리자 bootstrap

김형철의 이메일이나 UUID를 코드·migration·문서에 넣지 않는다. 다음 절차는 실제 계정이 만들어진 뒤 Supabase SQL Editor를 사용할 수 있는 DB 운영자만 1회 수행한다.

1. 김형철이 일반 회원가입을 완료한다.
2. Supabase Dashboard의 **Authentication → Users**에서 본인 계정인지 확인한다.
3. 해당 계정의 UUID를 복사한다. 이메일이나 UUID를 GitHub에 기록하지 않는다.
4. **SQL Editor**에서 아래 문장의 자리표시자만 실제 UUID로 바꾸어 실행한다.

```sql
select public.bootstrap_super_admin('AUTH_USER_UUID_HERE'::uuid);
```

5. 결과가 `SUPER_ADMIN_BOOTSTRAPPED`인지 확인한다.
6. `/staff/`에 로그인해 `시스템 최고관리자` 역할과 가입 승인 목록이 표시되는지 확인한다.
7. `audit_logs`에 `super_admin_bootstrapped`가 기록됐는지 SQL Editor 또는 승인된 관리자 조회 경로로 확인한다.

이 함수는 다음 조건을 모두 적용한다.

- 일반 브라우저 `anon`, `authenticated` 역할은 실행할 수 없음
- 대상은 이미 존재하는 `pending` Auth 프로필이어야 함
- 활성 최고관리자가 한 명이라도 있으면 재실행 거부
- 특정 이메일·이름으로 권한을 판단하지 않음
- 결과를 감사로그와 상태 이력에 기록

## 7. 마지막 최고관리자 보호

정상 UI/RPC 경로는 advisory transaction lock으로 최고관리자 변경을 직렬화한다. 다음 요청으로 활성 최고관리자가 0명이 되면 데이터를 바꾸지 않고 `LAST_ACTIVE_SUPER_ADMIN_PROTECTED`를 반환하고 거부 감사로그를 남긴다.

- 마지막 최고관리자의 `suspended`, `departed`, `deleted` 전환
- 마지막 최고관리자 역할 회수
- 본인이 마지막 최고관리자일 때 자기 권한 제거

RPC 밖의 직접 SQL 변경에도 trigger가 같은 상태·역할 변경을 막는다. 직접 변경 trigger의 예외는 해당 SQL 트랜잭션을 되돌리므로, 일반 운영에서는 거부 결과와 감사기록을 보존하는 RPC만 사용한다.

## 8. 세션·토큰과 즉시 차단의 한계

Supabase Auth 세션은 access token JWT와 refresh token으로 구성된다. 로그아웃이나 세션 종료로 refresh token을 폐기할 수 있지만, 이미 발급된 access token은 만료 시각 전까지 암호학적으로 유효할 수 있다.

따라서 이 구현은 토큰 안의 오래된 역할·상태를 권한 근거로 사용하지 않는다. 모든 내부 테이블 RLS와 변경 RPC가 매 요청 현재 `profiles.account_status = active`를 다시 조회한다. 정지·퇴사·삭제가 DB에 커밋된 직후에는 기존 access token으로도 다음이 거부된다.

- DB 조회
- DB 생성
- DB 수정
- DB 삭제
- 보안 변경 RPC

이번 PR은 Storage 업로드를 구현하지 않으므로 업로드 차단은 적용 대상이 없다. Storage를 도입할 때 같은 `current_profile_is_active()` 조건을 Storage RLS에 반드시 추가한다.

특정 사용자의 모든 Auth refresh session을 최고관리자가 자동 종료하는 trusted server 경로는 이번 최소 PR에 넣지 않았다. 현재 계정상태 RPC는 응답에 `auth_session_revocation_required = true`를 포함해 후속 서버 처리를 빠뜨리지 않게 한다. 실제 Supabase 프로젝트 적용 전에는 공식 Auth API와 선택 요금제에서의 세션 종료 방식을 통합 테스트하고, DB 상태 차단과 독립된 추가 방어로 연결해야 한다.

## 9. 감사로그 범위

현재 기록:

- 회원가입
- 가입 승인
- 가입 승인 보류·거절
- 계정상태 변경과 재활성화
- 조직·직책 배정 변경
- 역할 부여·회수
- 최초 최고관리자 지정
- 마지막 최고관리자 변경 거부

일반 브라우저 역할은 `audit_logs`와 `account_status_history`를 insert/update/delete할 테이블 권한이 없다. 감사 내부 함수도 직접 호출할 수 없다.

감사 metadata는 4 KiB 이하 JSON object만 허용하며 password, token, secret, key, refresh, 건강·장애·상담을 의미하는 키를 거부한다. 감사로그에 비밀번호, access token, refresh token, service role 키, 건강·장애 세부정보나 상담 원문을 넣지 않는다.

## 10. 환경변수

Netlify의 **Site configuration → Environment variables**에 다음 두 값만 설정한다.

| 이름 | 내용 | 브라우저 공개 여부 |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase 프로젝트 URL | 공개 가능 |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | 공개 가능, RLS 필수 |

`SUPABASE_SERVICE_ROLE_KEY`는 이번 구현에 필요하지 않다. 앞으로 서버 함수가 필요해져도 `staff/`, `admin/`, `assets/`, GitHub 문서나 브라우저 응답에 넣지 않는다.

## 11. 로컬 Supabase 통합 테스트

필요한 프로그램:

- Docker Desktop 또는 Docker Engine
- Node.js
- Supabase CLI

처음 한 번:

```bash
npx supabase@latest init
npx supabase@latest start
```

migration 재적용과 DB 테스트:

```bash
npx supabase@latest db reset
npx supabase@latest test db supabase/tests/database/phase1a_security_foundation.test.sql
```

정적 보안 테스트와 기존 회귀 테스트:

```bash
node --test tests/phase1a-security-foundation.test.js
node --test tests/admin-phase1a-publish.test.js
node scripts/audit-site.test.js
node scripts/validate-content.test.js
```

운영 Supabase에 바로 migration을 붙이지 않는다. 먼저 로컬 또는 별도 비운영 프로젝트에서 DB reset, pgTAP, 실제 회원가입, 승인, 정지·퇴사 후 기존 세션 요청, Security Advisor를 확인한다.

## 12. 실제 적용 전 점검

- [ ] Supabase CLI·Docker 환경에서 migration 성공
- [ ] pgTAP 44개 검증 통과
- [ ] 이메일 확인 on/off 각각 회원가입 확인
- [ ] `pending` 기존 세션으로 내부 select/insert/update/delete 거부
- [ ] `suspended`, `departed`, `deleted` 기존 access token 요청 거부
- [ ] 최고관리자 1명·2명 상태에서 역할 회수·정지 동시 요청 검증
- [ ] Auth refresh session 종료 trusted server 방식 확정
- [ ] Storage 도입 시 상태 기반 RLS 별도 검증
- [ ] Supabase Security Advisor에서 RLS 누락 0건 확인
- [ ] 실제 개인정보 대신 가상 테스트 계정만 사용
- [ ] 공개 홈페이지 회귀 검사 기준선 오류를 별도 PR에서 정리

## 13. 알려진 위험과 후속 작업

- 현재 환경에는 Supabase CLI, Docker, PostgreSQL이 없어 migration·RLS·Auth 통합 테스트를 실행하지 못했다.
- 최소 화면은 보안 흐름 검증용이며 완성형 PWA가 아니다.
- 브라우저 세션은 이 단계에서 `sessionStorage`를 사용한다. 장기 로그인, PKCE, 보안 쿠키와 PWA 세션 정책은 후속 앱 구조에서 다시 결정한다.
- 계정 상태 변경 뒤 DB 차단은 즉시 적용되지만 Auth refresh session 자동 폐기는 아직 연결되지 않았다.
- 파일 업로드·Storage가 범위 밖이므로 업로드 차단 정책은 후속 migration이 필요하다.
- 기존 공개 홈페이지 기준선에는 콘텐츠 검증과 사이트 감사 오류가 남아 있다. 이번 PR이 만든 회귀는 아니며 공개 콘텐츠 파일을 범위 밖에서 수정하지 않는다.

## 14. 공식 기술 참고자료

- [Supabase User sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase Signing out](https://supabase.com/docs/guides/auth/signout)
- [Supabase User Management](https://supabase.com/docs/guides/auth/managing-user-data)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Testing Overview](https://supabase.com/docs/guides/local-development/testing/overview)

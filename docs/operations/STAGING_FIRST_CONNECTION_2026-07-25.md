# Supabase staging 첫 연결 작업 기록

- 작업일: 2026-07-25
- 저장소: `cetin072/taejang_homepage`
- 작업 브랜치: `codex/phase1-staging-first-connection`
- 대상 프로젝트: `taejang-phase1-staging`
- Supabase project ref: `jgsxpdflgkqroecfjzxq`
- 대상 환경: staging 전용, production 아님

## 1. 완료한 작업

### 로컬·브랜치 준비

- GitHub Desktop에서 원격 최신 상태 확인
- 로컬 작업 브랜치 `codex/phase1-staging-first-connection` 생성 및 사용
- Node.js 설치 및 Supabase CLI 실행 확인
- Access Token과 Database password를 PowerShell 세션 환경변수로만 입력
- 비밀값은 채팅, 저장소, 커밋에 기록하지 않음

### Supabase 연결·마이그레이션

- staging 프로젝트 연결 완료
- migration dry-run으로 적용 예정 6개 확인
- 사용자 승인 후 staging DB에 migration 6개 실제 적용
- `supabase migration list`로 Local / Remote 이력 일치 확인

적용된 migration:

1. `20260723000100_phase1a_security_foundation.sql`
2. `20260723000200_general_worker_today_board.sql`
3. `20260723000300_accessible_work_guides.sql`
4. `20260723000400_staff_schedules_and_notices.sql`
5. `20260724000100_frequent_staff_guidance.sql`
6. `20260724000200_phase1_readiness_kst_dates.sql`

### 데이터베이스·보안 점검

- public 스키마 테이블 17개 생성 확인
- public 테이블 17개 모두 RLS 활성화 확인
- RLS 정책이 0개인 public 테이블 없음 확인
- `daily_work_assignments` 정책 확인
  - 대상 역할: `authenticated`
  - 허용 작업: `SELECT`
  - 익명 역할용 정책 없음
- 민감 테이블을 Data API에 노출하지 않음

### Data API 노출 범위

초기 읽기 테스트를 위해 다음 3개 테이블만 Data API에 노출:

- `public.daily_work_assignments`
- `public.today_information_items`
- `public.work_guides`

다음 민감·관리 테이블은 노출하지 않음:

- `profiles`
- `audit_logs`
- `account_status_history`
- `profile_roles`
- `roles`

### 로컬 staging 환경 설정

로컬 전용 `.env.staging` 생성 및 확인:

- `STAGING_SUPABASE_URL`
- `STAGING_SUPABASE_PUBLISHABLE_KEY`
- `STAGING_SUPABASE_PROJECT_REF`
- `STAGING_ALLOWED_PROJECT_REFS`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`는 비워둠
- `.env.staging`은 Git 추적 제외 상태 확인

### 안전검사

아래 스크립트로 staging 환경 검사 통과:

```powershell
node .\scripts\staging\check-environment.mjs
```

확인 내용:

- staging URL과 project ref 일치
- staging allow-list 통과
- production/live 문자열 차단 검사 통과
- migration 6개 및 SHA-256 해시 확인
- 해당 검사는 Supabase 호출이나 migration 적용을 수행하지 않음

## 2. 현재 최종 상태

- staging DB migration 적용 완료
- Local / Remote migration 이력 일치
- RLS 및 정책 기본 점검 완료
- Data API 최소 노출 완료
- 로컬 staging 환경파일 준비 완료
- GitHub Desktop 로컬 변경 0
- production 연결 또는 production migration 미실행

## 3. 아직 하지 않은 작업

- Service Role Key 입력
- QA 가상 사용자 생성
- QA 샘플 데이터 생성
- `verify-phase1.mjs` 실행
- 실제 내부 업무 플랫폼 화면의 Supabase 읽기 연결 코드 작성
- 로그인 사용자 기반 실제 RLS 통합 테스트
- production 프로젝트 연결 또는 migration 적용

## 4. 다음 작업 기준

다음 개발은 staging에서만 진행한다.

1. 브라우저 코드에는 Publishable key만 사용한다.
2. Secret key와 Service Role Key를 브라우저 코드나 공개 저장소에 넣지 않는다.
3. 로그인·세션 처리 후 `daily_work_assignments`, `today_information_items`, `work_guides` 읽기 연결부터 시작한다.
4. 실제 사용자·프로필·역할을 만든 뒤 RLS가 사용자별로 올바르게 작동하는지 검증한다.
5. production 연결과 적용은 별도 승인 전까지 금지한다.

## 5. 보안 메모

- Access Token과 Database password는 저장소에 기록하지 않는다.
- `.env.staging` 실제값은 로컬에서만 관리한다.
- 화면 공유나 캡처에는 키 전체가 보이지 않도록 주의한다.
- Supabase CLI가 생성하는 `supabase/.temp/` 파일은 커밋하지 않는다.

# 태장 업무플랫폼 현재 운영 상태

마지막 확인일: **2026-09-01 (KST)**

이 문서는 다음 Work가 현재 상태를 빠르게 복구하기 위한 운영 기록이다. 플랫폼 관련 작업을 완료·중단·배포 확인·실제 계정 상태 변경한 경우, 비밀정보 없이 이 문서를 함께 갱신한다.

## 기준 코드와 PR

- 기준 `main` SHA: `d8dea79f5cfe17a0f1e6ca2eca7d9dae95e13e25`
- PR #31: 사용자 승인 후 squash merge 완료
- Issue #86: 완료/종료
- 현재 작업 Issue: #90 `platform: complete MVP v1 limited pilot readiness`
- 현재 작업 브랜치: `codex/issue-90-mvp-pilot-readiness`
- 상위 장기 목표: Issue #89
- 공개 홈페이지와 내부 업무플랫폼의 시스템 경계는 계속 유지한다.

## staging·Netlify 상태

- Supabase 업무플랫폼 대상은 `taejang-phase1-staging`이다. Production Supabase는 변경하지 않는다.
- PR #31에서 staging workflow 정합화와 staff 진입 회귀수정을 완료했다.
- 김형철 bootstrap과 실제 로그인 검증은 성공 확정: `active`, `super_admin`, `operations_manager`이며 보호된 staff 최고관리자 화면과 가입 승인 대기 화면이 정상이다. `apply_bootstrap`, `bootstrap_super_admin`, `profiles`·`profile_roles` 직접 수정은 재실행 금지다.
- 적용 확인된 기존 migration: Phase 1 기본 6개(2026-07-25 기록 기준).
- PR #31 Deploy Preview 검증 완료: `/staff/` 로그인 화면 정상, 비로그인 `/app/`은 `/staff/`로 보호 리디렉션.
- 사용자 승인에 따라 PR #31 main 병합 및 그에 따른 Netlify Production 자동배포를 허용했다.
- Netlify Production 현재 배포: `ready`, branch `main`, commit `d8dea79f5cfe17a0f1e6ca2eca7d9dae95e13e25`, deploy id `6a95a4889f13b60008941fc4`.
- Netlify secret scan: 검출된 secret 없음.
- 시험계정·샘플 데이터: 최초 minimal seed가 조직 테이블 권한 확인 전에 정확히 2개의 TEST Auth·`pending` profile을 부분 생성했다. 이후 두 Auth 계정은 soft-delete로 로그인 차단했으며, profile FK 때문에 영구 삭제는 하지 않았다. TEST 조직·작업반·5종 샘플 콘텐츠는 생성되지 않았다.
- staging QA 시드: Issue #90의 2026-09-01 KST 승인으로 기본 2개 TEST 계정·5종 샘플만 실행 가능하다. `--full` 9계정 QA는 계속 금지다. 대상 allow-list 검사는 통과했지만, 현재 staging `service_role`에는 `departments`를 포함한 직접 Data API 접근 권한이 없어 minimal seed 및 hosted E2E를 진행할 수 없다.

## 실제 사용자 계정 상태

- 김형철 시스템 최고관리자: 기존 검증 기록상 `active`; 역할은 `super_admin`, `operations_manager`; 부서는 `operations`, 직책은 `operations_manager`다. 이 상태를 보존한다.
- 이영희 대표이사: 계정 미생성.
- 실제 사용자에게 TEST·QA 표기를 붙이거나 자동 생성하지 않는다.
- 초기 시범운영에는 장애 상세, 건강, 상담, 보호자 연락처, 주민등록번호, 급여·계약 원문, 민감 인사·징계·사고 기록을 입력하지 않는다.

## 완료된 작업

- Phase 1 계정 상태·역할·RLS·감사로그 기반 구현 및 staging 첫 연결
- 최초 최고관리자 bootstrap 및 실제 관리자 로그인 검증
- 일반 근로자 핵심 5화면과 관리자 최소 작성/게시 기반
- Issue #86 / PR #31 최신 main 정합화, 충돌 해결, Auth 오류처리 회귀검증
- PR #31 GitHub Actions 및 Deploy Preview 통과
- PR #31 사용자 승인 후 main squash merge
- 병합 commit의 Netlify Production 자동배포 `ready` 확인

## 현재 작업 — Issue #90

목표는 새 기능 확장이 아니라 **MVP v1 제한 시범운영 직전 상태**까지 검증·안정화하는 것이다.

1. 대표이사 계정 생성/승인 흐름의 정책·화면 검증
2. 신규 직원 `pending → 부서/직책/역할 → active` 관리자 흐름 검증
3. 관리자 5종 정보 작성·수정·게시·사용중지 → 일반 근로자 모바일 조회 E2E
4. 회사/부서/작업반/개인 범위 RLS 검증
5. 초안·사용중지·기간 밖·타인 자료 차단 검증
6. `suspended`, `departed`, 마지막 `super_admin` 보호 검증
7. 모바일 360px, 200% 확대, 키보드 이동, 가로스크롤, 쉬운 빈 상태·오류 문구 검수
8. blocker 수정 → 테스트 → Deploy Preview → 독립검수 반복

## Issue #90 비변경 QA 기록 — 2026-09-01 (KST)

- 이번 QA에서는 실제 사용자 계정·권한·상태, staging 데이터·migration, Production Supabase를 변경하지 않았다.
- 로그인 초기 연결 확인 중 모든 패널이 숨겨져 빈 화면이 보일 수 있던 blocker를 수정했다. 이제 설정 확인 전에는 `로그인을 준비하고 있습니다` 안내를 즉시 표시하고, 연결 확인 후 기존 로그인·가입 흐름으로 전환한다.
- 로컬 정적·보안 회귀 검사 54건이 통과했다. 기존 전체 정적 회귀 검사 87건과 staging 안전장치 검사 4건도 통과했다.
- GitHub Actions의 격리 환경에서 migration 재적용, schema lint, pgTAP, 실제 Auth·Data API·RLS 통합 검사가 통과했다. 이 검사는 hosted staging이 아닌 CI의 로컬 Supabase로 실행됐다.
- Draft PR #92 Deploy Preview에서 비로그인 `/app/`의 `/staff/` 보호 이동, 360px 로그인·가입 화면의 가로 스크롤 없음, 즉시 로딩 안내, 48px 로그인 입력·주요 버튼과 콘솔 오류 없음을 확인했다.

### 기획 대비 상태

- `구현 완료`: 비로그인·비활성 계정 차단, 마지막 활성 `super_admin` 보호, 관리자 5종 정보 관리 기반, 대상 범위·게시 상태·기간 RLS, 일반 근로자 읽기 전용 화면의 자동화 검증.
- `부분 구현`: 실제 staging의 관리자 → 일반 근로자 5종 정보 E2E와 실제 계정 상태 전환 검증. 코드와 격리 CI는 통과했지만 실제 계정 또는 전용 TEST 계정 없이 hosted staging을 변경하지 않았다.
- `미구현·후속 작업`: staging Data API 권한 gate가 해소되면 승인된 기본 TEST 계정 범위에서 hosted staging E2E를 실행한다. 제한된 실제 직원 범위의 계정·권한·상태 변경은 별도 사용자 승인이 있어야 한다.

## Issue #90 staging TEST 실행 상태 — 2026-09-01 (KST)

- Issue #90에서 기본 minimal TEST seed와 TEST 전용 E2E·RLS·계정상태 검증을 명시 승인했다.
- `taejang-phase1-staging`의 HTTPS URL·project ref·allow-list·production 차단 검사는 통과했다.
- 실행 프로세스의 staging 설정과 Service Role 키는 정상 감지됐다. 그러나 첫 seed는 `departments` Data API 읽기에서 HTTP 403으로 중단됐다. 원인 확인 뒤 seed 도구를 수정해 모든 직접 Data API 읽기 권한을 Auth 사용자 생성 전에 검사하도록 보완했고, 재실행에서 같은 403이 사용자 생성 전에 안전하게 발생함을 확인했다.
- 최초 부분 생성된 정확히 2개의 TEST Auth 계정은 영구 삭제 시 profile FK가 거부해, 공식 Auth soft-delete로 로그인 차단했다. soft-delete 응답은 성공했으며 실제 사용자·조직·콘텐츠는 변경하지 않았다.
- 2026-09-01 사용자 승인으로 staging DB owner TEST-only seed 경로를 실행했다. `scripts/staging/seed-phase1-db-owner.mjs`가 TEST Auth 2개, TEST 부서·작업반, 오늘 업무·작업방법·일정·중요공지·반복 안내를 생성했고 DB owner 읽기 전용 verify가 통과했다. migration·권한 변경·`--full`은 실행하지 않았다.
- TEST 관리자·근로자 로그인 context, 관리자 5종 정보의 작성·게시 흐름과 근로자 5종 조회, 근로자의 관리자 작성 기능 차단, TEST 근로자 `suspended`·`departed` 즉시 차단 및 최종 `active` 복구가 hosted staging에서 통과했다.

## Issue #90 hosted 대상 범위·기간 RLS 독립 검증 — 2026-09-01 (KST)

- 기획방의 승인된 TEST-only 독립 검증에서 `get_my_today_board`를 실제 TEST 근로자 세션으로 확인했다. 회사 전체, 본인 부서, 본인 작업반, 본인 개인 대상 행은 조회됐고 다른 TEST 부서·작업반·개인 대상 행은 차단됐다.
- 초안과 사용중지 행은 조회되지 않았다. 중요공지·일정·반복 안내는 각각 현재 표시기간 또는 현재·향후 일정만 조회되고 미래 시작·만료된 행은 차단됐다.
- 검증에만 사용한 `[STAGING-QA]` 임시 TEST 행, 보조 부서·작업반과 RLS audit 행은 즉시 정리했다. 잔여 audit 행·부서·작업반은 0건이며 기본 TEST 근로자는 최종 `active` 상태를 유지한다.
- 이 독립 검증은 Production, migration, `--full` QA, 실제 사용자 계정·역할·상태를 변경하지 않았다. 같은 hosted mutation을 반복 실행하지 않는다.

### 기획 대비 최종 상태

- `구현 완료`: 비로그인·비활성 계정 차단, 마지막 활성 `super_admin` 보호, 관리자 5종 정보 관리·게시 기반, TEST 관리자→근로자 5종 hosted E2E, 회사·부서·작업반·개인 대상 범위와 타인 대상 차단, 게시 상태·기간 RLS, 일반 근로자 읽기 전용 화면의 자동화·hosted 검증.
- `부분 구현`: 실제 직원 제한 시범운영의 계정 생성·권한·상태 변경과 실제 사용자 환경의 수동 접근성 검수. 이는 별도 사용자 승인 이후에만 진행한다.
- `미구현·후속 작업`: 실제 사용자 제한 시범운영 승인, Ready for review 판단, main 병합과 Production 배포는 다음 사용자 결정 gate다.

## 사용자가 직접 해야 하는 최소 작업

- DB owner seed, 기본 hosted TEST E2E 및 대상 범위·기간 RLS 독립 검증은 완료됐다. 실제 사용자 계정 생성/권한 변경, migration, `--full`, Production, Ready 전환·main 병합은 계속 별도 승인이 필요하다.
- 비밀번호·Service Role Key·DB 비밀번호는 채팅이나 GitHub에 입력하지 않는다.

## 하면 안 되는 작업

- Production Supabase 변경
- `apply_bootstrap` 또는 `bootstrap_super_admin` 재실행
- `profiles` 또는 `profile_roles` 직접 수정
- Service Role Key·비밀번호·개인정보를 채팅·GitHub·문서에 기록
- 사용자 승인 없는 실제 계정 승격·정지·퇴사 처리
- 사용자 승인 없는 QA seed·migration apply
- 사용자 승인 없는 Ready for review / main 병합 / 추가 Production 배포
- main 직접 수정

## 다음 Work 필수 확인 문서

1. `AGENTS.md`
2. `PROJECT_CHARTER.md`
3. Issue #89
4. Issue #90
5. `docs/planning/MVP_FUNCTIONAL_SPECIFICATION_V1.md`
6. `docs/planning/MVP_V1_FAST_TRACK_FINAL_SCOPE_V1.md`가 main에 존재하면 우선순위 기준으로 함께 확인
7. `docs/planning/GENERAL_WORKER_INFORMATION_BOARD_V1.md`
8. `docs/planning/ACCOUNT_ROLE_ASSIGNMENT_POLICY_V1.md`
9. `docs/planning/PHASE1A_ACCESS_RLS_V1.md`
10. `docs/operations/FIRST_SUPER_ADMIN_BOOTSTRAP.md`
11. 이 문서

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
- 시험계정·샘플 데이터: 미생성.
- staging QA 시드: 기본 2계정·5개 샘플과 전체 9계정 모두 별도 승인 전까지 미실행.

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

## 사용자가 직접 해야 하는 최소 작업

- 현재 Issue #90 시작 준비에는 없음.
- 실제 사용자 계정 생성/권한 변경, TEST 계정 생성, staging 데이터 mutation, migration apply가 필요해지는 순간에만 별도 승인을 요청한다.
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

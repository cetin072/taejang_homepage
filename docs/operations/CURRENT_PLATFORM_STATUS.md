# 태장 업무플랫폼 현재 운영 상태

마지막 확인일: **2026-09-01 (KST)**

이 문서는 다음 Work가 현재 상태를 빠르게 복구하기 위한 운영 기록이다. 플랫폼 관련 작업을 완료·중단·배포 확인·실제 계정 상태 변경한 경우, 비밀정보 없이 이 문서를 함께 갱신한다.

## 기준 코드와 PR

- 기준 `main` SHA: `28cb1eff8b90190a748536355295dc195e8eee81`
- 작업 브랜치: `codex/mvp-v1-staging-qa`
- 관련 Draft PR: [#31](https://github.com/cetin072/taejang_homepage/pull/31) — open, Draft, main 미병합
- Issue #86 정합화 병합 커밋: `5f2f5f91624513cbdac70233920038eb5f9209f3`
- 공개 홈페이지: 최신 main 변경을 병합했으며 플랫폼 변경 범위 밖의 기능을 추가하지 않음

## staging·Netlify 상태

- Supabase 대상은 `taejang-phase1-staging`뿐이다. production 연결·변경·migration 적용은 이번 작업에서 수행하지 않았다.
- 최초 `dry_run` 1회 실패: `supabase db push`에 더 이상 지원되지 않는 `--project-ref`를 전달해 CLI가 중단됨. staging DB migration·계정·QA 시드는 변경되지 않음.
- PR #31 workflow는 `supabase link --project-ref` 후 `supabase db push`를 사용하고, 조건 확인·bootstrap 검증에는 공식 Supabase Management API SQL endpoint를 사용한다. 직접 DB IPv6 접속과 pooler 주소 하드코딩은 사용하지 않는다.
- 김형철 bootstrap과 실제 로그인 재검증은 성공 확정: `active`, `super_admin`, `operations_manager`이며 보호된 staff 최고관리자 화면과 가입 승인 대기 화면이 정상이다. 계정·역할·부서·직책·감사기록은 이번 작업에서 재조회·수정하지 않았다. `apply_bootstrap`, `bootstrap_super_admin`, `profiles`·`profile_roles` 직접 수정은 재실행 금지다.
- 그 재검증 중 과거 `?notice=app-error`가 성공한 관리자 화면에도 남는 stale 안내를 확인했다. PR #31에서 처리한 notice를 URL에서 소비하고, 검증된 최고관리자 화면에는 과거 `app-error`·`setup`을 다시 표시하지 않도록 수정했다. 과거 `/app/`의 원본 예외는 넓은 catch가 버려 정확한 모듈까지 소급 식별할 수 없지만, 관리자 보조 모듈 동적 로딩은 실패해도 핵심 대시보드·세션을 유지하고 제한된 안내만 표시하도록 분리했다.
- 적용 확인된 기존 migration: Phase 1 기본 6개(2026-07-25 기록 기준)
- Netlify Deploy Preview #31: 이전 HEAD에서 `/staff/` 정상 연결 기록이 있다. 이번 push 뒤 새 Preview에서 `/staff/`, `/app/` 기본 경로를 다시 확인한다. Production 배포는 금지다.
- 시험계정·샘플 데이터: 미생성
- staging QA 시드: 기본 2계정·5개 샘플은 별도 승인 전까지 미실행. 전체 9계정은 `--full`과 명시 확인값 없이는 금지.

## 실제 사용자 계정 상태

- 김형철 시스템 최고관리자: 기존 검증 기록상 `active`; 역할은 `super_admin`, `operations_manager`; 부서는 `operations`, 직책은 `operations_manager`다. 이 기록을 현재 기준으로 사용하며 재실행·변경하지 않는다.
- 이영희 대표이사: 계정 미생성.
- 실제 사용자에게 TEST·QA 표기를 붙이거나 자동 생성하지 않는다.
- 초기 시범운영에는 장애 상세, 건강, 상담, 보호자 연락처, 주민등록번호, 급여·계약 원문, 민감 인사·징계·사고 기록을 입력하지 않는다.

## 완료된 작업

- Phase 1 계정 상태·역할·RLS·감사로그 기반 구현 및 staging 첫 연결 기록
- PR #31: 최소 staging QA 시드 정리(실제 실행 없음)
- 최초 최고관리자 bootstrap의 성공 기록을 현재 기준으로 정리하고 재실행 금지 상태를 명확화
- Issue #86: 최신 main 반영·PR #31 충돌 해결 및 최고관리자 protected staff 진입, stale notice 소비, 보조 모듈 오류 격리, Auth 오류 구분 회귀검증 완료

## 다음 작업

1. PR #31의 새 Deploy Preview에서 `/staff/`와 `/app/` 기본 경로를 비파괴 방식으로 확인한다.
2. 독립 검수와 사용자 승인 뒤에만 PR 상태 변경 또는 main 병합을 검토한다.
3. 실제 계정 생성·승인, migration 적용, QA 시드, Production 변경은 별도 승인·별도 작업으로 분리한다.

## 사용자가 직접 해야 하는 최소 작업

- 이번 동기화·문서 정리·로컬 검사에는 없음.
- 이후 실제 계정·migration·QA 시드·Production 작업을 원할 때만 해당 단계의 별도 승인과 회사의 안전한 자격증명 준비가 필요하다.

## 하면 안 되는 작업

- production Supabase, Netlify Production, `main` 직접 수정·병합
- `apply_bootstrap` 또는 `bootstrap_super_admin` 재실행, `profiles` 또는 `profile_roles` 직접 수정
- Service Role Key·비밀번호·개인정보를 채팅·GitHub·Netlify·문서에 기록
- 사용자 승인 전 실제 계정 승격, migration 적용, QA 시드 실행

## 다음 Work 필수 확인 문서

1. `AGENTS.md`
2. `PROJECT_CHARTER.md`
3. `docs/planning/PLANNING_RECORD_SYSTEM.md`
4. `docs/planning/ACCOUNT_ROLE_ASSIGNMENT_POLICY_V1.md`
5. `docs/planning/PHASE1A_ACCESS_RLS_V1.md`
6. `docs/operations/FIRST_SUPER_ADMIN_BOOTSTRAP.md`
7. 이 문서

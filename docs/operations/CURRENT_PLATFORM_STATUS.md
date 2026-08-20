# 태장 업무플랫폼 현재 운영 상태

마지막 확인일: **2026-08-20 (KST)**

이 문서는 다음 Work가 현재 상태를 빠르게 복구하기 위한 운영 기록이다. 플랫폼 관련 작업을 완료·중단·배포 확인·실제 계정 상태 변경한 경우, 비밀정보 없이 이 문서를 함께 갱신한다.

## 기준 코드와 PR

- 기준 `main` SHA: `19a08dd2c4eb09943c9040ad7b13af202586e11c`
- 작업 브랜치: `codex/mvp-v1-staging-qa`
- 관련 Draft PR: [#31](https://github.com/cetin072/taejang_homepage/pull/31) — open, main 미병합
- 공개 홈페이지: 변경 금지 범위 유지

## staging·Netlify 상태

- Supabase: `taejang-phase1-staging` 전용. production 연결·migration 적용 금지.
- 최초 `dry_run` 1회 실패: `supabase db push`에 더 이상 지원되지 않는 `--project-ref`를 전달해 CLI가 중단됨. staging DB migration·계정·QA 시드는 변경되지 않음.
- 수정 진행: PR #31 workflow는 `supabase link --project-ref` 후 `supabase db push`를 사용하고, 조건 확인·bootstrap 검증은 공식 Supabase Management API SQL endpoint로 전환한다. 직접 DB IPv6 접속과 pooler 주소 하드코딩은 사용하지 않는다.
- 적용 확인된 기존 migration: Phase 1 기본 6개(2026-07-25 기록 기준)
- Netlify Deploy Preview #31: `/staff/` 정상 연결 확인됨
- 시험계정·샘플 데이터: 미생성
- staging QA 시드: 기본 2계정·5개 샘플은 별도 승인 전까지 미실행. 전체 9계정은 `--full`과 명시 확인값 없이는 금지.

## 실제 사용자 계정 상태

- 김형철 총괄전무이사: 실제 가입 완료, `pending` 상태로 보고됨. 이메일 확인·대상 UUID·실제 DB 상태는 실행 직전 staging Dashboard에서 재확인 필요.
- 이영희 대표이사: 계정 미생성.
- 실제 사용자에게 TEST·QA 표기를 붙이거나 자동 생성하지 않는다.
- 초기 시범운영에는 장애 상세, 건강, 상담, 보호자 연락처, 주민등록번호, 급여·계약 원문, 민감 인사·징계·사고 기록을 입력하지 않는다.

## 완료된 작업

- Phase 1 계정 상태·역할·RLS·감사로그 기반 구현 및 staging 첫 연결 기록
- PR #31: 최소 staging QA 시드 정리(실제 실행 없음)
- 최초 최고관리자 bootstrap 공식 절차의 누락 항목 조사 완료

## 다음 작업

1. PR #31 수정본으로 staging `dry_run`을 다시 검증한다.
2. 사용자 최종 승인 뒤 staging에만 migration을 적용한다.
3. 이메일 확인 완료·`pending`·활성 최고관리자 0명을 재확인한 뒤 김형철 계정을 공식 RPC로 한 번만 활성화한다.
4. 즉시 역할·조직·상태 이력·감사로그·`/staff/` 접근을 검증하고 이 문서를 갱신한다.

## 사용자가 직접 해야 하는 최소 작업

- Supabase/Netlify 로그인 유지와 실제 실행 최종 승인
- 회사의 안전한 보관 위치에서만 staging CLI 인증용 비밀값을 1회 입력(필요 시)
- 김형철 본인의 이메일 확인 완료

## 하면 안 되는 작업

- production Supabase, Netlify Production, `main` 직접 수정·병합
- `profiles` 또는 `profile_roles` 직접 수정
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

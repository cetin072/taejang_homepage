# Phase 1 비운영 시범환경 도구

이 폴더의 명령은 **운영 Supabase에 적용하면 안 됩니다.** 새 비운영 프로젝트에서만 사용하며, 실제 실행 전 별도 사용자 승인이 필요합니다.

## 안전장치

- `STAGING_SUPABASE_PROJECT_REF`가 URL 호스트와 일치해야 한다.
- ref가 `STAGING_ALLOWED_PROJECT_REFS`에 명시되어야 하며, 로컬 `STAGING_BLOCKED_PROJECT_REFS`에 있으면 중단한다.
- URL이 `prod`, `production`, `live`로 보이면 중단한다.
- 쓰기 명령은 `STAGING_CONFIRM=STAGING`과 `--apply` 또는 `--delete`를 모두 요구한다.
- key, 비밀번호, 토큰은 출력·manifest·저장소에 기록하지 않는다.

## 명령

`node scripts/staging/check-environment.mjs`는 migration 이름·해시와 대상 설정만 검사한다.

`node scripts/staging/apply-migrations.mjs`는 Supabase CLI의 dry-run을 수행한다. 실제 반영은 사용자 승인 후 `STAGING_CONFIRM=STAGING node scripts/staging/apply-migrations.mjs --apply`로만 가능하다. CLI가 없으면 설치 방법만 확인하고 자동 설치하지 않는다. migration은 자동 rollback되지 않는다.

`STAGING_CONFIRM=STAGING node scripts/staging/seed-phase1.mjs`는 service role을 사용하는 **로컬 관리자 명령**이다. 가상 Auth 사용자 9명(최고관리자 2명 포함), 기존 역할·부서·작업반, Today·작업방법·일정·공지·안내 검수자료를 만든다. `STAGING_QA_PASSWORD`는 실행 때만 입력한다.

`node scripts/staging/verify-phase1.mjs`는 가상 사용자·최고관리자 2명·검수 콘텐츠 존재를 확인한다.

`node scripts/staging/cleanup-phase1.mjs`는 삭제 예정 개수만 보여준다. 실제 콘텐츠·작업반 정리는 `STAGING_CONFIRM=STAGING node scripts/staging/cleanup-phase1.mjs --delete`다. 감사·상태이력의 append-only 보존과 `on delete restrict`를 우회하지 않으므로 Auth 사용자·프로필이 남으면 보고하고, 필요한 경우 비운영 프로젝트 자체를 폐기한다.

생성 manifest는 `scripts/staging/.qa-manifest.json`이며 Git 제외 대상이다. UUID·가상 이메일·대상 ref만 기록하며 비밀값은 기록하지 않는다.

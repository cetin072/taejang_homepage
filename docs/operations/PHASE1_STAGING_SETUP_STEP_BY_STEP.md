# Phase 1 비운영 Supabase 시범환경 만들기 — 단계별 안내

이 문서는 운영 적용 승인이 아닙니다. 운영 Supabase·운영 Netlify Production·실제 직원 정보에는 사용하지 않습니다.

## 1단계: 비운영 Supabase 프로젝트 만들기

Supabase Dashboard에서 새 프로젝트를 만들고 이름을 `taejang-phase1-staging`처럼 운영과 분명히 구분합니다. 운영과 다른 Project ref인지 확인하고, 데이터베이스 비밀번호는 회사의 안전한 비밀번호 보관 위치에만 저장합니다. 이 작업은 자동 생성·결제를 하지 않습니다.

## 2단계: 프로젝트 정보 확인

Dashboard의 Project URL, publishable key(브라우저 공개값), project ref를 확인합니다. service role key는 가상 Auth 사용자를 자동 생성하는 **내 컴퓨터의 관리자 명령**에만 필요하며, Netlify·브라우저·GitHub·문서에 넣지 않습니다.

## 3단계: 로컬 환경변수 준비

`.env.staging.example`을 참고해 Git에 올리지 않는 `.env.staging`을 만듭니다. `STAGING_ALLOWED_PROJECT_REFS`에는 방금 만든 ref 하나만 넣고, `STAGING_BLOCKED_PROJECT_REFS`에는 운영 ref를 로컬에서만 넣습니다. `git status --ignored`로 `.env.staging`이 추적되지 않는지 확인합니다. 비밀번호는 `read -s` 등 화면에 보이지 않는 입력 방법으로 준비하고 shell history에 `export 실제비밀값`을 남기지 않습니다.

## 4단계: migration 검사

`node scripts/staging/check-environment.mjs`를 실행합니다. 출력의 ref·URL·현재 branch/HEAD·migration 6개 이름을 확인합니다. 하나라도 운영처럼 보이거나 환경변수가 빠지면 즉시 중단합니다.

## 5단계: migration 적용

Supabase CLI가 이미 설치된 경우 먼저 `node scripts/staging/apply-migrations.mjs`로 dry-run을 합니다. 오류가 없고 담당자의 별도 승인을 받은 경우에만 `STAGING_CONFIRM=STAGING node scripts/staging/apply-migrations.mjs --apply`를 실행합니다. 실패하면 추가 migration을 억지로 적용하지 말고 멈춥니다. 자동 rollback은 제공하지 않습니다.

## 6단계: 검수 계정·데이터 생성

수동 방식은 Dashboard에서 `qa-...@staging.invalid` 가상 계정을 만들고, 최고관리자 화면에서 역할·부서·작업반을 연결하는 방식입니다. 자동 방식은 `STAGING_QA_PASSWORD`를 실행 때만 제공한 뒤 `STAGING_CONFIRM=STAGING node scripts/staging/seed-phase1.mjs`를 실행합니다. 비밀번호는 문서나 캡처에 적지 않습니다. 자동 방식은 최고관리자 2명, 대표·운영총괄·팀장·현장책임자·사무직·근로자 2명과 2개 작업반을 만듭니다.

## 7단계: Netlify Deploy Preview 연결

Netlify 사이트 설정에서 **Deploy Preview context만** 선택합니다. `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ENV=staging`, `APP_ENV_LABEL=비운영 검수환경`에 비운영 값을 입력합니다. Production context에는 입력·변경하지 않습니다. PR을 다시 배포한 뒤 `/app/` 화면의 `비운영 검수환경` 배지와 URL을 확인합니다. 공개 홈페이지에는 이 배지가 나타나지 않아야 합니다.

## 8단계: 실제 기기 검수

[수동 QA 체크리스트](PHASE1_MANUAL_QA_CHECKLIST.md)를 열고 Android Chrome, Samsung Internet, iPhone Safari, Windows Chrome/Edge에서 역할별로 로그인합니다. 일반 근로자 5개 메뉴와 최고관리자 보호를 먼저 확인합니다.

## 9단계: 결과 기록

[QA 결과 기록지](PHASE1_STAGING_QA_RESULT_TEMPLATE.md)에 commit SHA, Preview URL, 기기·브라우저·역할·재현 순서·캡처 위치를 남깁니다. key·토큰·비밀번호는 기록하지 않습니다.

## 10단계: 검수 데이터 정리

먼저 `node scripts/staging/cleanup-phase1.mjs`로 삭제 예정 개수를 확인합니다. 승인된 경우에만 `STAGING_CONFIRM=STAGING node scripts/staging/cleanup-phase1.mjs --delete`를 실행하고 남은 Auth·감사 데이터가 있는지 보고받습니다. 실제 값은 세션과 쉘 환경에서 제거합니다.

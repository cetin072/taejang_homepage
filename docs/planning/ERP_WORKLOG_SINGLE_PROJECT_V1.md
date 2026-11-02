# ERP × 업무수첩 — 단일 프로젝트 전환 준비

2026-11-02 사용자 승인 방향: 태장 Supabase 하나, Google 기본 로그인, 직원 출근앱/임원 및 지정 직원 업무수첩 유지. 현재는 운영 전 검증 체크포인트.

## 실제 구현

- 기존 첫 dashboard와 달력/오늘/미완료 UI 유지. 업무수첩 비밀번호 폼·보조 세션·브라우저 별도 token 저장·기존 프로젝트 publishable key 제거.
- `/api/personal-worklog`: ERP Auth `/user`와 기존 active Profile context를 검증. 서버에서 확인한 같은 Auth ID로 개인 공간 owner/membership과 본인 작성 항목만 GET. 직책/이메일 추정 매핑 없음.
- 데이터 조회에만 `Accept-Profile: worklog`. ERP Auth/기존 RPC는 기존 public 경로 유지. 별도 프로젝트 JWT/서비스키/개인ID 입력을 받지 않음.
- `WORKLOG_UNIFIED_READ_ENABLED=true`가 설정되기 전은 WORKLOG_MIGRATION_PENDING으로 차단. 환경변수 변경·DB expose/운영 migration은 수행하지 않음. schema 미적용/오류 시 public/이전프로젝트로 우회하지 않음.
- 실패 시 개인 영역만 오류/통합 준비 표시, 기존 운영 카드/메뉴 유지. 로그아웃·화면 교체 후 늦은 응답은 무효화.

## 이전 검증과 Auth 선택

원본 업무수첩: 테이블14, 사용자5, 일정51/업무280. DB storage bucket0. notification-scheduler-gateway1. 태장 public.notification_deliveries와 업무수첩 동명 테이블 충돌을 확인해 worklog/worklog_private로 구분한다. 별도 DB·동기화 서비스를 추가하지 않음.

Google는 기존 태장 Auth ID에 연결하는 경로를 우선한다. 기존 태장 직원/권한/근태/승인 이력의 ID 재배치 금지. 업무수첩 데이터의 Auth FK만 명시적 계정 매핑으로 치환하고 entity ID 보존.

**차단:** Google 이메일을 점유한 과거 태장 Auth 계정이 존재하고, Profile deleted/이메일 미인증 상태지만 상태이력·감사로그 참조가 남아 있다. 임의 삭제/복구/권한 이식 없이 먼저 충돌 해소안을 검수해야 한다. 같은 이름이라고 자동 합치지 않는다. 나머지 업무수첩4명 전환 범위도 미확정.

업무수첩 PR483의 `docs/planning/SINGLE_PROJECT_REHEARSAL_V1.md`, 오프라인 Auth FK 변환기와 PostgreSQL WASM 시험이 상세 원본이다. 복제 DDL14테이블/정책39/함수6/트리거10/인덱스36에 대해 합성 데이터 FK·본인RLS·타직원/익명 차단·기존알림보존·오류 rollback 검증을 실행한다. 실제 Supabase Auth/REST/Google/OAuth callback/모바일/원본 데이터 이전과 구분.

## 후속/승인 경계

이 체크포인트에서 actual migration/Data API expose/Auth/provider config/사용자 계정 변경/운영 deploy/Play/프로젝트 삭제/main 병합 없음. Google linking 화면/PKCE 복구 검사는 아래와 같이 준비했다. 실제 충돌 해소/설정/사용자 OAuth 검증은 남아 있다. 업무수첩 PR483에 전체 RPC·앱 schema 소비·프로젝트별 세션 분리를 준비했지만 실제 이전과 알림 재등록/중복 방지 검수는 미완료다.

실제 적용 전: 원본 백업/내용해시·복구시험 → Auth 충돌 해결/Google 연결(ERP ID 유지) → 승인 범위의 사용자 mapping → 전체 RPC/모바일 포함 격리 전환검수 → 일관된 snapshot 복사/원본보존/쓰기단일화 → RLS/실제31건 대조 → schema expose/read스위치 → 사용자수용 → 별도 main·출시 승인. 전환 후 신규 기록을 회수하지 않은 단순 환경변수 rollback 금지.

현재 실제 모바일 일정 표시: **미달성**. 개발 Preview는 통합 준비 상태이며 실제 개인 데이터는 읽지 않는다. 최초 동일 이메일 후보의 미인증 상태를 실제 사용자의 두 계정 인증 상태로 일반화하지 않는다. 실제 사용자가 알려준 두 계정은 각각 정상 인증되어 있고 이메일이 서로 다른 상태다.

## 기본 비활성 Google 연결 화면

- `staff/google-link.html`: 기존 로그인 후 본인이 Google identity를 연결하는 화면. `GOOGLE_IDENTITY_ENABLED=true`인 환경에서만 로그인 화면과 dashboard 사용자 동작 영역에 진입 링크가 표시된다. 새 sidebar 메뉴 없음. 실제 환경변수/provider/manual linking 설정은 변경하지 않았다.
- 기존 SDK auth-js 2.116.0의 공식 Auth PKCE 흐름에 맞춰 기존 user bearer로 `/auth/v1/user/identities/authorize` 호출, 암호학적 verifier/challenge와 10분짜리 sessionStorage 요청을 생성한다. callback은 같은 origin의 고정 경로이며 nonce/PKCE를 검사한다. implicit fragment token을 거부하고 callback URL의 code는 즉시 제거한다.
- 기존 user를 Auth 서버와 active `get_my_access_context`에서 검증하고, callback 후 같은 Auth UUID와 Google identity가 확인될 때만 ERP 세션을 교체한다. 계정이 바뀌거나 로그아웃됐으면 되살리지 않는다. role/email/name 비교로 연결하지 않는다.
- 연결 취소·점유 충돌·네트워크 오류·다른 Auth 사용자 응답은 기존 로컬 로그인 세션을 유지한다. 외부에서 이미 identity가 연결된 뒤 callback 검증이 실패할 수 있으므로 자동 unlink나 계정 변경을 하지 않는다. 기존 이메일 로그인으로 확인 후 수동 복구한다.
- `?mode=signin`은 이미 연결된 Google로 일반 로그인하는 별도 경로. active Profile 검증을 통과하지 못한 신규/pending 계정은 앱에 입장하지 못한다. provider의 새 사용자 생성 정책은 운영 활성화 전 별도 검수 대상이다.
- 단위 검사와 PC1440/mobile390 브라우저 검사는 합성 fixture만 사용한다. 실제 Google/개인정보/운영 계정을 사용하지 않는다.

## 이메일 점유 해소 검증안

과거 Auth 행을 삭제하거나 되살리지 않는다. 공식 Admin API로 그 행의 이메일만 unique 예약 주소로 바꾸고 기존 UUID/deleted Profile/상태이력/감사참조를 보존하는 방안을 준비했다. 코드가 이 작업을 운영에서 실행하지 않는다.

`tests/google-email-release-auth-integration.mjs`는 localhost:54321와 지정 disposable DB 외 실행을 거부한다. 합성 과거 계정의 이메일 변경 후 UUID·상태이력·감사로그와 기존 다른 사용자의 Profile/역할이 그대로인지를 실제 로컬 GoTrue API로 검증한다. 원래 주소 slot 재사용도 disposable DB에서만 확인한다. Google 연결 자체는 이 시험의 범위 밖이다.

운영 실행 전 원본/대상 백업, exact UUID/provider/상태 재확인, 변경 후 실제 Auth ID·직원 연결·역할·이력 대조 및 복구 절차 승인이 필요하다. 개인 이메일/UUID/데이터 원문은 공개 테스트나 PR에 넣지 않는다.

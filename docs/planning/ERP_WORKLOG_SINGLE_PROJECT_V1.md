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


## 최초 실제 검수 범위

다른 네 명의 매핑 확정 전에는 본인만 pilot로 검수한다. 본인 데이터의 일관된 복사본과 지정된 개발 Preview/모바일 개발 API 주소를 사용하며 기존 업무수첩 전체 사용자의 운영 서버 설정을 전환하지 않는다. 31건은 실사 당시 개수이고 실제 복사 직전 다시 대조한다. 복사 시점 이후 원본 모바일에 쓴 일정까지 자동 반영됐다고 주장하지 않는다. 지속적인 실제 반영은 승인된 쓰기 전환과 개발 기기 재로그인 후 검증해야 한다.

## 실제 적용 체크포인트 — 2026-11-03 KST

사용자는 이메일 점유 해소·기존 ERP ID에 Google 연결 설정·본인 자료 백업 후 복사를 승인했다. main 병합/정식 배포/다른 네 명 전환/프로젝트 삭제는 승인 범위 밖이다.

- 최신 main e4cc8c53의 연차 재직자 개선을 기존 PR575 브랜치에 반영했다. main에는 커밋하지 않았다.
- 태장에 `20261102152012_worklog_personal_readonly_pilot` 단일 migration을 실제 적용했다. 14개 테이블 RLS, 활성 ERP Profile을 검사하는 owner/member helper, authenticated SELECT는 dashboard의 네 테이블에만 부여. 쓰기 RPC/쓰기 ACL/작업 trigger/발송 cron은 적용하지 않았다. pg_trgm은 기존 extensions schema에 설치했다.
- 2026-11-03 00:13 KST 시점 본인 workspace만 원자적으로 복사: 공간1, 멤버1, 업무262, 일정51(confirmed31/cancelled20), source_refs262, normalizations262, preferences1, push7, delivery history85. 나머지 다섯 테이블0. entity ID/원문/원래 시간값을 보존하고 승인된 Auth FK만 치환했다. push는 모두 disabled. 다른 네 명의 자료18건은 복사하지 않았다.
- 별도 비공개 백업의 SHA256은 `51cd4849b5a37f122ba2ec5790e28a3395254560257e827074674dfe2d0693e0`. 공개 repo/CI에 원본 자료·사용자 식별자·push credential을 넣지 않았다. PGlite에서 실제 백업 복원 및 내용 해시 대조 통과 후 복사했다. 운영 복사 transaction에서도 각 테이블을 PostgreSQL typed JSON으로 다시 비교했다.
- 운영 DB의 authenticated 역할로 본인 confirmed31건, 실제 다른 활성 Profile0건을 확인했다. 익명/쓰기/push credential 조회 ACL 차단. 기존 public notification row1 및 ERP 권한/직원 연결/과거 계정 이력은 유지한다. 이 SQL RLS 검사는 실제 사용자 로그인·HTTP·Google 검수의 대체가 아니다.
- 로컬 Supabase config에만 worklog Data API 노출을 추가하고, disposable Auth/REST+실제 personal-worklog handler의 owner/운영총괄 타인/정지/쓰기/credential 차단 검사를 CI에 추가했다.

### 남은 실제 차단점

1. 현재 연결된 Supabase 도구는 SQL/DDL만 지원하고 Auth Admin/Google 설정/관리 API 쓰기를 지원하지 않는다. 태장 Netlify에는 공개 URL/key만 있으며 팀 변수에도 관리자 credential이 없다. 관리자 secret을 브라우저에 노출하거나 auth.users 직접 UPDATE로 우회하지 않았다. 과거 계정 이메일은 아직 변경하지 않았다.
2. 태장 Google provider는 실제 `/auth/v1/settings`에서 false. Google OAuth client/secret 및 새 callback `https://jgsxpdflgkqroecfjzxq.supabase.co/auth/v1/callback`, Supabase manual identity linking 및 고정 검수 callback 허용 설정이 필요하다. 실제 Google 연결은 본인 인증이 필요하다.
3. 실제 Data API는 `Accept-Profile: worklog`에 406/PGRST106을 반환한다. 관리 화면에서 worklog만 exposed schemas에 추가해야 한다. private schema는 노출하지 않는다. SQL role 설정으로 Dashboard 설정을 덮는 별도 우회 계층이나 public fallback RPC를 만들지 않았다.
4. 이 환경의 ego-browser 명령은 없으며 cloud browser runtime도 시작 실패. 사용자 PC의 관리자 브라우저 세션에 접근하지 못했다.

위 설정과 이메일 점유 해소 후 Preview에만 WORKLOG_UNIFIED_READ_ENABLED/GOOGLE_IDENTITY_ENABLED를 활성화·재배포하고 실제 로그인으로 검수한다. 현재 두 스위치는 비활성이고 ERP 첫 화면 실제 표시 성공은 여전히 미달성이다. 기존 모바일 앱 서버는 원본을 계속 사용하며 이후 쓰기 자동 동기화를 주장하지 않는다. 복사 이후 새 원본 기록은 다음 일관된 snapshot/대조 후 별도 반영한다.

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

이 체크포인트에서 actual migration/Data API expose/Auth/provider config/사용자 계정 변경/운영 deploy/Play/프로젝트 삭제/main 병합 없음. Google linking은 충돌 해소와 설정/실제 사용자 OAuth 검증이 남아 있다. 전체 RPC/모바일의 custom schema 소비 및 session/key 전환, scheduler secret/알림 중복 방지는 후속 준비 대상이며 완료 주장하지 않음.

실제 적용 전: 원본 백업/내용해시·복구시험 → Auth 충돌 해결/Google 연결(ERP ID 유지) → 승인 범위의 사용자 mapping → 전체 RPC/모바일 포함 격리 전환검수 → 일관된 snapshot 복사/원본보존/쓰기단일화 → RLS/실제31건 대조 → schema expose/read스위치 → 사용자수용 → 별도 main·출시 승인. 전환 후 신규 기록을 회수하지 않은 단순 환경변수 rollback 금지.

현재 실제 모바일 일정 표시: **미달성**. 개발 Preview는 통합 준비 상태이며 실제 개인 데이터는 읽지 않는다. 최초 동일 이메일 후보의 미인증 상태를 실제 사용자의 두 계정 인증 상태로 일반화하지 않는다. 실제 사용자가 알려준 두 계정은 각각 정상 인증되어 있고 이메일이 서로 다른 상태다.

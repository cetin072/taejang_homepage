> **2026-11-02 변경:** 사용자 요청에 따라 최종 구조를 태장 단일 Supabase + Google 기본 로그인으로 확정. 아래 두 프로젝트 연결안은 이전 시도 이력입니다. 현재 코드는 기존 ERP세션 하나로 worklog스키마를 조회하며 이전 활성화 스위치는 기본 OFF입니다. 실제 이전 검증/차단점은 `docs/planning/ERP_WORKLOG_SINGLE_PROJECT_V1.md`를 따릅니다.

# 태장 ERP × 업무수첩 읽기 전용 통합 1단계

2026-11-02 사용자 확정 요청. 상태: 구현 후보 / 실제 본인 인증 연결 차단. 별도 메뉴 없음.

## 확정 범위

- 기존 ERP 첫 대시보드에 오늘 일정, 미완료·재확인 업무, 월간 달력, 연결 상태 추가.
- 기존 역할별 운영 현황과 직원용 출근앱 보존. 개인 정보 판단은 직책과 독립.
- 읽기 전용. 일정·메모 작성, Auth 변경, DB 이전/migration, main 병합, 운영 배포, Play 제출 제외.
- 일반 근로자의 기존 간단 직원 보드는 확장하지 않음. 기존 ERP desktop shell 사용자가 대상.

## 실행 구조

ERP App session → 같은 origin `/api/personal-worklog` → ERP Auth `/user` + 기존 `get_my_access_context` → 업무수첩 Auth `/user` → 본인 personal workspace/owner membership → 업무수첩 Data API GET(RLS).

두 프로젝트의 access token을 각각 소유 프로젝트에만 전송. 두 Auth 응답에서 확인된 이메일이 동일하고 양쪽 email_confirmed_at 존재해야 연결. 이름·직책·Profile.work_email·user_metadata는 연결 근거가 아님. 클라이언트 입력 user/workspace ID는 허용하지 않음. 계정 ID는 서버 검증 결과에서만 파생.

새 계정 링크 테이블·서비스키·secret·migration·RPC·DB 쓰기 없음. 업무수첩 기존 bootstrap_personal_workspace는 생성 부수효과가 있어 호출하지 않음. 휴대폰의 기존 session/refresh token을 가져오거나 바꾸지 않음.

ERP 대시보드 안에서 업무수첩 계정 로그인. 비밀번호는 업무수첩 Auth에 직접 전송, 저장하지 않음. 서버 검증 성공 후 access token만 ERP 사용자 ID별 sessionStorage에 보관, refresh token 저장하지 않음. 로그아웃/연결 해제 시 삭제. 만료 시 재연결. 이 V1은 공통 계정/SSO 또는 영구 계정 연결이 아님.

업무수첩의 기존 schedule-reader와 briefing-reader의 조회 상태/필터를 독립 복제·적응. 새 라이브러리 없음. 일정 confirmed/tentative, task의 action_kind=null/task + in_progress/waiting/needs_review. 취소/완료/일반 메모 제외. 개인 공간 중 본인이 작성한 항목만 조회. 원문·녹음·metadata 미전송. 월/오늘 구간은 KST, 월경계·자정 걸친 일정 포함. 500건을 넘으면 일부 표시 상태를 명시.

선택 기능 오류는 개인 영역에 표시하고 기존 ERP 운영 카드/메뉴를 유지. 새로고침/월 변경/해제/로그아웃의 늦은 응답은 폐기.

## 운영 DB 읽기 전용 실사

- 기준 main: 태장 c8ffc093de8bee25c72842b1d4a95651fcac428d / 업무수첩 34cba241062912b2c7a3835946a4627444a05653.
- 업무수첩: personal workspace 5개, Auth 5개(이메일 인증 4개). schedules 총 51건(confirmed31/cancelled20).
- workspaces owner_user_id, workspace_members(workspace_id,user_id,role), schedules/work_records(workspace_id,created_by_user_id) 존재. 4개 테이블 모두 workspace 접근 RLS 존재.
- 태장 profiles.id는 태장 Auth 식별자. 두 프로젝트의 동일 UUID를 동일인으로 간주하지 않음.
- 두 프로젝트 이메일 일치 1쌍, 양쪽 모두 인증된 이메일 일치 0쌍. 이메일·계정 ID·일정 제목/내용은 공개 기록하지 않음.
- Auth 설정 변경 없이 현재 실제 계정으로 연결 성공을 입증할 수 없음. 이메일 인증을 임의 완료시키거나 API 서비스키로 조회하는 우회 금지.

## 계정/프로젝트 방식 비교

| 항목 | 두 프로젝트 유지 (V1 선택) | 업무수첩을 태장으로 이전 |
| --- | --- | --- |
| 인증 | 각 세션 별도 검증. 현재 인증 근거 부족으로 실제 연결 차단 | 새 Auth ID 매핑·로그인 전환 필요 |
| 개발량 | 작은 읽기 API/대시보드, 모바일 수정 없음 | workspace/member/record/schedule 외 storage·알림·OAuth·함수·기존 migration 의존성 전체 감사 필요 |
| 보안 | 양쪽 사용자 token + RLS + 본인 검증. 새 privileged key 없음 | 공통 Auth의 편의는 있으나 개인/회사 RLS 격리 재검증 필수 |
| 손실 위험 | 복사/이동 없음 | 백업·중복/ID/FK·첨부 경로·전환/롤백 필요 |
| 비용 | 기존 프로젝트 사용량 + 조회 요청 증가. 새 유료 서비스 없음 | 프로젝트 compute 고정비 절감 가능, 데이터/네트워크 사용량은 합쳐짐 |
| 앱 영향 | 없음 | 서버 URL/key·session·OAuth·push·서명된 첨부 경로까지 확인 후 앱 전환 필요 |

공식 요금 확인(2026-11-02): Pro는 조직 구독 $25/월부터, 첫 프로젝트 포함, 추가 프로젝트 $10/월부터. 단순히 프로젝트마다 Pro $25라고 합산하지 않음. 실제 조직/compute/사용량에 따라 다름. 출처 https://supabase.com/pricing . 장기 통합은 별도 승인·리허설 후 판단하며 이번에는 이전하지 않음.

## 검증/완료 기준 대조

- 구현: 대시보드 영역·월 이동·오늘 일정·미완료 업무·연결 상태·실패 격리·사용자 기반 서버 검증.
- 자동검증: tests/personal-worklog.test.mjs (인증/소유권/다른 계정/타 프로젝트 token/상태/limit), tests/personal-worklog-browser.mjs (합성 Chromium 1440/390).
- 미검증: 본인 ERP 로그인 → 기존 모바일 앱 일정 실제 표시. 합성 fixture를 실제 데이터 성공으로 간주하지 않음.
- 차단: 양쪽 인증된 이메일 동일 계정 쌍 없음 + 현재 세션에 실제 사용자 로그인 토큰 없음. 이메일 인증이나 명시적 계정 매핑은 사용자 승인 범위 확정 후 별도 실행.
- Preview는 개발 확인용이며 고정 QA/사용자 수용 준비와 별개. Staging ERP 계정과 운영 업무수첩 계정 간에도 동일 본인 검증을 우회하지 않음.

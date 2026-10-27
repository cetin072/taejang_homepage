# 태장 지원사업 찾기 — 최소 부분 재구성

## 승인과 경계

2026-10-26 사용자가 공고 탐색·원문·기간·대상 확인, 관심/보류, 담당자·준비 내용 연결, 기존 디자인 재사용 기획을 듣고 구현 시작을 승인했다. 이후 표시명을 **태장 지원사업 찾기**로 확정했다. 조직 공통 관심은 기존 신청(apply)과 독립적으로 둔다. 추가 지시에 따라 운영에 적용하지 않는 수집 DB 저장/실행 이력/관심 계약 파일 및 실제 격리 DB 검수까지 진행했다.

기준 main `dec4ca7e77f32267ee37a99d3865cf7efd66117c`. AGENTS, 플랫폼/중앙 헌법, OPEN_SOURCE_ADOPTION을 확인했다. 저장소에는 .agents/skills가 없다. #175/#189는 사전 진단상 미병합·충돌이며 실 API 성공 근거가 없었다. 로컬에 해당 브랜치가 없고 GitHub GraphQL 조회가 Forbidden이어서 이를 우회하지 않고 최신 main 기반의 좁은 브랜치를 사용했다. 기존 PR의 최신 현황 통합은 후속 확인 사항이다.

## 최종 구현 범위

| 항목 | 구현 / 검증 경계 |
| --- | --- |
| 첫 화면 | 공고 목록 중심. 기관·기간·대상·원문·지역/분야·판단, 검색/마감/관심/판단 필터, 목록 복귀 상태 보존 |
| 공고 상세 | 기존 RPC를 감싼 좁은 finder 조회. 기존 평가·배정·검토·진행 보존, 평가/검토를 보조 영역으로 배치 |
| 관심 | 조직 공통 독립 보관. 저장/해제 RPC와 UI 구현. revision 낙관적 잠금, 기존 audit에 before/after·revision 기록. 해제는 삭제가 아님 |
| 수집 저장 | 공식 JSON → 정규화 → 기존 공고/출처 저장 RPC → finder 조회 구현. source ID 중복 제약과 source 행 잠금, run UUID 멱등성 |
| 원문 정정 | 이전 source snapshot과 현재 값이 같은 필드만 갱신. 사람의 수정, 검토 메모, 결정, 배정, 진행은 보존 |
| 실행 이력 | 추가된 runs 테이블에 상태/신규·변경 수/허용된 원문 snapshot을 append. 기존 sources 마지막 시도·성공·오류와 연결 |
| 상태 화면 | 성공·새 공고 없음·미연결·인증 실패·HTTP/통신/응답 오류 구분. 실패 시 마지막 성공 시각과 공고 유지 |
| 기존 환경 호환 | 새 RPC가 없는 PGRST202/42883에만 기존 조회로 fallback. 권한 오류에서는 fallback 안 함. 미적용 환경에서는 관심 연결 대기 안내 |
| 실제 외부 API | 읽기 전용 공식 fetch 구현, **키 없어 실제 인증 호출 미실행** |
| 운영 적용 | **전혀 적용하지 않음**. 공유 DB/계정/비밀/스케줄/배포 변경 없음 |

목록은 기존 계약상 최대 200건(마감일 순), collector는 최신 100건 단일 요청으로 제한한다. 전체 과거 공고 동기화가 아니다. 응답에서 사라진 공고를 삭제하지 않는다. 상시·예산 소진·미정·잘못된 기간은 원문을 보존하고 날짜를 추측하지 않는다. 관심 단계의 담당자 배정으로 기존 승인 의미를 확대하지 않으며, 배정은 기존 신청 이후 흐름을 유지한다.

## 재사용과 책임

기존 Auth/capability/RLS/RPC/audit/평가 버전과 판단·배정 데이터는 유지한다. 새 RPC는 기존 관리 역할과 private_actor_can을 함께 확인하며 CEO는 읽기만, 배정 직원은 기존 내 업무 범위를 유지한다. 새 테이블은 RLS 활성화 및 일반 역할 직접 접근 철회, 필요한 RPC EXECUTE만 부여한다. 정기 service-role 수집 경로는 만들지 않았다.

신규 데이터는 현재 태장 단일 조직 범위의 Domain이다. 멀티테넌트·범용 폼 엔진·새 서비스 추상화는 만들지 않는다. DB 공고 정정은 source snapshot과 비교하며 기존 평가 revision을 덮어쓰지 않는다. 관심 자체의 revision은 동시 편집 충돌 방지에만 사용한다.

관리자 Shell/accent 토큰, #494 admin-authoring.css, #487 app-summary-list, #510 목록/상세 분리, #476 동일 역할 기반 렌더러를 재사용한다. 제목 문자열로 DOM을 찾던 assignment/review/progress/profile 일부를 명시적 surface/section/slot으로 연결했다. 새 디자인 시스템이나 앱 의존성은 없다. 한 공식 JSON API에는 fetch와 작은 collector가 충분해 Crawlee/rss-parser/n8n은 제외했다.

## 실행 경로

공식 명세: https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi

```sh
node scripts/support-radar/collect-bizinfo.mjs --fixture tests/fixtures/support-radar/bizinfo.json
node --test tests/support-radar-bizinfo.test.mjs
# Docker의 pinned postgres 이미지가 준비된 로컬 환경만; 새 network=none 컨테이너를 직접 생성:
node tests/support-radar-database.mjs
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium node tests/support-radar-minimal-browser.mjs
```

`collect-bizinfo.mjs` CLI는 여전히 read-only 출력용이다. 실제 저장 호출은 `persist.mjs`의 `collectAndPersist({rpc, key, runId})` 또는 `persistCollection(result,rpc,runId)`로 분리했다. caller가 **기존 인증 RPC transport**를 명시적으로 주입해야 한다. 저장 대상 URL/서비스키/스케줄을 코드에 넣지 않았다. 동일 runId 재시도는 같은 기록을 반환하며 다른 내용이면 거부한다. DB는 허용된 필드만 저장하며 원문 오류 본문·키·추가 속성을 저장하지 않는다.

## 격리 DB 검수

`tests/support-radar-database.mjs`는 연결 URL이나 기존 컨테이너를 입력받지 않는다. pinned PostgreSQL 16 이미지를 새 이름으로 실행하고 network=none, 포트 없음, data tmpfs만 허용함을 inspect한다. repository의 실제 지원사업 migrations와 실제 역할/capability/audit 함수 정의를 사용한다. 인증 공급자는 합성 auth.users/세션 uid fixture다. 모의 SQL 엔진이 아니며 실제 PostgreSQL에서 23개 저장·조회·동시성·권한 검사를 통과했다. 종료 시 자신이 만든 라벨/이름의 컨테이너만 제거한다. 전체 Supabase migration/실제 GoTrue/PostgREST/JWT/pgTAP 검증을 대신하지 않는다.

Supabase 스킬/공식 함수 문서를 확인했다. changelog 원문은 접근 실패로 확인하지 못했다. migration-new CLI는 read-only `/home/agent/.supabase` 초기화 오류로 실행되지 않아 실제 관측 UTC 시간으로 migration 파일을 작성했다. 홈 권한·인증을 변경하거나 우회하지 않았다.

## 남은 승인·적용

- 새 migration은 **로컬 격리 DB에만 적용**했다. 공유 운영 DB taejang-phase1-staging 적용 금지.
- 실제 키 제공/안전한 실행 환경 연결, 실제 인증 호출과 공식 응답 형태 확인 필요.
- 원격 접근 복구 후 PR 현황 대조·후속 커밋 제출·CI/Preview HEAD 대조 필요. GraphQL 거절/후속 push 인증 오류는 재시도하지 않는다.
- 운영 migration, 비밀 연결, 정기수집 활성화, 권한 확대, Ready/main 병합, Production은 별도 승인 전 금지. 홈페이지 72시간 정책과 공지 #535/별도 업무배정 제거는 변경하지 않았다.

이전 9b9b2e8 인계본에서 '관심/DB 저장 미구현'이었던 부분은 이번 로컬 구현·격리 검수로 보완했다. 운영에서 기능이 켜졌거나 실제 API 인증에 성공했다는 뜻은 아니다.

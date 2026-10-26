# 지원사업 최소 부분 재구성 — 2026-10-26

## 승인·기준

사용자가 공고명·기관·기간·대상·원문, 검색/필터와 관심/보류, 담당자·준비 내용 연결, 기업정보·수집 설정의 보조 배치, 미연결/실패/신규 없음 구분 및 기존 디자인 재사용 기획을 듣고 “바로 시작하자”라고 승인했다. 자동 신청 제출은 제외한다. 관심은 신청과 별개이며 조직 공통 보관을 기본 제안으로 둔다.

기준 main: `dec4ca7e77f32267ee37a99d3865cf7efd66117c`. `AGENTS.md`, 플랫폼 헌법, OPEN_SOURCE_ADOPTION, 접근 가능한 중앙 개발 헌법을 읽었다. 이 main에는 `.agents/skills`가 없다.

#175/#189는 사전 진단상 미병합·충돌 상태이고 실제 API 성공 검증이 없었다. 이번 환경의 Git에는 해당 브랜치가 없고 GitHub GraphQL PR 목록 조회도 Forbidden으로 거절됐다. 이를 다른 경로로 재조회하지 않았다. 기존 PR을 검증 없이 합치지 않고 최신 main 기반의 좁은 로컬 브랜치 `codex/support-radar-minimal-rebuild`에서 작업했다. 원격 PR의 현재 HEAD/review 재확인과 기존 작업 통합은 미완료다.

## 구현 대조

| 기획 | 결과 |
| --- | --- |
| 공고 탐색 우선 | 구현. 레이더 진입을 목록으로 연결, 기관·마감·지역/분야·판단 표시. 검색/판단/마감 필터 및 상세 복귀 상태 보존 |
| 원문·신청기간·대상 | 상세에 기존 RPC 자료 표시. 목록 RPC는 URL/대상/시작일을 반환하지 않으므로 상세에서 확인. 목록에서의 직접 원문 버튼·전체 기간은 후속 계약 확장 필요 |
| 관심·보류 | 보류/신청/제외 기존 판단과 필터 보존. **관심 저장 미구현**: 기존 apply를 관심으로 바꾸지 않음. 아래 최소 계약 검토 후 연결 |
| 평가·검토·진행·담당자 | 기존 데이터/RPC 유지. 평가·검토는 접을 수 있는 보조 영역. 기존 신청 후 배정 제한 유지; 관심 단계 배정은 자동 확장하지 않음 |
| 기업정보 | 기존 프로필 편집과 버전 이력 재사용 |
| 수집 상태 | 기존 source 조회 RPC의 연결 상태·마지막 시도/성공·오류 표시. 상태 조회 실패가 공고 조회를 막지 않음 |
| 기업마당 실제 연결 | 공식 GET JSON collector 구현, **실제 인증 호출 미실행**. 현재 프로세스의 BIZINFO_API_KEY/BIZINFO_CRTFC_KEY 존재 여부 false. Hosted 비밀 설정은 조회하지 않음 |
| 중복/메모 보호 | 순수 병합과 격리 파일 round trip 통과. **운영 DB upsert 미연결** |

## 구조와 재사용

`기존 Auth/capability → 목록/상세 owner → 기존 RPC/RLS → 기존 데이터/audit/revision`은 그대로 둔다. assignment/review/progress는 제목 문자열 대신 owner가 제공한 data section/slot을 사용한다. profile polish도 명시적인 surface로 식별한다. 기존 후처리 전체를 새 프레임워크로 재작성하지 않는다.

관리자 Shell 및 accent 토큰, #494 admin-authoring.css, #487 app-summary-list, #510 목록/상세 분리와 필터 유지, #476 운영총괄 기준 동일 UI를 재사용한다. 새 CSS 팔레트/프레임워크/의존성은 없다. 기존 UI 패턴 문서의 Tabler/GOV.UK 벤치마킹을 다시 패키지 도입으로 확장하지 않는다. 기업마당 한 JSON API는 표준 fetch와 작은 파서로 충분하여 Crawlee/rss-parser/n8n은 제외한다. Domain 소유는 현재 태장 내부에 유지하고 플랫폼화는 보류한다.

## 수집기 사용과 경계

공식 명세: https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi

```sh
node --test tests/support-radar-bizinfo.test.mjs
node scripts/support-radar/collect-bizinfo.mjs --fixture tests/fixtures/support-radar/bizinfo.json
# 기존 안전한 환경변수로 키가 제공되는 실행 환경에서만:
node scripts/support-radar/collect-bizinfo.mjs
```

CLI는 정규화된 검토용 JSON을 stdout으로 출력한다. 운영 DB 쓰기·서비스 키·스케줄·Netlify 배포 연결이 없다. 인증키/요청 URL/업스트림 오류 본문을 로그에 출력하지 않는다. 실제 호출은 최대 최신 100건의 단일 요청이며 전체 과거 공고 수집이나 완전 동기화를 뜻하지 않는다. 응답에서 빠진 과거 공고는 삭제하지 않는다. ID/제목/HTTP(S) 원문을 검증하며, 신청기간의 실제 달력 날짜·순서를 확인한다. 예산 소진/상시/미정/잘못된 날짜는 원문을 보존하고 마감일을 추측하지 않는다.

수집 결과 계약은 `not_connected`, `authentication_failed`, `http_error`, `network_error`, `invalid_response`, `success_new`, `success_no_new`다. 오류 시 마지막 성공 자료/시각 유지, 성공 시 최신 시각 갱신. 정상 재수집에는 신규 0/변경 N을 구별한다. 화면은 아직 이 새 실행 결과 저장소와 연결되지 않았으며 기존 source 자료만 표시한다. 신규 건수를 제공하지 않는 기존 RPC 결과에서 '새 공고 없음'을 추정하지 않는다.

## 다음 최소 계약 — 검토용, 적용하지 않음

1. **조직 공통 관심:** 현 단일 태장 범위에서 `notice_id`당 하나의 보관 상태와 변경자/변경시각을 갖는 독립 레코드. 기존 신청 판단과 분리. 조회는 기존 management_view, 변경은 기존 management_edit 경계로 제한하며 권한을 확대하지 않는다. 변경 사유/audit, 유효 공고 확인, 중복 요청의 멱등성을 기존 방식으로 구현한다. 데이터 의미·migration 파일과 RLS/RPC 검증을 검토한 뒤 별도 승인으로 적용한다. localStorage로 조직 공통 상태를 가장하지 않는다.
2. **수집 반영:** 공식 필드만 허용목록 upsert. `(source_id, source_notice_id)` 식별을 현재 원문/중복 구조와 대조하고 트랜잭션·동시 재수집 제약을 검수한다. 메모/평가/판단/배정/결과는 갱신 대상에서 제외. 동일 실행에서 source의 시도/성공/안전한 오류 분류와 신규/변경 수를 기록. 현재 snapshot 검사는 DB 제약 검증을 대신하지 않는다.
3. **원문 기간·목록:** 신청기간 원문 필드의 저장 위치, 목록 RPC의 canonical_url/eligibility_summary/application_start_at 반환을 승인된 additive 계약으로 준비한다. 기존 반환 필드는 제거하지 않는다.

운영 DB인 taejang-phase1-staging에 테스트 쓰기 금지. 격리 DB가 확인된 후 동시성/역할별 서버 거부/감사 이력을 검증해야 한다. 새 키 발급·비밀 연결·마이그레이션 적용·자동화 활성화·권한 변경·Ready/main merge/Production은 미실행이며 별도 승인 항목이다. 홈페이지 72시간 정책은 변경하지 않는다. 공지 #535 및 업무 배정 제거 작업은 다루지 않는다.

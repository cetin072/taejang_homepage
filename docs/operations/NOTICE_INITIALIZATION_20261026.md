# 공지 관리 독립 초기화 — 2026-10-26

## 요청 및 범위

사용자 실행 지시: 공통 공지 UI 유지, 기능 초기화 독립, 서버 권한 경계 보존.
기준: AGENTS.md, 플랫폼 헌법 §4, Web Architecture Adoption, #446, #489, 병합된 #491.
기준 main: `219951894d0cc236f9828bb7c540bed851b5618b`.
새 화면·라이브러리·API·migration·권한 정책 변경 없음.

## 재현으로 확인한 결함

이전 구조: `app.js/loadAdminData(task.manage)` → options/업무목록 `Promise.all`
성공 → `taejang-admin-options-ready` → 공지 `options` 설정/조회.
공지 메뉴 진입도 `options`가 없으면 조회를 실행하지 않았다.
따라서 업무 API 실패 또는 task.manage 미부여 시 공지 요청 자체가 누락된다.
실제 app.js/공지 DOM/컨트롤러를 Chrome에서 실행하고 업무 API만 503으로
만들면, options RPC는 실행되지만 공지 목록 RPC는 0회이고 오류 안내도 없었다.
`NOTICE_INIT_BASELINE_REF=origin/main`으로 동일 회귀를 재현할 수 있다.

신고 당시 직원/미리보기 세션의 개별 실패 응답은 확보하지 못했다.
따라서 재현된 구조 결함과 그 당시 특정 HTTP 실패를 동일시하지 않는다.

## 수정 구조

- 기존 메뉴 진입 → 공지 모듈이 자기 목록/옵션을 조회한다.
- 목록은 기존 list_manageable_notices_page/get_manageable_notice를 재사용한다.
- 관리자 옵션/일정 선택기는 별도 선택 데이터이며 실패·지연해도 목록을 막지 않는다.
- 기존 이벤트 수신 제거. 같은 진행 중 검색은 공유하고 다른 검색의 늦은 응답은 무시한다.
- 같은 계정의 app-ready 재실행은 입력/사진을 초기화하지 않는다.
- 계정/유효 역할/공지 capability 변경은 이전 목록·선택·편집 상태를 지우고 늦은 응답을 버린다.
- 옵션을 못 읽어도 기존 관련 자료/일정 ID를 입력에서 보존한다.
- 로딩/빈 결과/실패/권한 거부를 구분한다.
- app.js는 다른 기존 소비자의 이벤트를 유지한다. 공지 파일만 런타임 변경한다.

## 역할 및 운영 읽기 대조

운영총괄/운영팀장은 동일한 목록·작성기·상세·미리보기를 사용한다.
can_edit/can_lead_edit 등 기존 서버 응답으로 버튼을 제한하며 최종 쓰기 권한은 RPC/RLS에 있다.
팀장의 타인 공개 company 공지/종료 이력 조회와 자기 routine 공지 작성·게시는 유지한다.
타인 초안·미래 예약·승인/중요공지 수정 권한을 추가하지 않는다.

운영 DB `jgsxpdflgkqroecfjzxq`는 이름과 달리 공유 실사용 DB다.
읽기 전용 집계: published/company 2건. notice/manage 읽기 helper 및 옵션 RPC 계약 확인.
promotion_lead에는 notice.manage와 task.manage 둘 다 부여돼 있었다.
현재 직원의 task.manage 부재를 실제 원인이라고 주장하지 않는다.
실직원 계정/공지/Storage/권한 수정 및 migration 실행 0건.

시작 시 Production 배포: `6addfa0c5ae783317814ade6`, commit
`ca7431939cbeacacb20335cb55bb34bc4c0e8cd8` (Netlify readback).
고정 qa-preview 시작 SHA: `a509e8e7109ef70532c8144e2418d95f4d618889`.
다른 검수의 QA 소유권을 임의 교체하지 않는다. PR Preview는 개발 자동검증용이다.

## 검증 증거와 한계

- platformStatic 596 PASS, stagingSafety 16 PASS, Netlify dist build PASS.
- 새 Chrome gate: 390/1440 × 운영총괄·팀장·팀장 미리보기 합성 계약 6조합.
  업무 API 실패, notice.manage only, 옵션/일정 실패·지연, 빈 결과, 403/503,
  재진입/중복 이벤트/새로고침/권한 취소 및 복귀를 검사한다.
- 기존 notice-authoring 320/390/1280 및 notice-history 320/390/1440 회귀를 재사용한다.
- 실제 DB 검증: 기존 notice-review-media Auth/RPC/RLS/Storage suite에
  역할 미리보기 조회 및 실제 Chrome 저장→게시→정확한 ID 서버 재조회→새로고침을 연결한다.
  localhost-only 합성 계정/공지이며 업무 API만 실패 주입한다.
- 로컬 Docker 없음. 실제 격리 DB 결과·원격 CI/Preview 정확한 HEAD는 PR에 기록한다.
- 실제 직원의 hosted 로그인/저장 및 실기기 검증은 NOT_VERIFIED.
  합성 브라우저·격리 DB PASS를 실직원 hosted PASS로 보고하지 않는다.

## 유사 결함 점검

- schedule-admin.js: taejang-admin-options-ready에서 options를 받고 load.
- guidance-admin.js: 같은 이벤트 의존 + 안내와 선택 일정이 Promise.all로 묶임.
- app.js의 이벤트는 task.manage 및 업무목록 성공 후에만 발생한다.

두 메뉴도 공지와 유사한 의존이 있으나, 대상/폼 상태·별도 권한을 검사해야 하므로
이번 공지 패치에 섞지 않는다. 후속 수정 후보이며 해결 완료가 아니다.

## 남은 경계

Draft PR. main/Ready/Production/운영 DB 변경은 별도 승인.
48시간 정규 배포 정책 유지. 필수 CI 및 고정 QA의 정확한 HEAD·환경·소유권
확인 전 사용자 수용 검수를 요청하지 않는다.

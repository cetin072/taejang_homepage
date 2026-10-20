# 관리자 작성 UI 공통화 검증

기준 main: `b4df2ed66e03a8ba2e00efe56b079445b78dba7c` (PR #491 포함). 마지막 fetch에서도 동일하다.
작업 브랜치: `feat/admin-authoring-ui-shared-20261020`. 최신 검증 커밋은 해당 브랜치 HEAD/PR 기록을 기준으로 확인한다.

## 구현과 적용 범위

공통 소유자는 `app/assets/admin-authoring.css`다. shell의 단일 import와 standalone 급여 페이지 link로 로드한다. 6,714 bytes / gzip 1,701 bytes. 신규 JS 런타임·의존성·CDN·역할별 렌더러·DB migration은 없다.

실제 작성 소유자에 `app-authoring` 또는 `app-authoring-inline`을 명시하고 반복 label/control 선언을 제거했다. 업무별 DOM ID·필드·이벤트·RPC·저장 후 재조회·Session/JWT·승인선은 보존한다. 섹션·직원 기본/첨부 색상은 동일 토큰을 사용한다. 긴 본문은 폭과 최소 높이를 확보하고 임시저장/상신 버튼을 구분한다.

화면별 소유자·기존 공유·입력·첨부·미리보기·권한·적용 결과는 [전체 적용 대장](../../../operations/ADMIN_AUTHORING_UI.md)을 따른다. 조회/필터·공개홈·직원앱·모바일앱·native 확인창은 제외했다. 급여/근태 표의 데이터 행/전문 스크롤은 유지하고 셀 입력만 공유한다.

## 로컬 검증 결과

| 검사 | 결과 | 범위와 한계 |
| --- | --- | --- |
| npm test | PASS — 1,209 (578 platform + 114 public + 517 payroll), 실패/skip 0 | 실제 기존 suite, DB 서버 실행과 구분 |
| staging safety | PASS — 16, 실패/skip 0 | 기존 안전 guard |
| build:netlify | PASS | dist/app/assets/admin-authoring.css 포함. 외부 Naver 이미지 38건 fetch 실패로 기존 local fallback 사용; 제품 소스·공개글 변경 없음 |
| 기존 기능 gate HTTP | PASS — 11개 × PC/모바일 = 22 | 공개글 편집·가입승인·운영총괄 홍보·일반직원·홍보·사진첨부·보관/복구·링크·발행·사이드바 |
| 공통 작성기 반응형/토큰 | PASS — 11개 × 4해상도 = 44 | 1440/768/390/320. 정적 실제 form 7개 + 직원등록/가입승인/홍보/지원 프로필. radius를 17px로 바꾸어 모든 renderer에 전파 확인 후 원복. 필수 테두리·섹션·44px 입력·22px checkbox·hidden 보존·overflow 확인 |
| 지원사업 실패 입력 보존 | PASS — 4해상도 | 실제 renderer의 저장 RPC를 합성 실패시켜 회사명 보존 확인 |
| admin-ui-browser | PASS — 4해상도 | 가입승인 기존/신규/사유, 키보드·체크박스, 홈페이지 수정 실패 입력 보존·권한 거부 |
| 직원 프로필 기존 browser | PASS — PC/모바일 | 목록·검색·편집·취소·저장·사진 Storage/RPC/재조회 실패와 권한 축소 |
| notice-management-browser | PASS — 390/1440 | #491 현재 fixture로 공지 목록·동일 ID 재조회·수정·보관함·대상/역할 회귀 |
| 현장조사 기존 browser | PASS — 1440/390 | 기존 50명 합성 자료·사진 업로드 재시도·교정 실패 보존·필터. 공통 stylesheet와 shell 범위를 fixture에 로드 |
| 급여 handoff 기존 자동화 | PASS — 390, Playwright 전송 | 기존 server/workspace/session/automation의 결과 노드가 pass. raw --dump-dom은 이 Chrome에서 종료하지 않아 중지; 같은 fixture/assertion을 Playwright로 실행. 실제 급여 미접근 |
| diff/문법/서버 범위 | PASS | git diff --check, 신규 browser 문법. supabase/netlify/functions/staff/mobile 변경 0 |
| 원격 CI | 미확인 | 최초 HEAD는 공지 입력 16px 검사 실패. 원인 재현 후 수정하고 정확한 CI 결과는 PR 현재 HEAD를 따른다 |
| 개발 Deploy Preview | 미확인 | Draft PR #494 생성. Netlify ready/commit_ref 대조 및 Preview 자산을 사용하는 browser CI 추가. 고정 QA·Production 미변경 |

개발 환경의 기본 샌드박스는 일부 자식 프로세스 실행을 EPERM으로 차단하므로 허용된 실행 권한에서 같은 검사를 수행했다. file:// 탐색을 Chrome 정책이 차단해 기존 fixture를 HTTP로 실행했다. 새 `admin-authoring-browser.mjs`는 원래 기능 gate 결과 노드를 정확히 검사하며, script 안 PASS 문자열을 결과로 사용하지 않는다.

Node24의 기본 fetch가 환경 proxy를 사용하지 않아 빌드가 오래 대기하던 실행은 중단했다. `NODE_USE_ENV_PROXY=1`로 같은 기존 suite/build를 다시 실행했으며 TLS·CA 검증은 유지했다. 외부 사진 다운로드 제한은 관리자 입력 UI 변경과 독립적인 로컬 빌드 제한이다.

## 재현

```bash
NODE_USE_ENV_PROXY=1 npm test
npm run test:staging-safety
NODE_USE_ENV_PROXY=1 npm run build:netlify
CHROME_PATH=/usr/bin/chromium node tests/admin-authoring-browser.mjs
CHROME_PATH=/usr/bin/chromium node tests/admin-ui-browser.mjs
CHROME_PATH=/usr/bin/chromium node tests/issue-451-employee-profile-browser.mjs
CHROME_PATH=/usr/bin/chromium node tests/notice-management-browser.mjs
CHROME_PATH=/usr/bin/chromium node tests/issue-456-field-audit-browser.mjs
```

baseline 캡처: `AUTHORING_BASELINE_REF=b4df2ed66e03a8ba2e00efe56b079445b78dba7c`를 새 browser 명령에, `ADMIN_UI_BASELINE_REF`를 기존 admin-ui 명령에 설정한다. 출력은 `AUTHORING_QA_OUTPUT`/`ADMIN_UI_QA_OUTPUT`으로 지정한다. GitHub CI에는 새 shared authoring 검사와 4해상도 screenshot artifact를 등록했다.

급여 환경 재현 한계: `payroll-draft-handoff-browser.mjs`의 fixture/automation을 그대로 사용하고 마지막 `spawn(chromeBinary()... --dump-dom)` 전송부만 Playwright의 `page.goto`와 `#payroll-handoff-browser-result[data-status=pass]` 대기로 실행했다. 저장·검토·상신 assertion은 줄이거나 바꾸지 않았다. repository의 기존 raw runner는 변경하지 않았다.

## 대표 전후 캡처

모두 합성 데이터이며 직원 개인정보·운영 공지·실직원 사진·실제 계정은 사용하지 않았다. 전체 로컬 실행은 4해상도를 검사하고 아래 6개 대표 화면의 PC/모바일 비교 24장을 저장소에 보관한다. CI 실행 시 11개 화면 × 4해상도 산출물을 artifact로 남긴다.

| 화면 | PC 전 → 후 | 모바일 전 → 후 |
| --- | --- | --- |
| 직원 등록 | [전](before-employee-registration-1440.png) → [후](after-employee-registration-1440.png) | [전](before-employee-registration-390.png) → [후](after-employee-registration-390.png) |
| 가입 승인 | [전](before-approval-existing-1440.png) → [후](after-approval-existing-1440.png) | [전](before-approval-existing-390.png) → [후](after-approval-existing-390.png) |
| 공지 작성 | [전](before-notice-form-1440.png) → [후](after-notice-form-1440.png) | [전](before-notice-form-390.png) → [후](after-notice-form-390.png) |
| 홍보 작성 | [전](before-promotion-writer-1440.png) → [후](after-promotion-writer-1440.png) | [전](before-promotion-writer-390.png) → [후](after-promotion-writer-390.png) |
| 홈페이지 수정 | [전](before-homepage-text-1440.png) → [후](after-homepage-text-1440.png) | [전](before-homepage-text-390.png) → [후](after-homepage-text-390.png) |
| 지원 프로필 | [전](before-support-profile-1440.png) → [후](after-support-profile-1440.png) | [전](before-support-profile-390.png) → [후](after-support-profile-390.png) |

## 남은 검수·승인

Draft PR #494를 생성했다. 최초 API proxy 403은 이후 복구되어 Netlify API의 ready/HEAD를 확인했다. 클라우드에서 Preview hostname으로 직접 요청하는 것은 여전히 차단되어, GitHub CI에서 기존 UAR의 exact-head Preview 선택을 재사용해 배포된 HTML/CSS/JS로 동일 browser 검증을 수행한다. 실제 인증/권한 검증은 기존 CI 결과와 구분한다. 최종 CI·배포 ID·HEAD는 PR 검증 기록에서 대조한다.

모든 개별 업무 경로에서 서버 쓰기를 실행한 것은 아니다. 인사·주민번호·급여·근태·공지·사진의 실제 데이터 변경 0, 로그인 계정 초기화 0, 운영 배포/고정 QA 교체 0이다. 실제 인증 환경의 최종 통합 Preview·휴대폰 키보드/카메라 사용감은 후속 확인 대상이다.

최초 CI의 공지 작성 UX gate가 입력 글자 16px 미만을 검출했다. 같은 fixture로 로컬 재현 후 공통 control의 font-size를 1rem으로 고정했다. 기존 공지 gate를 새 shared HTTP 검사에도 포함하고 16px 이상 assertion을 추가했다. 기능 assertion을 완화하지 않았다.

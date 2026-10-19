# 직원 정렬·사진 용도·공지 저장 확인 개선

직원 목록에 직책 순서가 없고 공지 등록 후 관리 목록이 계속 숨겨져 저장된 공지를 찾기 어려웠습니다. 기존 직원 views/controller와 공지 작성기 하나를 유지하며 정렬·큰 사진·저장 결과를 보완합니다.

Closes #489

기준 main: `8ed59d74`. 적용 기획: [ADMIN_EMPLOYEE_NOTICE_CONSISTENCY_V1](../../ADMIN_EMPLOYEE_NOTICE_CONSISTENCY_V1.md), [ROLE_PERMISSION_MATRIX_V1](../../ROLE_PERMISSION_MATRIX_V1.md), [ADMIN_UI_READABILITY_V1](../../ADMIN_UI_READABILITY_V1.md), 플랫폼 헌법 §4.

## 구현 대조

| 요청 | 결과 |
| --- | --- |
| 직책 기본 + 6개 정렬/필터/상세 복귀 | 구현. 기존 DB sort_order로 정렬된 positions 응답 재사용; general_worker 마지막; 직책 미지정/불일치 별도 그룹; 퇴직자는 하단 |
| 업무용/증명사진 용도 확인 | 업무용: 식별/목록/상단. 증명사진: 인사/행정 전용, 일반 목록 미사용. 기존 조회·변경 요청·서버 제한 유지 |
| 상세 상단 사진 확대 | PC 120px, 모바일 100px; 목록 40px, photo signed URL/세션 갱신/등록/변경 기존 계약 유지 |
| 사진 중복 표시 오류 | undefined 증명사진 경로가 업무용 사진 기본값으로 대체되던 오류 수정. 미등록 증명사진은 placeholder만 표시 |
| 공통 관리자 작성 UI | main #487의 Tabler section/action과 GOV.UK summary rows·기존 CSS owner 재사용. 가입 승인/홍보/홈페이지 정상 화면 재작성 제외, 회귀검증 |
| 공지 저장→확인 | 성공 후 공통 관리 목록 표시·방금 저장 표시·해당 ID 바로 찾기·상태 안내·입력/미리보기 보존. 수정 시 같은 ID 재사용 |
| 공지 목록 실패 경계 | 선택 일정 RPC 실패와 공지 목록 성공을 분리; 실제 목록 실패/조회 누락은 저장 성공과 구분 |
| 상태·승인선 | 비공개 초안/운영총괄 검토 대기/예약 게시/게시 중/게시 종료/취소·사용 중지. routine 직접 게시/review 상신 기존 RPC 유지 |
| 공개글 수정 요청 안내 | 지정한 사용자 문구로 교체, 주소/내용/사유/요청 RPC 유지 |
| 실제 데이터/권한/스키마 | 변경 제외. 새 migration·의존성·직책 시스템·역할별 복사본 없음 |

## 코드/서버 계약 조사

- 최신 `private_get_employee_management_context_pre148` (`20261016100000_lead_staff_roster_resident_number.sql`)은 positions를 general_worker 우선 후 `sort_order`/name 순으로 반환하지만 숫자 필드 자체는 생략한다. 이미 순위가 정해진 이 응답을 재사용한다. `sort_order`가 있는 응답은 해당 값을 사용한다. DB 조회·스키마·migration 변경 없이 구현했다.
- `list_manageable_notices` (`20261013042347_issue_446_lead_routine_notices.sql`)의 팀장 경로는 본인 생성 + 허용된 기존 대상/공지 모드만 조회한다. 운영총괄은 기존 전체 관리 경로. 서버 조건 미수정.
- 사진: 기존 Employee photo type `profile`/`id_photo`, 업무용 Storage 접근·401 갱신/재시도와 증명사진 운영총괄 직접 등록·조회 경계를 보존한다. 데이터 삭제/계정 변경 없음.

## 실행 증거

- 플랫폼 정적/계약 테스트 563 PASS, 공개 회귀 108 PASS, Netlify build PASS, JS 문법/diff 검사 PASS.
- `admin-employee-notice-browser.mjs`: Chrome PC 1440/모바일 390. 기준 main과 현재 코드 비교 캡처. 6개 옵션 존재·직책 순서·직책 경고·직원번호 내림차순·검색/상세 복귀 상태·사진 크기·미등록 증명사진 대체 금지·팀장 민감정보 축소·직원 공지관리 거부·저장 후 정확 ID 표시/수정/중복 미생성 확인.
- `issue-451-employee-profile-browser.mjs`: Chrome 320/390/768/1440, 기존 검색·필터·수정/취소/저장·Storage 401 갱신·DB/Storage/재조회 실패·입력 보존·팀장 축소·키보드/초점 회귀 PASS.
- `notice-authoring-browser.mjs`: Chrome 320/390/1280, 공지 private/routine/예약/review/게시 유지·미디어 부분 실패·응답 불확실·중복 방지·입력/첨부 보존·서버 RPC 미반영·기존 대상 보존·선택 일정 실패·성공 후 목록 확인 PASS.
- `admin-ui-browser.mjs`: 기존 가입 승인/홈페이지 UI 320/390/768/1440, 키보드/44px/실패 입력 보존/팀장 직접 편집 거부 PASS.
- CI에서 기존 홍보 작성/검토 역할별 gate와 격리 Supabase Auth/RLS/공지 권한 검증을 추가 확인한다. 실제 직원 계정이나 운영 DB에 fixture를 쓰지 않는다.

브라우저는 실제 Chrome 엔진에서 실제 JS/CSS를 실행했지만 데이터/RPC는 합성이다. 실제 로그인 계정·직원 사진/공지 원본 저장이나 휴대폰 실기 사용성을 검증했다고 주장하지 않는다. 배포 자산 재검사 결과와 CI/PR HEAD는 PR 댓글에 기록한다.

## 변경 전후 실제 캡처

모든 직원명·사진·이메일·공지 내용은 합성 검수 데이터다.

| 화면 | 변경 전(main) | 변경 후 |
| --- | --- | --- |
| 직원 정렬 PC | [before](before-employee-list-1440.png) | [after](after-employee-list-1440.png) |
| 직원 상단 사진 PC | [before](before-employee-profile-1440.png) | [after](after-employee-profile-1440.png) |
| 직원 상단 사진 모바일 | [before](before-employee-profile-390.png) | [after](after-employee-profile-390.png) |
| 공지 저장 후 PC | [before](before-notice-saved-1440.png) | [after](after-notice-saved-1440.png) |
| 공지 저장 후 모바일 | [before](before-notice-saved-390.png) | [after](after-notice-saved-390.png) |

## QA/승인 경계

- 고정 사용자 QA: https://qa-preview--taejang-homepage.netlify.app
- 시작 시 `qa-preview`는 #487 후속 HEAD `e6105d8b52f5f62657ad5b1d1aee703c7529c97a`. 현재 main은 #487을 squash 병합했으므로 이번 branch로 fast-forward 불가. 작업 흐름 §5에 따라 임의 교체하지 않는다. 검증된 PR HEAD로의 비 fast-forward 교체는 사용자 승인 대기.
- 개발용 PR Deploy Preview에서 필수 CI·exact HEAD·자산·Staging 연결을 먼저 확인한다. 고정 QA와 동일하다고 보고하지 않는다.
- 실제 기기 조작감·업무 가독성은 최종 사용자 수용 검수. main 병합/Ready 전환/Production 반영은 별도 승인.

# 관리자 UI 패턴 재사용과 스타일 소유권

기준: 2026-10-19, Issue #486, ../planning/ADMIN_UI_READABILITY_V1.md.

## 비교와 채택

| 기존 구현 / 외부 후보 | 확인 버전·라이선스 | 채택 / 보류 |
| --- | --- | --- |
| 태장 dashboard-shell.css / staff.css | 현재 main | 기존 색상·폰트·button·배지·반응형 필드 그리드 우선 재사용 |
| [Tabler](https://github.com/tabler/tabler), [실물 예제](https://preview.tabler.io/) | @tabler/core@1.6.1, MIT | 아바타 옆 이름·상태, 구분된 section surface, form action 구분 패턴. Bootstrap CSS/JS·플러그인·폰트·아이콘 패키지는 도입하지 않음 |
| [GOV.UK Summary List](https://design-system.service.gov.uk/components/summary-list/), [소스](https://github.com/alphagov/govuk-frontend/tree/main/packages/govuk-frontend/src/govuk/components/summary-list) | govuk-frontend v6.6.0, MIT | dl > div > dt/dd 구조와 key/value 행 구분·모바일 reflow를 기존 토큰에 맞춰 적용. app-summary-list는 직원 정보·가입 신청자 두 실제 사용처 |
| [AdminLTE 4](https://github.com/ColorlibHQ/AdminLTE) | v4.10.1, MIT | 카드 header/body/action 구획 비교. 전체 Bootstrap 기반 템플릿·전역 reset은 기존 shell 충돌과 배포 비용 때문에 보류 |
| [PatternFly Description List](https://www.patternfly.org/components/description-list/) | PatternFly v6.7.0, MIT | 긴 description wrapping과 좁은 화면 stacking 비교. React component / 전체 CSS bundle 도입은 보류 |

공식 저장소 최신 release와 license endpoint를 확인했다. 검토한 저장소·문서와 Tabler 실물 페이지는 유지되고 있다. 런타임 패키지를 도입하지 않으므로 새 dependency의 취약점·업데이트 의무가 추가되지 않는다. 외부 템플릿의 bundled plugin 라이선스가 본체 MIT와 동일하다고 간주하지 않는다.

직접 이식한 라이브러리·fork·복사한 icon/폰트는 없다. 기존 semantic HTML과 로컬 CSS에 검증된 구조·간격 규칙을 적용한 패턴 재사용이다. 기존 문자 아이콘·텍스트 상태 배지를 유지하며 상태를 색상만으로 구분하지 않는다.

## 화면 감사 → 수정 위치

| 화면 | 확인한 문제 / 정상 요소 | 수정 |
| --- | --- | --- |
| 직원 상세 | 구분선 없는 산개한 label/value, 긴 모바일 세로 흐름, 사진과 버튼의 분리 | 기존 dl을 summary rows로 정리, section surface·제목·헤더 간격, 사진 옆 상태와 버튼 |
| 직원 등록·현장 확인 | 일반 input width/min-height가 checkbox에 적용, label 전역 margin과 audit form 비정렬 | checkbox 분리 + 공통 check field, audit에 기존 compact grid 재사용 |
| 가입 승인 | 자체 applicant summary와 직원 summary의 서로 다른 정렬 | 동일 summary row 계약. 기존 연결/신규 생성 동작과 경고 유지 |
| 공지 | 기간·본문·첨부·미리보기 구조는 이미 정상 | 기존 check-label의 크기/줄바꿈/최소 클릭 영역만 공유. 재구성하지 않음 |
| 홍보 | 작성기·미리보기·저장 실패 보존은 정상. legacy writer 전용 스타일 호출 누락과 staff.css label margin 중첩 | 기존 전용 스타일 활성화, 기존 CSS owner의 shared reset에 operations-writer 포함, action divider·wrap·focus 공유 |
| 홈페이지 | 전용 스타일 함수가 호출되지 않아 폼 구획·간격이 누락됨 | 기존 전용 스타일 활성화 + margin reset·line-height·action row 공유. RPC·바로 반영 승인 흐름 유지 |

## 소유권과 로딩

- staff/assets/staff.css: 인증·직원 기본 UI. 전역 규칙은 변경하지 않는다.
- app/assets/dashboard-shell.css: 관리자 shell, 기존 compact field, 반복 사용하는 summary/check/action/focus 규칙. #desktop-app-shell 안으로 범위를 제한한다.
- app/assets/employee-management.css: 직원 목록/상세/사진/민감 섹션/전용 form. employee-management.js의 style 삽입을 제거하고 app/index.html에서 정적 로드한다.
- 나머지 모듈의 자체 레이아웃은 해당 모듈이 소유한다. accent theme/후처리 CSS에 이번 override를 쌓지 않는다.
- 패키지·CDN·외부 CSS 요청 추가 0. 직원 CSS는 기존 JS 내 CSS를 분리한 정적 요청 1개이며 캐시 가능하다. 스타일은 JS 실행을 기다리지 않고 로드한다.
- 불필요한 framework/adapter/component registry는 추가하지 않는다. upstream 전체 업데이트 대신 UI 담당자가 패턴과 접근성 근거를 변경 때 재검토한다.

## 검증

- tests/issue-451-employee-profile-browser.mjs: 기존 목록·검색·필터·편집·취소·저장·Storage/RPC/재조회 실패·역할 축소; 320/390/768/1440px 추가; checkbox/44px label/Space/Tab/focus 검사.
- tests/admin-ui-browser.mjs: 기존 가입 승인 fixture 재사용, 기존직원·신규 화면 캡처, 홈페이지 저장 실패 입력 보존·운영팀장 direct edit 거부. mock RPC만 사용.
- 기존 notice/promotion browser 및 10개 browser gate를 재사용. compact 승인 fixture의 이전 신규 생성 DOM 기대값만 현재 계약에 맞춤.
- screenshot은 합성 직원·합성 주소·mock Storage만 사용한다. 실제 민감정보·실직원 사진·개인계정 변경 없음.
- 실제 browser 결과·CI·압축 크기·Preview HEAD 및 미확인 항목은 PR 검증 기록을 최종 근거로 남긴다.

브라우저 gate 정합화: PASS가 script 소스에만 있어도 통과하던 판정을 rendered result node로 제한했다. 기존 Playwright를 재사용해 requestAnimationFrame·CSS transition이 실제 완료된 후 검사한다. 같은 검증에서 드러난 과거 fixture의 메뉴 owner, 정규/호환 직원 홈, Storage batch delete, 본인 작성 메뉴 및 팀장 급여 차단 기대값만 현재 main 계약에 맞췄다. 서버·실제 메뉴·권한 코드는 바꾸지 않았다.

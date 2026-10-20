# 관리자 작성·수정 UI 공통 기준

상태: 사용자 요청에 따른 구현, Draft 검증 단계. 운영총괄을 기준으로 같은 렌더러를 재사용한다. main 병합·Production 배포·고정 QA 교체는 별도 최종 승인 전 실행하지 않는다.

기준 main: `b4df2ed66e03a8ba2e00efe56b079445b78dba7c`. PR #487의 section/summary/check/action, #490의 직원사진·정렬, #491의 공지 목록/동일 ID 재조회 계약을 기준으로 조사했다. API의 PR 본문/리뷰 조회는 현재 네트워크 정책으로 차단되어 Git에 병합된 실제 변경과 문서를 읽었다.

## 단일 소유자

- `app/assets/admin-authoring.css`: 관리자 작성 폼의 공통 토큰, 카드, 라벨, 입력, 체크/라디오, 도움말/오류, 버튼, 첨부/미리보기 구획, 반응형 규칙의 소유자다.
- `dashboard-shell.css`의 첫 import로 관리자 shell에서 한 번 로드한다. standalone `app/payroll/live.html`, `handoff.html`은 같은 파일을 직접 로드한다. 프레임워크·CDN·런타임 패키지 추가 없음.
- 직원 화면의 basic/media section 색상도 이 파일의 토큰을 참조한다. `employee-management.css`는 사진·목록·민감 섹션 배치 등 직원 고유 레이아웃만 유지한다.
- 기존 JS/CSS에 흩어져 있던 일반 label/control 정의를 직원·홍보·홈페이지·가입 승인·현장조사·기존 관리 편집기에서 제거했다. 긴 본문 높이·사진 순서·미리보기 배치 등 업무 전용 규칙은 해당 모듈에 남긴다.
- 생성된 DOM을 훑어 꾸미는 observer, 역할별 새 렌더러, 범용 폼 엔진·필드 스키마·새 전송 계층은 없다. 기존 소유자가 공통 class를 명시한다.

## 새 화면에서 재사용

```html
<form class="app-authoring">
  <fieldset class="app-form-section app-form-section--basic">
    <legend>기본 설정</legend>
    <div class="app-form-grid">
      <label>게시일<input type="date" required></label>
      <label>구분<select><option>기존 업무 선택지</option></select></label>
    </div>
  </fieldset>
  <label>제목<input type="text" required></label>
  <label>본문<textarea class="app-form-body" rows="8"></textarea></label>
  <div class="form-actions">
    <button class="button button-quiet" type="button">임시 저장</button>
    <button class="button" type="submit">검토 요청</button>
  </div>
</form>
```

- `.app-authoring`: 실제 등록·수정 폼/입력 카드. 검색 필터나 조회 화면 전체에는 붙이지 않는다.
- `.app-authoring-inline`: 기존 표·업무 grid의 배치를 유지하고 입력과 버튼만 공유할 때 사용한다.
- `.app-form-section`, `--basic`, `--media`: 섹션 제목/설명/입력/첨부/상태를 담는 기존 구획에 사용한다. 색을 추가할 때 새 팔레트를 복사하지 말고 토큰을 검토한다.
- `.app-form-grid`: PC 2열, 760px 이하 1열. 기존 compact grid는 실제 카드 폭을 고려하므로 그대로 사용할 수 있다. 제목·긴 본문·주소·메모는 2열 grid 밖 또는 `.app-form-wide`에 둔다.
- `.app-form-body`: 긴 본문의 최소 높이. textarea의 고유 rows는 유지한다.
- 기존 `.form-actions`/`.quick-links`는 공통 action row를 사용한다. 기본 실행은 `.button`, 임시저장/취소/첨부는 `.button-quiet`, 위험작업은 기존 `.button-danger`를 사용한다. 액션 이름을 분석해 권한·동작을 추정하지 않는다.
- 입력은 최소 44px, checkbox/radio 22px와 44px label hit area, 동일 focus ring. required는 기존 HTML required/서버 검증을 유지하고 두꺼운 시작 테두리로 구분한다. 장식 문구로 accessible name을 바꾸지 않는다.
- 도움말 `.help`/`.field-help`, 오류 `.message.error`/`.error`를 재사용한다. 오류·필수·상태 의미는 색상만으로 전달하지 않는다. 기존 오류 메시지/ARIA live와 입력 보존은 소유자가 책임진다.
- `[hidden]`을 grid/flex가 덮지 않도록 보호한다. 권한 판단은 기존 capability/RPC/RLS/승인선 그대로이며 CSS는 권한을 부여하지 않는다.
- dialog는 기존 dialog에 `.app-authoring-dialog`, 내부 form에 `.app-authoring`을 붙인다. 직원앱·로그인·공개 홈페이지에는 전역 폼 규칙을 적용하지 않는다.

## 화면별 조사·적용 대장

표의 `공통화`는 코드상 공통 소유자에 연결했다는 뜻이다. 개별 화면의 서버 성공을 의미하지 않는다. `공유` 열은 작업 전 상태다. 첨부는 사진/파일/링크 순서, 검토는 미리보기/검토·승인 순서다. 전체 코드 검색은 `<form/input/textarea/select>`, `createElement`, DOM helper의 생성과 기존 후처리 소유자를 함께 확인했다.

| 메뉴·화면 | 작성기/소유 파일 (app/assets 기준) | 기존 공유 | 입력 유형 | 첨부 | 미리보기 / 검토·승인 | 적용 결과·예외 |
| --- | --- | --- | --- | --- | --- | --- |
| 신규 직원 등록 | employee-management.js makeEmployeeForm | compact | 이름·날짜·부서·직책·체크 | 별도 사진 패널 | 없음 / 기존 승인 | 공통화 |
| 기존 직원 수정·보완 요청 | employee-management.js + employee-management-views.js | 동일 makeEmployeeForm | 이름·입사일·부서·직책·근태 | 별도 사진 패널 | 기존 정보 / 변경 요청 | 공통화, 역할별 복사본 없음 |
| 직원 현장 확인·기본정보 교정 | employee-field-audit.js | compact 일부 | 체크·설치상태·메모·기본정보 | 사진 | 등록 후 재조회 / 없음 | 공통화, 수동 설치 확인 조건 유지 |
| 직원 상세 앱 사용 조사 | employee-management-views.js | employee form | 체크·설치·메모 | 없음 | 없음 / 없음 | 공통화 |
| 가입 승인·기존 직원 연결·신규 채용 | phase-c-account-approval.js | compact/check/summary | 승인방식·직원번호·부서·역할·사유 | 없음 | 신청자 비교 / 승인·거절 | 공통화, 숨김 신규채용/보호 확인 유지 |
| 직원 민감정보 개별 입력·교정 | employee-management.js sensitiveIdentityPanel | employee form | 주민번호·행정항목 | 없음 | 없음 / 기존 민감권한 | 공통화, 합성자료만 검증 |
| 주민번호 등록·조회 사유 | employee-management.js resident register/reveal | 일부 | 보호 입력·사유 | 없음 | 마스킹 / 기존 권한 | 공통화, 복호화·권한 불변 |
| 직원 민감정보 일괄 입력 | employee-management.js employee-sensitive-bulk | 자체 | 붙여넣기·검증결과 | 없음 | 기존 대조 / 기존 권한 | 공통화, 실제 데이터 입력 금지 |
| 직원 보험공제 관리 입력 | employee-management.js insuranceDeductionPanel | employee form | 월·on/off·숫자·사유 | 없음 | 기존 적용 정보 / 기존 권한 | 공통화, 계산·적용월 불변 |
| 직원 계정 연결·계정 상태 관리 | issue-146-end-to-end.js | 자체 카드 | 계정·상태 선택 | 없음 | 없음 / 기존 권한 | inline 공통화, 계정 동작 불변 |
| 직원 업무용/증명사진 변경 | employee-management.js / views | 기존 사진 UI | file picker·버튼 | 사진 | 기존 썸네일·상태 / 기존 승인 | 기존 UI 유지, 숨김 picker와 Storage/JWT 보호 |
| 홍보 작성·수정·보완 | phase-c-workspace-v2.js | 동일 writer | 종류·명의·날짜·제목·본문·수치 | 사진/링크 | 작성 중 미리보기 / 상신 | 공통화, 같은 역할 공유 렌더러 |
| 홍보 검토·반려·승인 입력 | phase-c-workspace-v2.js review form | 동일 form | 검토·사유 | 기존 첨부 조회 | 기존 제출본 / 단계별 승인 | 공통화, 승인선 불변 |
| 운영총괄 legacy 홍보 작성 | operations-promotion-writer.js | 자체 | 종류·제목·날짜·본문 | 사진/링크 | 기존 이미지 / 검토 요청 | 공통화, 호환 진입 유지 |
| 발행관리 기존글 직접 편집 | phase-c-publication-admin.js openChangeForm | board form | 제목·요약·본문·사유 | 기존 첨부 유지 | 기존 대조 / 기존 직접수정 권한 | 공통화 |
| 발행관리 공개글 수정 요청 | phase-c-publication-admin.js | board form | URL·전후 제목·본문·사유 | 링크 | 전후 비교 / 기존 승인 | 공통화 |
| 접수 홍보·공개자료 수정 | phase-c-ux-simplification.js | promotion form | 제목·요약·본문·분류 | 기존 첨부 유지 | 기존 비교 / 기존 승인 | 공통화 |
| 홍보 검토 화면 보완 편집 | pilot-ux-fixes.js pilot-lead-editor | 자체 | 제목·본문·링크·게시일 | 링크 | 기존 검토 / 기존 승인 | 공통화, 호환 경로 유지 |
| 공지 신규 작성 | app/index.html notice-form + notice-admin.js | compact/check | 기간·제목·본문·종류·대상·확인 | 사진/링크 | 실시간 / 기존 검토·게시 | 공통화, 사진 섹션과 기간 카드 |
| 기존 공지 수정·보완 | 동일 notice-form/notice-admin.js | 동일 editor | 기존값·기간·상태 | 사진/링크 | 동일 ID 재조회 / 검토 | 공통화, #491 저장 후 검증 보존 |
| 공지 검토 입력 | issue-207-promotion-information-ux.js | board form | 검토·보완·사유 | 기존 사진 조회 | 기존 미리보기 / 승인 | 공통화 |
| 업무 배정·수정 | app/index.html task-form + app.js | form-grid | 날짜·시간·대상·장소·상태·본문 | 작업방법 연결 | 기존 조회 / 기존 권한 | 공통화, ID·필드 순서 보존 |
| 업무 정보 작성·수정 | app/index.html information-form + app.js | form-grid | 종류·시간·대상·내용·사유 | 연결자료 | 기존 조회 / 기존 권한 | 공통화 |
| 작업방법 작성·수정 | app/index.html guide-form + work-guide-admin.js | form-grid | 부서·분류·절차·설명·상태 | 사진 URL/링크 | 직원 화면 미리보기 / 기존 권한 | 공통화 |
| 작업순서 단계 등록·수정 | app/index.html guide-step-form + work-guide-admin.js | form-grid | 순서·제목·설명·사유 | 사진 URL | 직원 화면 미리보기 / 기존 권한 | 공통화 |
| 근무·업무 일정 작성·수정 | app/index.html schedule-form + schedule-admin.js | form-grid | 시작/종료·대상·차량·내용 | 연결자료 | 직원 미리보기 / 기존 권한 | 공통화, 업무상 날짜 순서 유지 |
| 업무 안내 작성·수정 | app/index.html guidance-form + guidance-admin.js | form-grid | 분류·제목·안내·대상·기간 | 링크 | 직원 미리보기 / 기존 권한 | 공통화 |
| 거래처 월별 문서 공통 입력 | monthly-client-documents.js | 자체 mcd grid | 연월·숫자·문구·추가항목 | 기존 문서 | 기존 생성/확정 / 기존 권한 | 공통화, snapshot·생성 흐름 유지 |
| 거래처별 snapshot·기본값 | monthly-client-documents.js | mcd grid | 체크·회사값·대상·문구 | 기존 문서 | 기존 출력선택 / 기존 확정 | 공통화 |
| 거래처 메일 초안 | monthly-client-documents.js mcd-email-dialog | 자체 dialog | 제목·본문·첨부안내 체크 | 첨부 예정 목록 | 기존 초안 / 복사 | dialog 공통화, dirty 초안 보존 |
| 홈페이지 직접 수정 | operations-homepage-direct.js | 자체 form | 콘텐츠 종류·URL·제목·본문 | 사진/링크 | 기존 렌더 / 기존 즉시반영 권한 | 공통화 |
| 홈페이지 글·사진 수정 요청 | homepage-change-requests.js | promotion form | 대상·제목·내용·사유 | 사진/파일/링크 | 기존 비교 / 기존 승인 | 공통화 |
| 홈페이지 변경 대조·승인 | issue-146-end-to-end.js issue146-form | 자체 form | 변경값·사유·체크 | 기존 요청자료 | 전후 비교 / 승인·보완 | 공통화 |
| 근태 시간 보정·무효 요청 | attendance-integrity-ui.js | 자체 dialog | 시분·날짜·사유 | 기존 근거 | 원본 안내 / 기존 권한 | dialog 공통화, append-only 보정 보존 |
| 일일 근태 상태·미연결 계정 처리 | attendance-admin.js | 자체 inline | 상태·계정 선택 | 없음 | 기존 상태 / 기존 확인 | inline 공통화, 조회 표 배치 유지 |
| 급여용 근태 표 직접 편집 | payroll-attendance-editor.js + payroll/live.html | 자체 표 편집 | 상태·시각·인정시간 | Excel 별도 | 기존 확정 / 기존 권한 | inline 공통화, 표·스크롤은 업무상 예외 유지 |
| 급여 초안 검토·상신·결정 메모 | payroll-draft-handoff.js + payroll/handoff.html | 자체 카드 | 검토 메모·결정 | 기존 초안 | 기존 검토 / 단계별 승인 | 공통화, 계산·급여 데이터 계약 불변 |
| 지원사업 기업 프로필 등록·수정 | support-radar.js | radar form | 회사·체크·지점·자격·혜택·사유 | 근거/URL | 버전 요약 / 새 버전 저장 | 공통화 |
| 지원 공고 등록·수정 | support-radar-notices.js | radar form | 공고·기간·요건·URL | 링크/근거 | 기존 상세 / 기존 권한 | 공통화 |
| 지원 정보원 등록 | support-radar-notices.js | 자체 section form | 코드·기관·URL | 링크 | 없음 / 기존 권한 | 공통화 |
| 지원사업 담당자 배정·진행 | support-radar-assignment.js | radar grid | 담당자·상태·메모 | 기존 자료 | 진행 요약 / 기존 권한 | inline 공통화 |
| 지원사업 검토·판단 | support-radar-review.js | radar grid | 판단·사유 | 기존 자료 | 기존 평가 / 검토 | inline 공통화 |
| 지원사업 내 업무·신청 진행 | support-radar-my-work.js | radar grid | 진행상태·메모 | 기존 자료 | 진행 요약 / 기존 권한 | inline 공통화 |
| 지원사업 결과 기록 | support-radar-result-record.js | radar grid | 결과·금액·날짜·메모 | 기존 근거 | 기존 기록 / 기존 권한 | inline 공통화 |
| 지원사업 우선표시 관리 | support-radar-alerts.js | radar grid/check | 체크·사유 | 없음 | 기존 표시 / 기존 권한 | inline 공통화 |
| 플랫폼 메뉴·화면·공개 설정 | platform-ui-settings.js | settings card | 역할선택·체크·사유 | 없음 | 기존 설정 / 기존 capability | 공통화, sidebar 변경 코드 불변 |
| 조회용 검색·월 선택·필터 | notice-list-filters, employee-filters, attendance/payroll toolbar 등 | 기존 | 검색·기간·필터 | 없음 | 조회만 | 예외 유지 — 작성 UI가 아님 |
| 역할 체험·직원 화면 전환 | phase-c-role-simulation.js, issue-221-employee-screen-switcher.js | 기존 dialog | 체험 계정 선택 | 없음 | QA 체험 | 예외 유지 — 계정·업무정보 작성 화면 아님 |
| 보관·복구·영구삭제 확인 | operations-delete-controls.js 및 각 owner | 기존 confirmation | 브라우저 confirm/prompt | 없음 | 기존 위험 확인 | 예외 유지 — 브라우저 native 확인, 승인 경계 보존 |
| 급여 Excel 선택·조회·내보내기·명세서 | payroll operator/preview/payslip | 기존 전문 흐름 | 파일선택/월 필터 | Excel | 기존 출력 | 기존 UI 유지 — 일반 작성 폼 아님, 실제 편집 cells·메모만 공통화 |
| 지원 프로필 보강·보고서 후처리 | support-radar-profile-polish.js / report.js | 기존 owner 위 보강 | 기존 form의 도움말 | 기존 자료 | 기존 보고 | 기존 UI 유지 — 새 작성기 없음, 상위 form 공통화가 전파됨 |
| 홍보 링크/UX 후처리 | issue-181/187, ux-followup-polish.js | 기존 writer 위 보강 | 기존 form 선택·링크 | 기존 첨부 | 기존 미리보기 | 기존 UI 유지 — 동일 작성기 재사용, 복제하지 않음 |
| 직원앱 일반 화면·공개 홈페이지·로그인 | staff, mobile, public | 별도 목적 | 이용자 입력 | 기존 | 기존 | 의도적으로 제외 — 관리자 작성 UI 범위 밖 |

## 검증 경계

- `tests/admin-authoring-browser.mjs`: 실제 HTML 폼 7개와 직원등록·가입승인·홍보작성·지원 프로필 렌더러, 1440/768/390/320px, 44px 입력/22px checkbox/공통 radius 토큰 변경 전파/hidden 보존/가로 넘침. 기존 10개 기능 gate를 PC·모바일 HTTP로 실행한다. 지원 프로필 저장 실패의 원문 보존을 직접 확인한다.
- 기존 `admin-ui-browser.mjs`: 홈페이지 저장 실패 입력 보존, 권한 없는 direct edit 거부, 가입승인 입력과 keyboard. 기존 notice/promotion/employee 테스트의 저장·첨부·미리보기·승인·동일 ID 재조회 검증을 그대로 실행한다.
- mock 데이터를 쓰는 browser/단위검사와 실제 서버 검증을 구분한다. 공통화 연결은 모든 위 대상에서 확인했지만 모든 업무 경로의 실제 서버 쓰기를 수행하지 않는다.
- 추가 조치 필요: 원격 CI와 exact-head 통합 Deploy Preview 검증. 네트워크의 GitHub API·Netlify 접근이 복구된 뒤 Draft PR/실배포 SHA를 대조한다. 실제 직원·급여·운영공지 변경으로 검증하지 않는다.

# Goal #376 — 역할별 최소 모바일 기능

## 확정 범위

- 모든 활성 직원은 기존 서버 계약으로 출퇴근, 오늘 할 일, 공지, 가까운 일정, 설정의 내 정보를 사용한다.
- `promotion.write`를 서버 access context가 선언한 경우에만 홈의 홍보 작성 진입점을 보인다.
- 홍보 작성자는 기존 guarded RPC로 초안 작성·저장·상신·보완 의견 확인·수정·재상신을 한다.
- 모바일은 capability를 UX 노출 기준으로만 사용한다. 홍보 workspace/read/save/submit 권한은 서버 RPC가 최종 판정한다.

## 의도적으로 Web에 남기는 범위

- 직원 전체관리, 급여 계산·관리, 홈페이지 CMS, 전체 홍보 관리·승인선, 권한관리, 회계, 복잡한 관리자 대시보드.
- 관리 역할의 일반적인 업무 진입은 기존 opaque handoff를 통한 Web 업무플랫폼을 유지한다. 이 Goal에서 모바일 관리자 ERP 화면을 만들지 않는다.

## 최신 scope override

- 모바일 급여명세는 Goal #374가 `not_planned`이므로 이 1.0 baseline과 이 Goal의 일반직원 목록에서 제외한다.

### 2026-10-07 — 0.1.2 Galaxy Human QA 홈 단순화 (사용자 확정)

- 기존 홈의 오늘 할 일 / 내 일정 / 홍보 작성 shortcut 노출을 변경한다. 일반 직원 홈은 출퇴근 → 공지, 업무 플랫폼 권한자는 출퇴근 → 공지 → 업무 플랫폼만 표시한다. 공통으로 공식 채널과 우상단 설정을 유지한다.
- 기능 자체와 route/API/RPC/재사용 가능한 컴포넌트는 보존한다. 홈에서 세 shortcut을 마운트하지 않아 해당 조회와 foreground refresh가 실행되지 않게 한다.
- 업무 플랫폼 노출은 기존 employee feature registry 및 서버 access context의 capability를 재사용한다. 역할 literal이나 신규 서버 계약을 도입하지 않는다. main에 아직 없는 #338의 `work_platform_available` 계약은 이 UI 작업에 이식하지 않는다.
- 세 기존 이미지를 직접 비교한 후 사용자가 `泰張 / TAEJANG` 앱 아이콘 그림을 선택했다. `mobile/assets/taejang-launcher-icon.png`를 native splash와 초기 연결/계정 조회 로딩에 동일하게 사용한다. 별도 태장 텍스트·설명·spinner·animation을 추가하지 않는다. 오류와 재시도 화면은 유지한다.
- 설정 재설계, 급여명세, DB 변경, Play 업로드, Production 변경은 제외한다. versionName/code는 이 UI PR에서 변경하지 않고 승인된 다음 release candidate 준비 단계에서 증가시킨다. 이미 사용된 versionCode 3는 새 binary로 덮어쓸 수 없다.
- 구현 대조: 홈 구성·shortcut 미마운트·기능 보존·기존 capability·로고 로딩은 구현 완료. 설정 재설계/급여명세/서버 변경은 의도적으로 제외. Galaxy cold start 및 OS → JS 전환의 실제 느낌은 다음 Human QA에서 확인한다.

## 완료 대조

| 항목 | 상태 |
| --- | --- |
| 일반직원 최소 직원 기능 | 기존 구현 재확인 |
| 홍보 작성·임시저장·상신·보완·수정·재상신 | 기존 guarded workflow 재사용 |
| role literal 모바일 권한 판정 제거 | 구현 |
| capability SoT + server authorization 유지 | 구현 |
| 관리자 ERP 복제 방지 | 의도적으로 제외 |

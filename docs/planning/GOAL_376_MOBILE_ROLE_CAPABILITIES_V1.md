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

## 완료 대조

| 항목 | 상태 |
| --- | --- |
| 일반직원 최소 직원 기능 | 기존 구현 재확인 |
| 홍보 작성·임시저장·상신·보완·수정·재상신 | 기존 guarded workflow 재사용 |
| role literal 모바일 권한 판정 제거 | 구현 |
| capability SoT + server authorization 유지 | 구현 |
| 관리자 ERP 복제 방지 | 의도적으로 제외 |

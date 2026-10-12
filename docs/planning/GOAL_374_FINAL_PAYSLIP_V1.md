# Goal #374 — 확정 급여명세 모바일 조회 v1

상태: **구현 완료**. 분류: **태장 Domain** (기존 payroll ledger 재사용, 공통화 보류).

- **구현 완료:** 월별 목록·지급액·공제액·실수령액·세부 공제항목을 `payroll_confirmed_deduction_history`의 `payroll_ledger_confirmed` / `as_paid` 확정 사실만으로 read-only 표시한다.
- **구현 완료:** 서버는 active profile의 연결된 active Employee를 직접 확인하고, browser direct table read·anon access·`payroll.manage` 확대를 허용하지 않는다.
- **의도적으로 제외:** draft/payroll result/calculation/payment/filing/canonical HR mutation, PDF 생성, 급여 금액 push·lock-screen 노출.
- **Deferred Human Gate:** 이 forward-only DB migration의 Production apply, 실제 급여 데이터 E2E, Android screen-capture/lock-screen Human QA, signed AAB/Play 배포.

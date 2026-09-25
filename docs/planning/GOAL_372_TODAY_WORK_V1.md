# Goal #372 — 오늘 할 일 기록

상태: 구현 완료 / 실제 직원 UX는 별도 Human Gate

## 기준

- GitHub Goal #372
- `docs/planning/GENERAL_WORKER_INFORMATION_BOARD_V1.md`
- `docs/operations/MOBILE_APP_DEVELOPMENT_STANDARD.md`

## 구현

- 홈 순서를 출퇴근 → 오늘 할 일 → 공지 → eligible 업무플랫폼으로 한다.
- 기존 서버 `get_my_today_board()`에서 본인에게 이미 범위가 정해진 published 업무만 읽는다.
- 홈에는 첫 업무와 총 건수를, 상세에는 시간 순서·장소·담당·준비물·주의사항만 표시한다.
- 완료, 진행률, 실적, 시작 처리, 자유 입력이나 프로젝트관리 상태는 만들지 않는다.
- foreground 복귀 시 서버 읽기 모델을 다시 조회한다.

## Deferred Human Gate

- 실제 Galaxy에서 작은 화면·글자 확대·느린 네트워크와 일반 직원의 5초 이해 가능성을 확인한다.
- Production DB/RLS/실제 업무 배정 데이터에는 변경·실행하지 않는다.

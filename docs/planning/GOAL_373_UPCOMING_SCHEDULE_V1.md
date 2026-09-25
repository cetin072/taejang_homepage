# Goal #373 — 직원 내 일정 v1

상태: **구현 완료**

확정 기획 기준: `docs/planning/GENERAL_WORKER_INFORMATION_BOARD_V1.md` §8, §12.

## 구현 대조

- **가까운 일정 우선:** 서버 `get_my_schedule_list()`의 KST 기본 시작일과 시간순 결과를 그대로 사용한다.
- **일정 범위:** 교육, 외부활동, 휴무, 근무, 장소 변경, 특별 일정, 차량 이동과 기타 일정의 서버 유형을 쉬운 한국어로 표시한다. 건강검진은 서버 일정 제목을 보존해 표시한다.
- **개인 대상·공개 상태:** 서버 RPC가 active profile의 대상 범위와 `published`/`cancelled` 상태를 최종 필터링한다. 모바일은 별도 대상·권한 판단을 하지 않는다.
- **읽기 전용:** 목록·상세·홈 요약은 RPC 읽기만 사용하며 일정 편집, 월간 캘린더, 출석/업무 mutation을 만들지 않는다.
- **deep link:** `target: schedule`/`scheduleId` push payload와 목록 모두 guarded schedule 상세로 연결한다.
- **쉬운 UX/accessibility:** 큰 카드·큰 터치 영역, 짧은 일정 안내, 취소/변경 상태, foreground refresh와 오류 재시도를 제공한다.

## 의도적으로 제외

- 월간 캘린더, 일정 생성·수정·삭제, 관리자 ERP, 클라이언트 날짜/대상 권한 판정.
- 실제 device push/알림 권한 Human QA는 release hardening에서 별도 검수한다.

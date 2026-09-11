# Issue #181 범위 메모

이 브랜치는 직원 실사용 피드백에 따른 홍보·근태 회귀 안정화만 다룬다.

포함:
- 홍보팀장 관리 화면/사이드바 통합
- 미발행 홍보글 recoverable delete UX
- 외부 링크 자동 가져오기 단일 요청 + 수동 fallback
- 모바일 GPS 위치 취득 안정화
- 관련 회귀 테스트

제외:
- 급여
- 지원사업 레이더
- 신규 공통 Auth/RLS/Employee 계약
- destructive DB migration
- Production 수동 배포

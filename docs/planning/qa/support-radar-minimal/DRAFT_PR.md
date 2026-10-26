공고 탐색보다 프로필·점수·후처리 패널이 앞서던 지원사업 화면을 목록 중심으로 정리합니다. 검색·판단·마감 필터와 복귀 상태를 유지하고 기존 평가·검토·배정·신청 데이터는 보존합니다. 공통 관리자 UI와 명시적 section/surface를 재사용합니다.

기업마당 공식 JSON의 작은 read-only 수집기와 격리 중복/메모 보존 계약 검사를 추가합니다. 키가 없어 실제 API 인증은 미검증이고 운영 DB 반영·관심 저장은 아직 연결하지 않았습니다. 관심을 기존 신청으로 바꾸지 않았으며 최소 추가 계약을 기획 문서에 남겼습니다.

검증: platform-static 602, staging-safety 16, 지원사업 51 PASS. 모의 RPC 브라우저 1440/768/390/320px PASS. 운영 DB 쓰기·migration·자동화·비밀 설정·Production 변경 없음. 실제 연결·DB/서버 역할 검수·Preview 대조는 미실행입니다. 상세 범위와 제한은 docs/planning/SUPPORT_RADAR_MINIMAL_REBUILD_20261026.md 및 QA_REPORT.md를 참조하세요.

Draft로 유지합니다. #175/#189 현재 상태를 GitHub 접근 복구 후 대조해야 하며, 이를 통째로 병합하지 않았습니다.

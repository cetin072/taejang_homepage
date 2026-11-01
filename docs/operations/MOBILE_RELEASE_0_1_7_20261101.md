# 태장 직원앱 0.1.7 / code 8 — Alpha 업데이트

기준일: 2026-11-01 KST. 사용자 승인 범위: 출시 준비·버전 변경·검증·PR 병합·기존 서명 AAB 빌드·기존 Play 테스트 트랙 심사 제출. 게시와 실기기 검증은 실제 확인된 결과만 후속 PR 댓글에 기록한다.

- 기준 main: `0b9adf394e95a719eeed7d2f5bc07885c5bca9ed` (#557 병합).
- 기능 소스: #556 공지 하늘색 영역·흰색 개별 카드·홈 카드 모양과 간격 통일, #557 설정의 오프라인 패치노트. 기능 구현은 그대로 보존한다.
- 2026-11-01 Play 직접 확인: 전체 등록 번들 7개(code 1~7), 최고 `0.1.6/code 7`이 Closed Testing Alpha 전체 출시로 테스터에게 제공 중. 미게시 변경사항 없음. 공개/내부 테스트 미시작, Production 접근 미허용. 다음 후보 `0.1.7/code 8`; 업로드 직전 중복 재확인.
- 최소 변경: app/package/lock 루트 버전과 기존 버전 검사만 동기화. 신규 SDK·권한·키·DB·직원 데이터·Netlify 설정 변경 없음.
- 기존 `.github/workflows/mobile-app.yml`에 정확한 병합 main으로 `build_play_aab=true` 수동 실행. 기존 `ANDROID_UPLOAD_*` 사용, QA APK 제출 금지.
- AAB 검증: 정식 package `com.cetin072.taejang.staff`, 0.1.7/code8, 기존 업로드 인증서, ARM64, 권한·background location 부재, 파일 SHA256 기록.
- 기존 Alpha 테스터·국가·검토 계정·서명 설정 보존. Production 공개 전환 및 일반 직원 Push 확대 금지.
- 설치 가능 확인 전 업데이트 안내 변경 금지. 확인 후 기존 선택 업데이트 정책만 사용하며 force/minimum은 올리지 않는다.
- Galaxy 무삭제 업데이트·세션·근태 기록·공지·패치노트·알림 실기기 검증은 미실행 상태로 시작한다.

## Play 출시 노트

- 공지사항을 밝은 카드로 정리해 읽기 쉽게 개선했습니다.
- 홈 화면 카드의 모양과 간격을 통일했습니다.
- 설정에서 패치노트와 이전 변경 내역을 확인할 수 있습니다.

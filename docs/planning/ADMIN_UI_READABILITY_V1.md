# 관리자 UI 가독성 개선 v1

상태: 확정 — 2026-10-19 사용자 실행 지시, [Issue #486](https://github.com/cetin072/taejang_homepage/issues/486).
분류: 기존 태장 관리자 화면 유지. 실제 직원·가입 승인에서 반복 확인한 요약 목록과 체크박스만 기존 Shared UI CSS에서 공유한다.

## 범위와 보존 계약

- 직원 상세를 먼저 검증하고 등록·가입 승인·공지·홍보 작성·홈페이지 관리의 반복 시각 문제를 묶어 개선한다.
- 운영총괄을 기준 UI로 삼되 운영팀장·홍보직원·일반직원 권한, capability, RLS, RPC, 공개·승인선은 바꾸지 않는다.
- 기존 HTML/CSS/vanilla JS, 정상 메뉴와 작성 흐름, 기존 상태 배지, 사진 저장·재조회·오류 경계를 유지한다.
- 기존 스타일 소유자를 확인하고 직원 전용 CSS를 단일 정적 파일로 옮긴다. 같은 화면에 후순위 override를 반복해서 추가하지 않는다.
- Tabler, GOV.UK, AdminLTE 4, PatternFly를 비교하고 라이선스·의존성·CSS 충돌·로딩 비용을 기록한다.
- 새 프레임워크·관리자 템플릿 전체 도입·유료 서비스·DB 변경은 이번 범위에서 제외한다.
- Draft PR과 QA Preview에서 사용자 확인을 받는다. main 병합·Ready 전환·Production 배포는 하지 않는다.

## 화면 기준

- 직원 상세: 항목명과 값을 연결하는 구분선 있는 요약 행, 일관된 섹션 제목·간격, 사진과 상태·변경 버튼의 인접 배치.
- 직원 등록·현장 확인: 일반 input과 checkbox 규칙 분리, 22px 체크박스와 최소 44px 클릭 영역, 예측 가능한 키보드 순서와 초점 표시.
- 가입 승인: 기존 직원 연결 기본값과 신규 채용 분리를 유지하며 신청자 요약 목록과 선택 필드 간격 정리.
- 공지·홍보·홈페이지: 이미 정상인 작성 구조와 미리보기를 유지. 실제 반복된 label margin, 보조 설명, action row 경계와 줄바꿈만 정리.
- 320/390/768/1440px에서 긴 이름·이메일·한국어 문장을 포함해 가로 overflow·겹침 검사.

## 완료 대조

| 확정 항목 | 결과 | 근거 |
| --- | --- | --- |
| 기존 코드·오픈소스 우선 | 구현 완료 | ../operations/ADMIN_UI_PATTERN_REUSE.md |
| 직원 상세·등록 개선 | 구현 완료 | employee-management.css, 기존 views/controller 재사용 |
| 가입 승인·작성기 일관성 | 구현 완료 | dashboard-shell.css 공통 규칙, 신청자 dl 재사용 |
| 권한·데이터 계약 보존 | 구현 완료 | 기존 역할 회귀 + homepage 권한 없는 진입 검사; DB 코드 미변경 |
| PC·모바일·키보드·기능 회귀 | 구현 완료 | 기존 직원/공지/홍보 gate, admin-ui-browser.mjs |
| 변경 전후 캡처 | 구현 완료 | 합성 데이터 캡처, PR 검증 기록에서 경로·결과 연결 |
| Draft PR·고정 QA | 검증 진행 | 최신 HEAD CI·배포 일치 후 보고. 다른 QA 점유 시 임의 교체 금지 |
| 실제 직원 정보·실기기 사용감 | 미구현·후속 사람 검수 | 실제 업무 계정 변경·실직원 화면 캡처는 자동 검수에 사용하지 않음 |

브라우저 gate 정합화: PASS가 script 소스에만 있어도 통과하던 판정을 rendered result node로 제한했다. 기존 Playwright를 재사용해 requestAnimationFrame·CSS transition이 실제 완료된 후 검사한다. 같은 검증에서 드러난 과거 fixture의 메뉴 owner, 정규/호환 직원 홈, Storage batch delete, 본인 작성 메뉴 및 팀장 급여 차단 기대값만 현재 main 계약에 맞췄다. 서버·실제 메뉴·권한 코드는 바꾸지 않았다.

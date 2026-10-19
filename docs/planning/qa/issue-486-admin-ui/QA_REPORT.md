# Issue #486 관리자 UI 검증 기록

기준 main: `abc079f2a0bc5101352120905669123e532337ce`  
브랜치: `codex/admin-ui-existing-patterns`  
범위: [확정 기획](../../ADMIN_UI_READABILITY_V1.md), [재사용 비교·소유권](../../../operations/ADMIN_UI_PATTERN_REUSE.md).

## 로컬 확인

| 항목 | 결과 |
| --- | --- |
| 플랫폼 정적 검사 | 561/561 PASS |
| 공개 홈페이지 회귀 | 51/51 PASS |
| 급여 회귀 | 517/517 PASS |
| build:netlify / diff --check | PASS |
| 직원 목록·상세·등록 | 320/390/768/1440px PASS |
| 직원 기존 검색·필터·목록 복귀 초점·수정/취소/저장·사진 실패/재조회 | PASS, 기존 합성 browser suite 재사용 |
| 체크박스 Space, Tab 순서, 보이는 focus, 44px label | PASS |
| 가입 승인·홈페이지 | 320/390/768/1440px PASS |
| 홈페이지 실패 시 입력 보존·운영팀장 직접 편집 진입 거부 | PASS, mock RPC |
| 공지 작성기 | 320/390/1280px PASS |
| 홍보 작성기 | 320/390/768/1440px PASS |
| 기존 10개 browser gate × PC/모바일 | 20/20 PASS, 실제 완료 노드 기준 |
| 수동 이미지 검토 | 직원 PC·모바일·사진/현장 확인, 가입 승인 버튼 영역, 홈페이지 모바일 확인 |

검증은 합성 직원·합성 이메일·mock RPC/Storage로 실행했다. 운영 DB, 실제 계정·직원·주민번호·사진·승인선은 변경하지 않았다. 실제 Storage 업로드나 실직원 민감정보 조회 검증으로 기록하지 않는다.

## 변경 전후 캡처

| 화면 | main 변경 전 | 변경 후 |
| --- | --- | --- |
| 직원 PC | [캡처](before-pc-profile.png) | [캡처](after-pc-profile.png) |
| 직원 모바일 | [캡처](before-mobile-profile.png) | [캡처](after-mobile-profile.png) |
| 가입 승인 PC | [캡처](before-approval-existing-1440.png) | [캡처](after-approval-existing-1440.png) |
| 홈페이지 링크 모바일 | [캡처](before-homepage-link-390.png) | [캡처](after-homepage-link-390.png) |

[직원 사진·현장 확인 PC](after-pc-photos-and-audit.png), [가입 승인 버튼 정렬 PC](after-approval-actions-1440.png).

직원 모바일 기본 캡처 높이는 3593→3062px다. 정보·기능 삭제 없이 항목/값 정렬·사진 배치·간격을 정리한 결과다. 실제 직원별 길이·권한에 따라 높이는 달라진다.

## 성능·변경 경계

- 새 runtime dependency, CDN, 외부 CSS/아이콘/폰트 요청 0.
- 직원 JS gzip 13,875→12,219B, shell CSS 4,626→5,143B, 분리한 직원 CSS 1,946B. 세 파일 합계 gzip +807B, 캐시 가능한 정적 CSS 요청 +1. 실제 네트워크 성능 수치와 동일시하지 않는다.
- 일반 input의 폭·높이가 checkbox를 덮지 않도록 분리했다. 전용 스타일 소유권은 employee-management.css 하나이며 공유 summary/check/action은 기존 dashboard-shell.css에 둔다.
- 홈페이지/운영총괄 홍보 writer에서 정의만 된 기존 전용 style 함수를 화면 준비 때 호출하도록 복구했다.
- 서버 RPC·역할 판정·데이터 모델·RLS·Netlify 설정·Production release marker 변경 0.
- gate 보강 중 드러난 예전 fixture의 계약 불일치는 테스트에서만 정리했다. PASS literal을 script에서 찾지 않고 실제 result node를 검사하는 회귀 2개 추가. 실제 프레임/CSS 전환과 스크롤 오프셋을 고려한다.

## 배포와 남은 확인

- Draft PR 생성 후 exact HEAD의 CI·Netlify Ready·실제 자산 일치·Preview 자산을 이용한 합성 browser 결과는 PR에 이어 기록한다.
- 고정 QA는 별도 #477/#479 검수 브랜치가 점유 중이다. 현재 확인 SHA `ba89f3d3263254d051f4c0f447a933c6793e457a`. 동시 작업 보호·비 fast-forward 교체 규칙에 따라 임의 덮어쓰기하지 않는다.
- 고정 QA 주소 갱신은 승인된 대상/일정 확인 후 진행한다. 개발용 Deploy Preview를 고정 QA 완료로 부르지 않는다.
- 실제 휴대폰 조작감·실직원 업무 가독성·보조기술 사용감은 사람 확인으로 남긴다.
- main 병합, Ready 전환, Production 배포는 진행하지 않는다.

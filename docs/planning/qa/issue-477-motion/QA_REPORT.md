# 직원앱 랜딩 모션 QA — 2026-10-17

구현 Draft [#479](https://github.com/cetin072/taejang_homepage/pull/479), 원본 보존 Draft [#478](https://github.com/cetin072/taejang_homepage/pull/478). 실행 코드 검증 기준 `7c05b0eae62dfe6d4cb554ed89f2b78848554d27`. 이 기록과 선정 캡처를 추가한 문서 커밋의 정확한 최종 HEAD/CI/배포 확인은 PR 댓글에 남긴다.

## 구현과 요구 대조

| 요구 | 결과 / 증거 |
| --- | --- |
| 승인 HERO V2.1 통합 | 구현. #478의 render 함수 byte-identical 비교, 5200ms 종료와 체크 경로 실브라우저 확인. 로컬 최종 프레임 캡처 |
| Before/After 카드 180도 1회 | 구현. 3200ms 읽기 hold, 1000ms 회전, 후면 무기한 정지. 전후 외곽 좌표 일치, 종료 후 애니메이션 객체 0. 키보드 replay/정적 비교 |
| 다른 섹션 조화 | 기능 설명·SVG 보존, 기능 카드 박스/점선/부유 효과 정리, 모바일 아이콘+문장 행. 접근성 예시 정적 유지, 큰 그림자 제거. 이용 안내/연락·정책 링크 유지 |
| 정직한 앱 사실관계 | 두 날짜·여섯 원문 보존. After는 개선 방향, 배포 완료를 뜻하지 않는다고 명시. #459 및 현재 모바일 소스 확인, 실제 배포 상태는 미확인 |
| PC·모바일 | Chrome 1440/1120/1001/768/720/390/360/320px 정적 회귀. 1440/390/320px에서는 실제 HERO·두 카드 재생/중간/종료·동적 모션 감소까지 검사 |
| 접근성 | JS off 320px, controller 파일 로드 차단 1440/390px 정적 보존, reduced-motion 최초/실시간 변경, keyboard, 접근성 트리 Before/After 텍스트, 프린트 이벤트 fixture. 200% 글자 및 720/360px reflow 대리 검사 |
| 테스트 | 공개 회귀 51 PASS, 플랫폼 정적 559 PASS, 랜딩 정적 3 PASS, build PASS, diff/JS 문법 PASS. 기존 홈페이지 메뉴·직원 로그인 안내 fixture 회귀 PASS |
| CI 오류 | 과거 타임아웃 원인 미확정으로 기록. 현재 제품 중심 readiness + 전체 요청 trace + 지연 iframe/CSS 경계 fixture 검증. 아래 Gate 상태 참조 |
| Preview | 개발 Preview 생성, 실제 브라우저 clean URL 확인, Netlify 배포 SHA 대조. 고정 사용자 QA는 미갱신 |
| 레시피 | [V1](../../../operations/WEB_MOTION_RECIPE_V1.md). 검증된 범위와 남은 사용자 수용을 구분. 범용 프레임워크 없음 |

## 화면과 디자인 검토

[PC 전체](desktop.png) · [모바일 전체](mobile.png) · [모바일 회전 중](card-turning.png).

전체 캡처는 두 내용을 함께 보기로 펼친 상태다. 자동 재생 기본에서는 한 카드의 앞뒤가 같은 자리에서 바뀐다. PC·모바일의 시작/진행/최종 화면을 직접 확인했다. HERO가 중심이고 하단 기능은 조용한 목록으로 읽힌다. 회전은 별도의 장식 레이어가 아니라 동일 내용 영역의 비교에만 쓴다. 모바일 기능 소개의 높이를 줄이고, 기준 문장은 회전 밖에 고정해 앞뒤를 읽는 동안 맥락이 유지된다.

기술 검사 외의 한계: 뒷면을 본 뒤 다시 앞면을 보고 싶을 때는 ‘두 내용 함께 보기’가 가장 명확하다. 이 접근은 후면을 보이는 종료 화면만으로 이전 불편을 다시 알 수 없는 한계를 보완한다. 실제 장애인 직원의 이해도·편안한 읽기 속도는 아직 평가하지 않았다. ‘전문가 품질 인증’이나 사용자 최종 수용 완료로 표현하지 않는다.

## 로컬 성능 표본

동일 Chrome headless, 각 1440/390px, 각 원본 main HTML/CSS와 새 빌드, 초기 로드+약 6초. [원시 측정](performance.json). 원본은 Playwright route로 main HTML/CSS만 대체, 나머지 공유 자산은 동일하다. 단일 표본이며 네트워크 캐시·시스템 부하 영향을 포함한다.

| 폭 | 원본 CLS | 구현 CLS | 원본/구현 rAF p95 |
| --- | --- | --- | --- |
| 1440 | 0.00102 | 0.00105 | 16.8 / 16.8ms |
| 390 | 0.02251 | 0.02260 | 16.8 / 16.8ms |

- 전용 CSS 9,720 → 11,854 bytes, 새 로컬 JS 6,764 bytes(압축 전). 새 외부 라이브러리·이미지·폰트·요청 없음.
- 초기 50ms 초과 작업은 원본 104/140ms, 구현 150/166ms 1개씩 관찰. 앱 JS만의 실행시간으로 분리한 수치가 아니며 개선이라고 주장하지 않는다.
- 총 383–392 rAF 표본, 50ms 초과 간격 1–2개. 실제 모바일 FPS·CPU throttle·배터리 검증이 아니다. 렌더링 종료 상태 확인.
- 처음 측정에서 HERO 제어 등장 공간으로 CLS가 늘어 컨트롤 슬롯 확보로 수정했다. 원본과 다른 최초 표본(모바일 0.49)은 폰트/캐시 등 부하가 달라 성능 개선 근거로 사용하지 않았다.

## 실패를 숨기지 않은 수정 기록

1. 최초 로컬 build·공개 회귀는 sandbox의 dist 삭제/임시 Git fixture 권한으로 실패. 대상이 저장소 dist임을 확인한 정상 권한 실행에서 build·51개 회귀 통과.
2. 로딩 추적기의 이전 문서 취소 요청이 다음 탐색에 남아 실패. 탐색마다 tracker를 초기화. 선택적 로컬 Functions 404 fallback과 핵심 CSS/폰트/이미지 실패를 구분.
3. 최초 PR HEAD `08a60678` UAR/플랫폼 CI는 helper 실행 경로 미등록으로 실패. 기존 workflow가 실행하는 부모와 실제 import를 명시적으로 연결한 coverage 검사로 보강. 559개 정적 PASS. 테스트 제외나 CI gate 삭제 없음.
4. 모션 감소 검증에서 emulateMedia 응답 직후 change 이벤트 도착 전 값을 읽어 실패. 실제 이벤트에 따라 최종 프레임이 되는지 1초 한도로 기다리는 조건으로 수정했다. 제품 지연을 무한 대기하지 않는다.
5. 회전 easing을 전체 타임라인에 적용하면 front hold가 짧아지는 것을 확인, 회전 구간에만 적용해 실제 2.9초 시점에도 앞면 고정임을 검사했다.
6. 후속 원격 Chrome에서 빠른 같은 탭 이동 중 favicon 요청을 ERR_ABORTED로 취소하는 표본이 발생했다. 본문 준비와 무관한 이 요청은 브라우저 idle 판정에서 분리하되, 아이콘 파일의 실제 HTTP 200/본문 존재를 별도 요청으로 검증하도록 보강했다. 핵심 CSS·글꼴·이미지 실패 조건은 유지한다.

## 원격 검증과 남은 Gate

중간 HEAD `8bad0f2ed1a7072006fb5b2bb618740ab1ef8bdc`에서 UAR·공개 회귀·홍보 및 직원앱 local/exact-head Preview 브라우저 PASS를 확인했다. 이후 컨트롤 슬롯·추가 PC/320px 모션 검사 변경이 있어 이전 green을 최종 결과로 대신하지 않는다.

HEAD `7c05b0ea` Netlify deploy `6ad25f7193a3aea438063281`, context `deploy-preview`, state `ready`, commit_ref 일치 확인. 원격 clean URL에서 글꼴 loaded, HERO 최종 frame 5200, 가로 넘침 없음 확인. 최종 HEAD 상태는 PR에 추가 기록한다.

기존 #478 과거 timeout은 trace가 없고 현재 재현되지 않아 정확한 원인은 미확정이다. 툴바 iframe이 전체 networkidle을 지연시킬 수 있는 것은 fixture로 재현했고, 실제 #478의 Netlify CDP·Segment/Bugsnag 외부 요청을 관찰했다. 제품 CSS가 늦으면 새 readiness도 실패하는 경계 검증 PASS. 운영 반영 차단은 유지한다.

고정 QA `qa-preview` SHA `268373020f791e4f882c916f6e174e581522da35`는 이번 HEAD의 조상이 아니다. 따라서 단순 fast-forward로 교체할 수 없고 다른 검수 작업을 보존해야 한다. **고정 QA 갱신 미완료 / 사용자 검수 요청 보류.** 다음 사람 판단은 현 검수 종료·동시 작업을 조정한 뒤 이 PR로 고정 QA 대상을 바꿀지 승인하는 것이다. 이 승인은 main 병합·Production 배포 승인이 아니다.

실제 Android/iOS, TalkBack/VoiceOver, 실제 OS print/백그라운드 전환, 브라우저 자체 확대, 직원 이해도·모바일 배터리는 미확인. 화면 폭 reflow·접근성 트리·이벤트 fixture를 실기 검증으로 확대하지 않는다. 직원앱 Auth·근태·공지·DB·실제 계정 변경 없음.

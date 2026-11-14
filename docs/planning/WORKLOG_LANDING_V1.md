# 태장 업무수첩 공개 소개 페이지

- 요청: 서비스·상품에서 업무수첩 소개로 연결. 사용 용도와 실제 모바일 화면 소개, 하단 비공개 테스트 모집 링크.
- 범위: `worklog.html`, 서비스 카드, 전용 CSS, 공개 빌드 allowlist. 기존 직원앱/테라리움의 헤더·푸터·소개 구조 재사용. 별도 런타임 의존성 없음.
- 공개 문구: 음성 업무 기록, 사진에서 내용 확인·업무 등록, 일정·알림, 선택한 일정의 Google 캘린더 전송. 회의록·문서 스캔 등 별도 검증이 필요한 기능의 완료를 약속하지 않음.
- 참여 CTA: 기존 공개 이메일 `taejang2025@naver.com`에 제목을 넣은 참여 문의 링크. 자동 등록/설치 완료를 약속하지 않음. 별도 승인된 모집 양식 URL이 확인되면 교체 가능.
- 현재 상태: 구현 초안. 실제 휴대폰 스크린샷 교체 및 브라우저/UAR 검수 미완료. main 병합/운영 배포 미실행.

## 화면 자산 출처와 남은 작업

`assets/images/worklog/{entry,calendar}.html`은 `cetin072/worklog-voice-pwa`의
`ad42ec6ecb5f3cb817107b4e208ed46c9116c23a`에 있는
`mobile/src/features/work/manual-work-input.tsx`, `mobile/src/features/home/home-calendar.tsx`를 React Native Web으로 정적 렌더링한 예시다. API 연결 없이 가상 업무·날짜를 사용한다. 입력 화면은 직접 입력 상태, 일정 화면은 브리핑 기반 상태다.

실기기 캡처를 가장하지 않도록 본문에 표시한다. 정적 iframe은 sandbox, tabindex=-1, inert로 실제 입력·저장처럼 동작하지 않게 하고 noindex 처리했다. 외부 호출·실제 계정/업무 자료·토큰은 포함하지 않는다. 생성 시 사용한 React Native Web의 MIT 고지는 `assets/images/worklog/NOTICE.txt`에 포함한다.

로컬 Chromium 실행은 socket Operation not permitted로 실패했고, 제공된 클라우드 브라우저의 file:// 접근도 URL 정책으로 거절됐다. 제한을 우회하지 않았다. 이 자산은 사용자가 요청한 실제 모바일 스크린샷의 최종 대체품으로 간주하지 않는다. 공개 전 예시 데이터가 들어 있는 실제 휴대폰 캡처로 교체하고 모바일/데스크톱 시각 QA와 필수 UAR를 완료한다. 고정 QA는 다른 작업 점유를 확인하기 전 갱신하지 않는다.

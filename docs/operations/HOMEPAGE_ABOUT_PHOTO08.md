# 태장 소개 PHOTO 08 — 홈페이지 관리 연결

## 최소 변경 경계

기존 Issue #146 홈페이지 내용 관리 흐름에 사진 슬롯 하나만 등록합니다.

- 신규 슬롯: `about.greeting.photo`
- 페이지: `about.html` (Netlify Clean URL `/about` 포함)
- 선택자: `[data-photo-slot="08"] > img`
- 타입: `image`
- 편집·업로드: **기존** `app/assets/issue-146-end-to-end.js`
- 등록/승인/직접 저장/되돌리기: **기존** RPC 및 `homepage_content_slots`·`homepage_live_overrides` 데이터 흐름
- 공개 조회: **기존** `netlify/functions/public-homepage-overrides.mjs` 응답
- 공개 표시: **기존** `assets/js/homepage-live-overrides.js`
- 사진이 없거나 서버 오류/파손이면 현재 공개 HTML의 승인된 정적 PHOTO 08 유지
- Auth, RLS, 역할, Storage bucket, 환경변수, 배포 구성 변경 없음

## 관리자 사용 경로

`업무 플랫폼 → 홈페이지 → 홈페이지 내용 관리`에서:

1. `페이지: 태장 소개`, `수정 항목: 태장 소개 · 대표 인사말 사진 (PHOTO 08)` 선택
2. JPG/PNG/WebP/GIF(8MB 이하) 파일과 대체 텍스트 준비
3. 기존 PC/모바일 미리보기에서 교체 결과 확인
4. 홍보팀장은 `운영총괄에게 상신`, 운영총괄은 검토/승인
5. 운영총괄은 기존 `운영총괄 직접 반영` 경로에서 즉시 적용할 수도 있음
6. 운영총괄에게 적용 중인 변경이 있다면 `기본 홈페이지 내용으로 되돌리기` 버튼이 보임. 확인·사유 입력 후 기존 `delete_homepage_slot_override`를 호출하며 감사 로그를 남기고 정적 기본값으로 복귀

`홈페이지 직접 수정`은 기존 **메인 PHOTO 02~06만** 다룹니다. 별도의 PHOTO08 전용 메뉴를 중복 생성하지 않습니다.

## 구현 원인과 해결

- `site.js`에서 공개 전 페이지용 동적 보강 스크립트를 이미 요청하나, `homepage-live-overrides.js`의 `currentPageName()`이 `/about`을 `index.html`로 인식해 기존 등록 슬롯도 적용되지 않았음
- Clean URL도 `about.html`로 정규화해서 개발자 승인된 `public_path` 및 `selector`에 일치할 때만 DOM에 반영
- Supabase 승인된 이미지 요청이 실패하면 원래 정적 `src`·`alt`로 복귀해 빈 영역이 생기지 않도록 처리
- 공개 사이트는 어떤 JavaScript·Netlify Function·Supabase 장애에서도 기존 HTML로 운영 가능

## 검증 및 운영 승인

- 새 SQL은 **기존 슬롯 레지스트리에 add-only 등록**만 수행; 기존 콘텐츠·요청·기록과 역할 정책은 변경하지 않음
- pgTAP: 슬롯 속성·활성 상태·직접 테이블 접근 제한
- Node 공개 회귀: 원래 콘텐츠, Clean URL `/about`/`/about.html`, 이미지 적용·실패 시 복구
- PC 1440/모바일 390 Chrome: Netlify Preview에서 **실제 브라우저 DOM과 이미지 로드**를 확인하되, 응답은 별도 승인된 데이터 fixture로 모의; 실제 운영 DB 쓰기 없음
- 기존 이행된 Supabase 개발 환경에서 migration/pgTAP 재현 검증. 새 SQL은 저장소 병합만으로 실제 Supabase DB에 자동 적용된다고 주장하지 않음
- 실계정 사진 업로드 → 요청 → 운영총괄 승인 → 공개 반영 → 되돌리기 **5단계 실제 E2E는 해당 환경에 대한 명시 승인과 접근권한 확보 후 수행** (운영계정 조작·사진 승인 이력 임의 생성 금지)
- main 병합과 Production 반영은 기존 48시간 고정 배포 정책을 따름. 홈페이지 런타임 변경은 배포된 코드와 적용된 DB 슬롯 양쪽이 준비되어야만 사용 가능.

# 프로젝트 현황

## 목적

태장 공식 홈페이지의 현재 구현·운영 준비·다음 개발 단계를 기록합니다.

## 현재 기준

- 사이트 유형: 순수 HTML/CSS/JavaScript 정적 사이트
- 기본 브랜치: `main`, 모든 변경은 기능 브랜치와 PR 사용
- 운영 배포: 저장소 루트를 사용하는 Netlify 정적 배포
- 패키지 관리자·build command: 없음
- 콘텐츠: `assets/js/content.js` 기반의 일터·활동 목록·상세
- 현재 운영 준비: Draft PR #10 `codex/content-operations-readiness`

## 완료

- 정적 홈페이지와 메인·일터·활동·정책·오류 페이지 구조
- 회사·인증·사업·기업 협력·오시는 길·문의 소개
- 일터·활동 목록·필터·상세·최신순·관련 글·잘못된 ID 처리
- 모바일 메뉴·키보드 포커스·reduced motion 등 접근성 기본
- 공개 콘텐츠 표현 기준과 개발 운영 기준
- 콘텐츠 작성·사진 촬영·교체·개소 전환·공개 검수·게시 절차
- `validate-content.js` 콘텐츠 자동 검증과 기본 테스트
- `audit-site.js` 코드·자산 참조 감사와 기본 테스트

## 진행 중

- PR #10 사진·콘텐츠 운영 준비와 공개 전 검증 체계
- 코드·이미지·문서 중간 감사와 정리 후보 승인
- B2B 필수 콘텐츠·자료·페이지 우선순위 기획
- 직원용 관리자 시스템 역할·상태·화면·데이터·보안 요구사항 설계

## 대기

- 팔용동 사업장·민화·포장·검수·기업 협력·지역활동 실제 승인 사진
- 2026.08.12 개소 후 문구·초대장·사진 전환
- 운영 도메인 확정과 canonical·OG·sitemap·robots 실제 적용
- 회사소개서·인증서 공개본과 실제 협력 사례
- 감사 승인 후 미사용 자산·중복 CSS·오래된 문서 정리
- Supabase 관리자 시스템 구현과 데이터 이전

## 현재 주요 파일

- 공개 화면: `index.html`, `workplace.html`, `activities.html`
- 공통 코드: `assets/css/styles.css`, `assets/js/site.js`, `assets/js/listing.js`
- 콘텐츠 원본: `assets/js/content.js`
- 이미지: `images/`, 승인 전 파트너 로고: `assets/images/partners/`
- 현황·감사: `docs/PROJECT_STATUS.md`, `docs/SITE_AUDIT.md`
- B2B 계획: `docs/B2B_CONTENT_PLAN.md`
- 관리자 설계: `docs/ADMIN_SYSTEM_REQUIREMENTS.md`와 관련 명세

## 공동 개발·정보 원칙

- `main` 직접 수정·운영 배포·Netlify 설정 변경은 금지하며 사용자 승인 후 병합합니다.
- 민감정보, 주주명부, 주민등록번호, 계약 원문, 미승인 사진·로고를 공개 저장소에 넣지 않습니다.
- 공개 문구는 `docs/reference/TAEJANG_PUBLIC_WEB_BRIEF.md`를 우선합니다.
- 관리자 구현 전 기술·비용·보안·역할 결정을 Phase 0에서 확정합니다.

## 다음 우선순위

1. PR #10의 감사·B2B·관리자 설계 승인
2. 별도 PR에서 승인된 미사용 자산·중복 코드 정리
3. B2B P0·P1 자료 수령과 필수 콘텐츠 구현
4. 관리자 Phase 0 의사결정 후 Phase 1 MVP 기반 구축

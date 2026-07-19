# 태장 홈페이지 중간 감사

## 1. 감사 기준

| 항목 | 기준 |
| --- | --- |
| 기준 브랜치 | `codex/site-cleanup-remediation` |
| 기준 `main` | `c6616b1a4642a75ec8c62339ab19d971ae0c5b9d` (PR #10 병합본) |
| 감사 일자 | 2026.07.19 |
| 감사 대상 | HTML 6개, CSS 1개, 공개 JavaScript 4개, 검증 스크립트, 이미지·로고, Netlify·SEO 설정, 루트 및 `docs/` 문서 |
| 실제 수정 여부 | 오래된 미참조 파일·문의 폼 잔여 CSS를 제거하고, 미리보기와 감사 스크립트를 보완함 |

정적 검색과 파일 존재 여부, 이미지 해시, Node.js 검증을 사용했습니다. 정적 검색만으로 실제 사진의 권리·사실관계·화면 품질을 확정하지 않습니다.

## 2. 현재 기술 구조

- 순수 HTML/CSS/JavaScript 정적 사이트이며 Netlify가 저장소 루트를 별도 build command 없이 배포합니다.
- `assets/js/content.js`의 `workplace`, `activities` 배열이 목록·상세 및 메인 미리보기의 단일 콘텐츠 원천입니다.
- `assets/js/listing.js`는 목록·필터·상세·관련 글을, `assets/js/home-previews.js`는 메인 미리보기를 안정적인 최신순으로 렌더링합니다.
- 관리자 시스템, 로그인, 데이터베이스, Storage 연동은 없습니다.
- `scripts/validate-content.js`는 공개 ID·날짜·카테고리·사진 안내와 메인 미리보기 컨테이너를 검사합니다.
- `scripts/audit-site.js`는 이미지 참조·내부 링크·중복 ID·개발 안내·canonical/OG 현황을 검사합니다.

## 3. 정상 유지 항목

| 항목 | 근거 | 권고 |
| --- | --- | --- |
| 가벼운 정적 구조 | 서버·DB 없이 핵심 페이지 제공 | 관리자 도입 전까지 유지 |
| 목록·상세·필터 | 기존 공개 ID 6개, 잘못된 ID 안내, 목록 복귀 | 유지 |
| 최신순·관련 글 | 원본 배열을 변경하지 않는 안정 정렬 | 유지 |
| 메인 미리보기 | `content.js` 기반 자동 생성, 실패 시 목록 링크 안내 | 콘텐츠 수정 뒤 검증 실행 |
| 접근성 기본 | skip link, 키보드 포커스, 모바일 메뉴, reduced motion | 회귀 검사 유지 |
| 승인된 히어로 | `minhwa-wide.jpg`, `coaching.jpg`만 사용 | 승인 전 교체 금지 |

## 4. 중복 구조와 기술 부채

| 항목 | 영향 | 상태 | 권장 시점 |
| --- | --- | --- | --- |
| 주요 페이지 헤더·푸터 반복 | 메뉴·회사정보 변경 누락 위험 | 유지 | 구조 정리 PR 또는 관리자 도입 전 |
| 페이지별 메타 태그 | 운영 도메인 전환 시 누락 위험 | 도메인 변경 금지 범위로 유지 | 도메인 확정 별도 PR |
| 사진 안내의 HTML·데이터 분산 | 안내 교체 누락 가능 | 메인 미리보기는 데이터화 완료 | 실제 사진 수령 시 |
| 단일 CSS 파일 | 영향 추적이 어려움 | 493줄에서 463줄로 고신뢰 잔여 코드만 정리 | 화면 안정 후 |
| 전역 콘텐츠 스크립트 | DB 전환 시 어댑터 필요 | 유지 | 관리자 개발 전 |
| 정적 사이트와 향후 DB 발행 | 콘텐츠 원천 이중화 위험 | 미설계 | 관리자 Phase 0 |

## 5. 미사용 코드 정리 결과

| 분류 | 처리 | 근거 |
| --- | --- | --- |
| 문의 폼 CSS | 제거 | `contact-form`, `contact-layout`, `contact-panel`, `field`, `full`, `check`은 HTML·JavaScript에서 사용되지 않음 |
| 과거 히어로 CSS | 제거 | `hero-media`는 현재 2장 슬라이드 구조에서 사용되지 않음 |
| 과거 상세 공지 CSS | 제거 | `article-notice-media`는 현재 렌더러에서 사용되지 않음 |
| 미사용 유틸리티 | 제거 | `grid-4`, `light`, `narrow`, `stack`의 사이트 참조가 없음 |
| 동적·접근성 상태 | 유지 | `open`, `active`, `hidden`, 포커스·사진 안내 관련 규칙은 동적 또는 현재 사용 중 |

JavaScript의 초기화·이벤트·목록 렌더링 함수는 현재 흐름에서 사용 확인되어 제거하지 않았습니다.

## 6. 이미지·자산 감사

### 현재 파일 10개

| 파일 | 분류 | 참조·용도 | 권고 |
| --- | --- | --- | --- |
| `images/coaching.jpg` | A 현재 사용 | 포장 작업 히어로 | 유지 |
| `images/minhwa-wide.jpg` | A 현재 사용 | 민화 작업 히어로 | 유지 |
| `images/favicon.png` | B 아이콘 | favicon·Apple icon | 유지 |
| `images/logo.png` | B 공식 로고 | 헤더 | 유지 |
| `images/logo-white.png` | B 공식 로고 | 푸터 | 유지 |
| `images/og-taejang.png` | B 공유 자산 | OG·Twitter 이미지 | 유지 |
| `assets/images/partners/bumhan.svg` | D 공식 등록 자산 | 현재 미참조 | 보존 |
| `assets/images/partners/bumhan.png` | D 공식 등록 자산 | SVG 대체본, 현재 미참조 | 보존 |
| `assets/images/partners/samhyun.jpg` | D 공식 등록 자산 | 현재 미참조 | 보존 |
| `assets/images/partners/cheungwoo-bj.png` | D 공식 등록 자산 | 현재 미참조 | 보존 |

분류: A 현재 사용 중, B favicon·OG·공유·공식 로고, D 협력사·인증·공식 등록 자산.

### 삭제한 과거 자산

`business-premium-stilllife.webp`, `minhwa-color.jpg`, `minhwa-line.jpg`, `packing-1.jpg`, `packing-2.jpg`는 사이트·문서에서 현재 참조되지 않고, 공개 승인·역할 확인이 없으며, 일부는 새 촬영 예정 파일명과 충돌했습니다. 실제 사진 원본은 공개 저장소 밖의 내부 보관 여부를 회사가 별도로 관리해야 합니다.

과거 `images/packing-2.jpg`는 공개 부적합 판정 파일이므로 삭제했습니다. 새 촬영 예정 파일명 `packing-2.jpg` 정책은 유지하며, 실제 승인 사진이 들어오기 전에는 `img src`로 연결하지 않습니다. 감사 스크립트는 과거 파일 해시가 다시 공개 참조되는 경우 오류로 처리합니다.

협력사 로고 4개는 현재 화면 미참조이지만, 승인된 웹용 공식 자산으로 의도적으로 보존합니다. 공개 배치는 회사의 로고 사용 승인 후에만 가능합니다.

## 7. 문서·유틸리티 페이지 정리

| 항목 | 처리 | 근거 |
| --- | --- | --- |
| `README.txt` | 삭제 | FormSubmit, 3장 히어로, 이전 이미지 구조 등 현재 코드와 불일치하며 최신 `README.md`와 `docs/`에 대체됨 |
| `EDIT-GUIDE.txt` | 삭제 | `CONTENT_UPDATE_GUIDE.md`, `PUBLISH_WORKFLOW.md`, `PHOTO_GUIDE.md`와 역할이 중복되고 참조되지 않음 |
| `thanks.html` | 삭제 | 문의 폼·FormSubmit·redirect·sitemap·내부 링크에서 사용되지 않음 |
| `privacy.html` | 갱신 | 실제 문의 방식인 전화·이메일과 맞게 웹 폼 수집 표현을 제거 |

`privacy.html`, `terms.html`, `404.html`의 robots 메타 중복은 운영 도메인·robots 정책 변경 금지 범위이므로 이번 정리에서 변경하지 않았습니다.

## 8. 공개 전 제거·전환 대상

| 항목 | 분류 | 전환 조건 |
| --- | --- | --- |
| `.dev-photo-placeholder`와 교체 주석 | 실제 사진 수령 후 교체 | 승인 사진·alt·경로 적용 후 제거 |
| 신규 사업장 초대장 링크·예정 시제 | 개소 후 전환 | 실제 개소 상태와 공개 승인 확인 |
| canonical·OG·sitemap·robots 주소 | 도메인 확정 후 전환 | 운영 도메인 확정 별도 PR |

`node scripts/audit-site.js`는 개발 안내를 WARNING으로, `node scripts/audit-site.js --public-ready`는 ERROR로 처리합니다. 이 차이는 의도된 공개 전 게이트입니다.

## 9. 정리 권고안

### 다음 PR에서 정리

- 실제 사진 수령·승인 후 안내박스를 이미지와 실제 alt로 교체
- 개소 후 시제·초대장 링크를 확인해 전환
- 도메인 확정 후 canonical·OG·sitemap·robots를 별도 SEO PR에서 검토
- 반복 헤더·푸터의 안전한 공통화 방식 결정

### 관리자 시스템 개발 시 함께 변경

- DB를 콘텐츠 원천으로 전환하고 정적 발행 방식 결정
- 공개 이미지·비공개 원본·첨부파일 Storage 경계 분리
- 공개 페이지 데이터 어댑터, 인증·권한·승인·revision·감사 로그 도입

관련 명령: `node scripts/validate-content.js`, `node scripts/audit-site.js`, `node scripts/audit-site.js --public-ready`

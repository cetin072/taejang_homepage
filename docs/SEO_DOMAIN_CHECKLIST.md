# SEO·운영 도메인 체크리스트

이 문서는 현재 코드 기준의 검색·공유 설정을 기록하고, 운영 도메인이 확정된 뒤 변경할 위치를 정리합니다. 이 문서 작성만으로 현재 주소나 Netlify 설정을 변경하지 않습니다.

## 현재 운영 상태

- 상태: **운영 도메인 확정 대기**
- 코드 변경: **보류**
- 검색엔진 등록: **보류**
- 도메인 확정 후 별도 PR에서 진행

현재 조사 내용은 참고용이며, 임시 주소를 최종 운영 도메인으로 판단하지 않습니다.

## 현재 코드 기준

| 항목 | 현재 상태 |
| --- | --- |
| Canonical 주소 | `https://taejang-homepage.netlify.app/` 및 각 페이지 경로 |
| Open Graph URL | `https://taejang-homepage.netlify.app/` 및 각 페이지 경로 |
| 공유 이미지 | `images/og-taejang.png` (1200 × 630 PNG) |
| favicon | `images/favicon.png`과 Apple Touch Icon 설정 존재 |
| sitemap.xml | 존재: 메인·일터·활동 페이지의 현재 Netlify 기본 주소가 등록됨 |
| robots.txt | 존재: 전체 허용 및 현재 sitemap URL 지정 |
| 운영 도메인 | 코드상 Netlify 기본 주소를 사용 중이며 별도 운영 도메인 확정 여부는 확인 필요 |

## 운영 도메인 확정 후 변경할 파일

- `index.html`: canonical, `og:url`, `og:image`, `og:image:secure_url`, Twitter 공유 이미지 URL
- `workplace.html`: canonical, `og:url`, 공유 이미지 URL
- `activities.html`: canonical, `og:url`, 공유 이미지 URL
- `sitemap.xml`: 각 페이지의 `<loc>` 주소
- `robots.txt`: Sitemap 주소
- Netlify의 사용자 승인된 도메인 연결·HTTPS 상태 확인

도메인이 확정되기 전에는 현재 meta URL과 Netlify 설정을 임의로 바꾸지 않습니다.

## 네이버 서치어드바이저 등록 항목

- 사이트 소유 확인
- 대표 도메인과 HTTPS 주소 확인
- sitemap 제출(작성된 경우)
- robots.txt 검사(작성된 경우)
- 수집 요청과 검색 노출 상태 확인
- 페이지 제목·설명·공유 이미지가 실제 페이지와 일치하는지 확인

## Google Search Console 등록 항목

- 도메인 또는 URL 접두어 속성 등록
- 소유권 확인
- sitemap 제출(작성된 경우)
- 색인 생성 보고서와 모바일 사용성 확인
- canonical 선택 및 URL 검사
- Core Web Vitals와 보안 문제 확인

## 카카오톡 공유 확인 항목

- `og:title`, `og:description`, `og:image`, `og:url` 확인
- 1200 × 630 공유 이미지가 정상 노출되는지 확인
- 도메인 변경 후 캐시 갱신 상태 확인
- 모바일 메신저에서 제목·설명·이미지의 줄바꿈 확인

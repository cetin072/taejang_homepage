# 태장 민화 이미지 중심 랜딩

기존안 [PR #656](https://github.com/cetin072/taejang_homepage/pull/656)은 main에 병합됐다. 후속 보강은 별도 Draft에서 검수한다. [사업 기획](https://app.notion.com/p/415bd4185ef081a7940be1111e7becdc)과 첨부 실행 패키지의 공개 범위를 적용한다.

- 홈페이지 첫 화면과 사업 카드, 서비스·상품에서 같은 태장 민화 페이지로 연결한다. 서비스 카드는 준비 중으로 표기한다.
- 전시 공간 이미지 → 섹션 이동 → 미담 서정희 작가 → 액자 전시 → 실제 작업 이야기 → 클래스·출강 → 굿즈 → 문의 순으로 구성한다. 기존 `why-minhwa.html`과 협력·문의 경로를 사용한다.
- 첨부 ZIP의 갤러리 히어로와 굿즈를 WebP 800/1600px로 제공한다. 굿즈 1600px 이미지는 첨부 원본에서 공개 웹 용량 기준에 맞춰 다시 압축했다. 액자 3점은 갤러리 이미지의 부분 확대이며, 전시와 굿즈에 AI 콘셉트 이미지라고 표시한다.
- 실제 활동에는 기존에 공개한 `images/homepage/photo-02.webp`와 `assets/images/workplace/minhwa-fish-scale-painting.webp`를 사용한다.

`npm run test:public`, `npm run build:netlify`, `node scripts/check-minhwa-landing.mjs`로 기본 계약을 확인한다. 브라우저 검수는 `tests/minhwa-gallery-browser.mjs`를 사용한다.

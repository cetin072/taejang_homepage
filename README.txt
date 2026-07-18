태장 홈페이지 v6 리팩터링 버전

구조
- index.html: 메인 홈페이지
- workplace.html: 우리의 일터 목록 및 상세 글
- activities.html: 태장의 활동 목록 및 상세 글
- assets/css/styles.css: 전체 디자인
- assets/js/site.js: 메뉴·FAQ 등 공통 기능
- assets/js/content.js: 일터·활동 게시글 데이터
- assets/js/listing.js: 목록·필터·상세 글 자동 표시
- images/: 홈페이지 이미지
- privacy.html, terms.html, thanks.html, 404.html
- robots.txt, sitemap.xml, netlify.toml

게시글 수정
1. assets/js/content.js를 엽니다.
2. workplace 또는 activities 배열에 글을 추가하거나 수정합니다.
3. 메인 화면에 노출되는 대표 글은 index.html의 카드 3개를 수정합니다.

문의 메일
- FormSubmit 방식 유지
- 최초 시험 제출 후 taejang2025@naver.com으로 온 인증 메일을 승인해야 합니다.

주의
- 파트너사 공식 명칭과 로고는 각 기업의 공개 승인을 확인한 뒤 반영하십시오.
- 근로자 사진은 홈페이지 사용 동의를 확인하십시오.


v7 공유 썸네일 적용
- images/og-taejang.png 추가 (1200×630)
- 카카오톡, 네이버, 문자 링크 공유용 Open Graph 태그 적용
- 메인, 우리의 일터, 태장의 활동 페이지에 대표 이미지·제목·설명 등록
- Twitter/X 공유용 메타태그도 함께 적용

배포 후 확인
- 카카오톡에서 기존 링크 미리보기가 남아 있으면 캐시 때문에 바로 바뀌지 않을 수 있습니다.
- 잠시 후 다시 공유하거나, 주소 뒤에 ?v=2 같은 값을 붙여 새 링크로 테스트해보세요.


v8 최종 ZIP 수정
- 문의 입력폼 제거
- 전화 문의와 이메일 문의 버튼으로 단순화
- 히어로 사진 3장 페이드 슬라이드 적용
- 6초마다 자동 전환
- 좌우 버튼과 하단 위치 표시 추가
- 마우스/키보드 사용 시 자동 전환 일시정지
- 모션 감소 설정 사용자는 자동 전환 비활성화

다음 수정부터는 GitHub + Codex + Netlify 자동배포 방식으로 전환 예정


v11 주요 사업 이미지 시범 적용
- 기준: 인포그래픽 삽입 전 v8 버전
- 기존 그림형 인포그래픽 4개는 적용하지 않음
- 주요 사업 섹션에만 프리미엄 정물 사진형 이미지 1장 적용
- 이미지 아래의 기존 4개 사업 카드와 설명은 유지
- 모바일에서는 16:10 비율로 자연스럽게 크롭

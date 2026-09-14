(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  if (!content || !Array.isArray(content.hub)) return;

  // 언론보도 백필은 소식·기록(archive)에서만 전체 노출합니다.
  // 기사 사진은 언론사 저작물을 복제하지 않고 태장 자체 개소식 사진을 공통 썸네일로 사용합니다.
  const archivePressItems = [
    {
      id: 'press-yonhap-20260812-taejang',
      type: 'external',
      source: 'press',
      publisher: '연합뉴스',
      category: '회사소식',
      title: "경남형 장애인 동행일자리 1호 농업회사법인 '태장' 창원서 개소",
      summary: '연합뉴스가 경남 4개 기업의 공동출자로 출범한 태장과 자회사형 장애인표준사업장 인증, 장애인 고용 현황을 보도했습니다.',
      thumbnail: 'assets/images/archive/opening-ceremony.webp',
      thumbnailAlt: '경남형 장애인 동행일자리 1호점 태장 개소식 현장',
      publishedAt: '2026-08-12',
      featured: false,
      status: 'published',
      externalUrl: 'https://www.yna.co.kr/view/AKR20260812048100052',
      externalLabel: '연합뉴스에서 보기'
    },
    {
      id: 'press-newsjinju-59989',
      type: 'external',
      source: 'press',
      publisher: '진주신문',
      category: '회사소식',
      title: '경남형 장애인 동행일자리 1호점 출범',
      summary: '진주신문이 태장의 개소와 도내 4개 기업 공동출자, 장애인 고용 상생모델의 출범을 소개했습니다.',
      thumbnail: 'assets/images/archive/opening-ceremony.webp',
      thumbnailAlt: '경남형 장애인 동행일자리 1호점 태장 개소식 현장',
      publishedAt: '2026-08-12',
      featured: false,
      status: 'published',
      externalUrl: 'https://newsjinju.kr/news/articleView.html?idxno=59989',
      externalLabel: '진주신문에서 보기'
    },
    {
      id: 'press-knn-191206',
      type: 'external',
      source: 'press',
      publisher: 'KNN',
      category: '회사소식',
      title: "민관협력 '경남형 장애인 동행일자리 1호점' 개소",
      summary: 'KNN이 경남도와 기업, 한국장애인고용공단 등이 협력해 문을 연 경남형 장애인 동행일자리 1호점의 개소 소식을 보도했습니다.',
      thumbnail: 'assets/images/archive/opening-ceremony.webp',
      thumbnailAlt: '경남형 장애인 동행일자리 1호점 태장 개소식 현장',
      publishedAt: '2026-08-13',
      featured: false,
      status: 'published',
      externalUrl: 'https://news.knn.co.kr/news/article/191206',
      externalLabel: 'KNN에서 보기'
    },
    {
      id: 'press-knn-191244',
      type: 'external',
      source: 'press',
      publisher: 'KNN',
      category: '회사소식',
      title: "'경남형 장애인 동행일자리' 1호점 첫선",
      summary: 'KNN이 태장 근로자들의 테라리움과 홍보 직무 현장을 찾아 장애인 일자리 운영 모습과 민관 협력 고용모델을 소개했습니다.',
      thumbnail: 'assets/images/archive/opening-ceremony.webp',
      thumbnailAlt: '경남형 장애인 동행일자리 1호점 태장 개소식 현장',
      publishedAt: '2026-08-13',
      featured: false,
      status: 'published',
      externalUrl: 'https://news.knn.co.kr/news/article/191244',
      externalLabel: 'KNN에서 보기'
    },
    {
      id: 'press-kdjob-8779',
      type: 'external',
      source: 'press',
      publisher: '장애인일자리신문',
      category: '회사소식',
      title: '경남형 장애인 동행일자리 1호점 출범…민관 공동 장애인 고용모델 가동',
      summary: '장애인일자리신문이 도내 4개 기업이 공동출자한 태장의 개소와 장애인 고용 확대 계획, 자회사형 장애인표준사업장 운영모델을 보도했습니다.',
      thumbnail: 'assets/images/archive/opening-ceremony.webp',
      thumbnailAlt: '경남형 장애인 동행일자리 1호점 태장 개소식 현장',
      publishedAt: '2026-08-13',
      featured: false,
      status: 'published',
      externalUrl: 'https://kdjob.co.kr/article/8779',
      externalLabel: '장애인일자리신문에서 보기'
    }
  ];

  const externalItems = [
    {
      id: 'naver-blog-224367547159',
      type: 'external',
      source: 'naver-blog',
      category: '회사소식',
      title: '한 줄 한 줄 정성으로 완성되는 태장의 하루',
      summary: '태장 직원들이 민화 작업에 집중하며 한 줄 한 줄 정성으로 하루를 채워가는 작업장 모습을 소개합니다.',
      thumbnail: 'assets/images/archive/naver-blog-224367547159.webp',
      thumbnailAlt: '태장 작업장에서 직원들이 민화와 작업 활동을 진행하는 모습',
      publishedAt: '2026-08-04',
      featured: false,
      status: 'published',
      externalUrl: 'https://blog.naver.com/taejang-official/224367547159',
      externalLabel: '네이버 블로그에서 보기'
    },
    {
      id: 'youtube-FbEOcteBSJ4',
      type: 'external',
      source: 'youtube',
      publisher: '태장 공식 유튜브',
      category: '회사소식',
      title: '태장 소개영상',
      summary: '함께 일하며 지속 가능한 기회를 만들어가는 태장의 사업과 일터를 영상으로 소개합니다.',
      thumbnail: 'https://i.ytimg.com/vi/FbEOcteBSJ4/hqdefault.jpg',
      thumbnailAlt: '태장 공식 소개영상 썸네일',
      publishedAt: '2026-08-13',
      featured: false,
      status: 'published',
      externalUrl: 'https://www.youtube.com/watch?v=FbEOcteBSJ4',
      externalLabel: '유튜브에서 보기'
    },
    {
      id: 'youtube-qvqNyeyfQsA',
      type: 'external',
      source: 'youtube',
      publisher: '태장 공식 유튜브',
      category: '회사소식',
      title: '경남형 동행일자리사업 1호점 태장㈜ 개소식 축하영상 | 창원특례시장',
      summary: '창원특례시장이 태장 개소식을 축하하며 경남형 동행일자리사업 1호점의 출발을 응원하는 영상입니다.',
      thumbnail: 'https://i.ytimg.com/vi/qvqNyeyfQsA/hqdefault.jpg',
      thumbnailAlt: '태장 공식 유튜브 창원특례시장 개소식 축하영상 썸네일',
      publishedAt: '2026-08-14',
      featured: false,
      status: 'published',
      externalUrl: 'https://www.youtube.com/watch?v=qvqNyeyfQsA',
      externalLabel: '유튜브에서 보기'
    },
    {
      id: 'youtube-8x7yg5YBK9g',
      type: 'external',
      source: 'youtube',
      publisher: '태장 공식 유튜브',
      category: '회사소식',
      title: '경남형 장애인 동행일자리 1호점 태장㈜ 개소식 축하영상 | 경상남도지사',
      summary: '경상남도지사가 태장 개소식을 축하하며 장애인 동행일자리 1호점의 시작을 응원하는 영상입니다.',
      thumbnail: 'https://i.ytimg.com/vi/8x7yg5YBK9g/hqdefault.jpg',
      thumbnailAlt: '태장 공식 유튜브 경상남도지사 개소식 축하영상 썸네일',
      publishedAt: '2026-08-14',
      featured: false,
      status: 'published',
      externalUrl: 'https://www.youtube.com/watch?v=8x7yg5YBK9g',
      externalLabel: '유튜브에서 보기'
    },
    // 2026-08-24 두 번째 환경정비 활동을 기록한 태장 공식 브이로그입니다.
    {
      id: 'youtube-mIb0wN_Wi8w',
      type: 'external',
      source: 'youtube',
      publisher: '태장 공식 유튜브',
      category: 'ESG·사회공헌',
      title: '[태장 브이로그] 8월 24일, 더운 날씨 속에서도 정말 뿌듯했던 환경정비 활동',
      summary: '8월 24일 더운 날씨 속에서 진행한 태장의 두 번째 환경정비 활동 현장을 브이로그로 소개합니다.',
      thumbnail: 'https://i.ytimg.com/vi/mIb0wN_Wi8w/hqdefault.jpg',
      thumbnailAlt: '태장 8월 24일 환경정비 활동 브이로그 썸네일',
      publishedAt: '2026-08-24',
      featured: false,
      status: 'published',
      externalUrl: 'https://www.youtube.com/watch?v=mIb0wN_Wi8w',
      externalLabel: '유튜브에서 보기'
    },
    {
      id: 'youtube-8x4Rf3knAb8',
      type: 'external',
      source: 'youtube',
      publisher: 'KNN',
      category: '회사소식',
      title: "[현장] '경남형 장애인 동행일자리' 1호점 가보니",
      summary: 'KNN이 경남형 장애인 동행일자리 1호 사업장 태장을 찾아 장애인 근로자의 일터와 운영 현장을 소개했습니다.',
      thumbnail: 'https://i.ytimg.com/vi/8x4Rf3knAb8/hqdefault.jpg',
      thumbnailAlt: 'KNN 경남형 장애인 동행일자리 1호점 보도영상 썸네일',
      publishedAt: '2026-08-13',
      featured: false,
      status: 'published',
      externalUrl: 'https://www.youtube.com/watch?v=8x4Rf3knAb8',
      externalLabel: '유튜브에서 보기'
    },
    {
      id: 'kbs-news-8636757',
      type: 'external',
      source: 'press',
      publisher: 'KBS 뉴스',
      category: '회사소식',
      title: '‘경남형 장애인 동행일자리’ 1호점 창원 가동',
      summary: 'KBS가 경남형 장애인 동행일자리 1호 사업장 태장의 창원 가동 소식과 장애인 고용·기업 참여 구조를 보도했습니다.',
      publishedAt: '2026-08',
      featured: false,
      status: 'published',
      externalUrl: 'https://news.kbs.co.kr/news/pc/view/view.do?ncd=8636757&ref=A',
      externalLabel: 'KBS 뉴스에서 보기'
    }
  ];

  const isArchivePage = typeof document !== 'undefined'
    && Boolean(document.querySelector?.('[data-hub-list][data-static-fallback="archive"]'));
  if (isArchivePage) externalItems.push(...archivePressItems);

  externalItems.forEach((item) => {
    const exists = content.hub.some((candidate) => candidate.id === item.id);
    if (!exists) content.hub.push(item);
  });

  // archive.html and index.html load this file immediately before content-hub.js.
  // Use a parser-blocking external script so the public-safe live feed is merged
  // before the existing static hub renders. If the feed function is unavailable,
  // its response is an empty JS comment and the static homepage remains intact.
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.write('<script data-live-promotion-feed src="/.netlify/functions/public-promotion-feed"><\/script>');
  }
}());

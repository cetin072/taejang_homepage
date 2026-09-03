(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  if (!content || !Array.isArray(content.hub)) return;

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

  externalItems.forEach((item) => {
    const exists = content.hub.some((candidate) => candidate.id === item.id);
    if (!exists) content.hub.push(item);
  });

  // archive.html and index.html load this file immediately before content-hub.js.
  // Use a parser-blocking external script so the public-safe live feed is merged
  // before the existing static hub renders. If the feed function is unavailable,
  // its response is an empty JS comment and the static homepage remains intact.
  if (document.readyState === 'loading') {
    document.write('<script data-live-promotion-feed src="/.netlify/functions/public-promotion-feed"><\/script>');
  }
}());

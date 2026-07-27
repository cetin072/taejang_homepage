(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  if (!content || !Array.isArray(content.hub)) return;

  const externalItems = [
    {
      id: 'naver-blog-224359125575',
      type: 'external',
      source: 'naver-blog',
      category: '회사소식',
      title: '태장 네이버 블로그 첫 기록',
      summary: '태장 네이버 블로그에 작성한 첫 게시글입니다. 카드를 누르면 원문이 새 탭에서 열립니다.',
      thumbnail: 'assets/images/archive/naver-blog-first-post.svg',
      thumbnailAlt: '태장 네이버 블로그 첫 기록 시험용 썸네일',
      publishedAt: '2026-07-27',
      featured: false,
      status: 'published',
      externalUrl: 'https://m.blog.naver.com/sksk6625/224359125575',
      externalLabel: '네이버 블로그에서 보기'
    }
  ];

  externalItems.forEach((item) => {
    const exists = content.hub.some((candidate) => candidate.id === item.id);
    if (!exists) content.hub.push(item);
  });
}());

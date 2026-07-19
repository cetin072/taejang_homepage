(function(){
  const type = document.body.dataset.contentType;
  const data = window.TAEJANG_CONTENT?.[type] || [];
  const list = document.querySelector('[data-list]');
  const filters = document.querySelector('[data-filters]');
  const listing = document.querySelector('[data-listing]');
  const detail = document.querySelector('[data-detail]');
  const pageHero = document.querySelector('[data-page-hero]');
  const detailTarget = detail?.querySelector('.container') || detail;
  const pageConfig = {
    workplace: {
      page: 'workplace.html',
      backLabel: '← 일터 이야기 목록으로',
      relatedTitle: '다른 일터 이야기'
    },
    activities: {
      page: 'activities.html',
      backLabel: '← 태장의 활동 목록으로',
      relatedTitle: '다른 태장 소식'
    }
  };
  const config = pageConfig[type];

  if(!list || !listing || !detail || !detailTarget || !config) return;

  function dateValue(value){
    if(typeof value !== 'string' || !/^\d{4}\.\d{2}\.\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('.').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if(date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.getTime();
  }

  function latestFirst(items){
    return items
      .map((item, index) => ({ item, index, timestamp: dateValue(item.date) }))
      .sort((a, b) => {
        if(a.timestamp === null && b.timestamp === null) return a.index - b.index;
        if(a.timestamp === null) return 1;
        if(b.timestamp === null) return -1;
        return b.timestamp - a.timestamp || a.index - b.index;
      })
      .map(entry => entry.item);
  }

  const orderedData = latestFirst(data);

  function photoPlaceholder(photo, variant='card'){
    if(!photo) return '';
    const note = variant === 'detail' && photo.note ? `<p class="dev-photo-note">${photo.note}</p>` : '';
    return `<div class="dev-photo-placeholder dev-photo-placeholder--${variant}" role="note">
      <span class="dev-review-badge">개발 검토용 · 사진자료 필요</span>
      <strong>${photo.title}</strong>
      <p><code>${photo.filename}</code> · ${photo.orientation}</p>
      ${note}
    </div>`;
  }

  function cardMedia(item){
    if(item.thumb){
      return `<div class="card-media"><img src="${item.thumb}" alt="${item.alt?.thumb || item.title}" loading="lazy"></div>`;
    }
    return photoPlaceholder(item.listingPhoto || item.photo, 'card') || `<div class="card-media card-media--notice"><span class="notice-media-label">공식 소식</span></div>`;
  }

  function card(item){
    return `<article class="card" data-category="${item.category}">
      <a class="card-link" href="${config.page}?id=${encodeURIComponent(item.id)}">
        ${cardMedia(item)}
        <div class="card-body">
          <span class="tag tag--subtle">${item.category}</span>
          <time class="card-date" datetime="${item.date}">${item.date}</time>
          <h2>${item.title}</h2>
          <p>${item.summary}</p>
          <span class="text-link">자세히 보기 →</span>
        </div>
      </a>
    </article>`;
  }

  function setFilterState(active){
    filters?.querySelectorAll('[data-filter]').forEach(button => {
      const selected = button.dataset.filter === active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function render(filter='전체'){
    const items = orderedData.filter(item => filter === '전체' || item.category === filter);
    list.innerHTML = items.length
      ? items.map(card).join('')
      : '<p class="listing-empty">선택한 분류의 게시물이 없습니다.</p>';
    setFilterState(filter);
  }

  function bodySections(item){
    if(Array.isArray(item.sections) && item.sections.length){
      return item.sections
        .map(section => ({
          heading: typeof section.heading === 'string' ? section.heading.trim() : '',
          paragraphs: Array.isArray(section.paragraphs) ? section.paragraphs.filter(text => typeof text === 'string' && text.trim()) : []
        }))
        .filter(section => section.paragraphs.length);
    }

    if(!Array.isArray(item.body)) return [];
    return item.body
      .map((entry, index) => {
        if(typeof entry === 'string'){
          return {
            heading: index === 1 && item.bodyHeading ? item.bodyHeading : '',
            paragraphs: [entry]
          };
        }
        return {
          heading: typeof entry?.heading === 'string' ? entry.heading.trim() : '',
          paragraphs: Array.isArray(entry?.paragraphs)
            ? entry.paragraphs.filter(text => typeof text === 'string' && text.trim())
            : (typeof entry?.text === 'string' && entry.text.trim() ? [entry.text] : [])
        };
      })
      .filter(section => section.paragraphs.length);
  }

  function renderBody(item){
    return bodySections(item).map(section => {
      const heading = section.heading ? `<h2>${section.heading}</h2>` : '';
      return `${heading}${section.paragraphs.map(paragraph => `<p>${paragraph}</p>`).join('')}`;
    }).join('');
  }

  function relatedItems(item){
    const otherItems = orderedData.filter(entry => entry.id !== item.id);
    const sameCategory = otherItems.filter(entry => entry.category === item.category);
    const otherCategories = otherItems.filter(entry => entry.category !== item.category);
    const selectedIds = new Set([...sameCategory, ...otherCategories].slice(0, 2).map(entry => entry.id));
    return orderedData.filter(entry => selectedIds.has(entry.id));
  }

  function relatedPosts(item){
    const items = relatedItems(item);
    if(!items.length) return '';
    return `<section class="related-posts" aria-labelledby="related-posts-title">
      <h2 id="related-posts-title">${config.relatedTitle}</h2>
      <div class="related-posts-grid">
        ${items.map(related => `<a class="related-post" href="${config.page}?id=${encodeURIComponent(related.id)}">
          <span class="related-post-meta"><span class="tag tag--subtle">${related.category}</span><time datetime="${related.date}">${related.date}</time></span>
          <h3>${related.title}</h3>
          <p>${related.summary}</p>
          <span class="text-link">글 보기 →</span>
        </a>`).join('')}
      </div>
    </section>`;
  }

  const categories = ['전체', ...new Set(data.map(item => item.category))];
  if(filters){
    filters.innerHTML = categories.map((category, index) =>
      `<button class="filter-btn ${index === 0 ? 'active' : ''}" type="button" data-filter="${category}" aria-pressed="${index === 0 ? 'true' : 'false'}">${category}</button>`
    ).join('');
    filters.addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if(!button) return;
      render(button.dataset.filter);
    });
  }
  render();

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if(!id) return;

  listing.hidden = true;
  detail.hidden = false;
  if(pageHero) pageHero.hidden = true;

  const item = data.find(entry => entry.id === id);
  if(!item){
    document.title = '글을 찾을 수 없습니다 | 태장';
    detailTarget.innerHTML = `<article class="article article-empty">
      <h1>요청한 글을 찾을 수 없습니다</h1>
      <p>주소가 변경되었거나 존재하지 않는 게시물입니다.</p>
      <a class="btn line" href="${config.page}">${config.backLabel}</a>
    </article>`;
    return;
  }

  document.title = `${item.title} | 태장`;
  const detailMedia = item.hero
    ? `<figure><img src="${item.hero}" alt="${item.alt?.hero || item.title}"></figure>`
    : photoPlaceholder(item.photo, 'detail');
  const gallery = item.gallery?.length
    ? `<div class="article-gallery">${item.gallery.map((src, index) => `<img src="${src}" alt="${item.alt?.gallery?.[index] || item.title}" loading="lazy">`).join('')}</div>`
    : '';

  detailTarget.innerHTML = `<a class="back-link" href="${config.page}">${config.backLabel}</a>
    <article class="article">
      <header class="article-header">
        <div class="article-meta"><span class="tag">${item.category}</span><time datetime="${item.date}">${item.date}</time></div>
        <h1>${item.title}</h1>
        <p class="lead">${item.summary}</p>
      </header>
      <div class="article-body">${detailMedia}${renderBody(item)}${gallery}</div>
      ${relatedPosts(item)}
      <a class="back-link back-link--bottom" href="${config.page}">${config.backLabel}</a>
    </article>`;
})();

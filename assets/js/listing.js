(function(){
  const type = document.body.dataset.contentType;
  const data = window.TAEJANG_CONTENT?.[type] || [];
  const list = document.querySelector('[data-list]');
  const filters = document.querySelector('[data-filters]');
  const listing = document.querySelector('[data-listing]');
  const detail = document.querySelector('[data-detail]');
  const pageHero = document.querySelector('[data-page-hero]');
  const page = type === 'workplace' ? 'workplace.html' : 'activities.html';
  const detailTarget = detail?.querySelector('.container') || detail;

  if(!list || !listing || !detail || !detailTarget) return;

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
      <a class="card-link" href="${page}?id=${encodeURIComponent(item.id)}">
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
    const items = data.filter(item => filter === '전체' || item.category === filter);
    list.innerHTML = items.length
      ? items.map(card).join('')
      : '<p class="listing-empty">선택한 분류의 게시물이 없습니다.</p>';
    setFilterState(filter);
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
    document.title = `글을 찾을 수 없습니다 | 태장`;
    detailTarget.innerHTML = `<article class="article article-empty">
      <h1>요청한 글을 찾을 수 없습니다</h1>
      <p>주소가 변경되었거나 존재하지 않는 게시물입니다.</p>
      <a class="btn line" href="${page}">목록으로 돌아가기</a>
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
  const body = item.body.map((paragraph, index) => {
    const heading = index === 1 && item.bodyHeading ? `<h2>${item.bodyHeading}</h2>` : '';
    return `${heading}<p>${paragraph}</p>`;
  }).join('');

  detailTarget.innerHTML = `<a class="back-link" href="${page}">← 목록으로 돌아가기</a>
    <article class="article">
      <header class="article-header">
        <div class="article-meta"><span class="tag">${item.category}</span><time datetime="${item.date}">${item.date}</time></div>
        <h1>${item.title}</h1>
        <p class="lead">${item.summary}</p>
      </header>
      <div class="article-body">${detailMedia}${body}${gallery}</div>
      <a class="back-link back-link--bottom" href="${page}">← 목록으로 돌아가기</a>
    </article>`;
})();

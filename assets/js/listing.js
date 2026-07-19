
(function(){
  const type = document.body.dataset.contentType;
  const data = window.TAEJANG_CONTENT?.[type] || [];
  const list = document.querySelector('[data-list]');
  const filters = document.querySelector('[data-filters]');
  if(!list) return;

  function cardMedia(item){
    if(!item.thumb){
      return `<div class="card-media card-media--notice"><span class="tag">${item.category}</span><span class="notice-media-label">공식 공지</span></div>`;
    }
    return `<div class="card-media">
      <span class="tag">${item.category}</span>
      <img src="${item.thumb}" alt="${item.alt?.thumb || item.title}" loading="lazy">
    </div>`;
  }

  function card(item){
    const page = type === 'workplace' ? 'workplace.html' : 'activities.html';
    return `
      <article class="card" data-category="${item.category}">
        <a href="${page}?id=${encodeURIComponent(item.id)}">
          ${cardMedia(item)}
          <div class="card-body">
            <div class="card-date">${item.date}</div>
            <h3>${item.title}</h3>
            <p>${item.summary}</p>
            <span class="text-link">글 읽기 →</span>
          </div>
        </a>
      </article>`;
  }

  function render(filter='전체'){
    list.innerHTML = data
      .filter(x => filter === '전체' || x.category === filter)
      .map(card).join('');
  }

  const categories = ['전체', ...new Set(data.map(x => x.category))];
  if(filters){
    filters.innerHTML = categories.map((cat,i) =>
      `<button class="filter-btn ${i===0?'active':''}" type="button" data-filter="${cat}">${cat}</button>`
    ).join('');
    filters.addEventListener('click', e => {
      const btn = e.target.closest('[data-filter]');
      if(!btn) return;
      filters.querySelectorAll('.filter-btn').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      render(btn.dataset.filter);
    });
  }
  render();

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const detail = document.querySelector('[data-detail]');
  const listing = document.querySelector('[data-listing]');
  if(id && detail && listing){
    const item = data.find(x => x.id === id);
    if(item){
      listing.hidden = true;
      detail.hidden = false;
      document.title = `${item.title} | 태장`;
      const detailTarget = detail.querySelector('.container') || detail;
      const detailMedia = item.hero
        ? `<figure>
              <img src="${item.hero}" alt="${item.alt?.hero || item.title}">
              <figcaption>${item.title}</figcaption>
            </figure>`
        : `<div class="article-notice-media" role="img" aria-label="${item.title} 공식 공지">
              <span>공식 공지</span>
              <strong>${item.title}</strong>
            </div>`;
      const gallery = item.gallery?.length
        ? `<div class="article-gallery">${item.gallery.map((src, index) => `<img src="${src}" alt="${item.alt?.gallery?.[index] || item.title}" loading="lazy">`).join('')}</div>`
        : '';
      detailTarget.innerHTML = `
        <a class="back-link" href="${type === 'workplace' ? 'workplace.html' : 'activities.html'}">← 목록으로 돌아가기</a>
        <article class="article">
          <header class="article-header">
            <div class="article-meta"><span class="tag">${item.category}</span><span>${item.date}</span></div>
            <h1>${item.title}</h1>
            <p class="lead">${item.summary}</p>
          </header>
          <div class="article-body">
            ${detailMedia}
            ${item.body.map((p,i) => i===1 ? `<h2>태장이 일하는 방식</h2><p>${p}</p>` : `<p>${p}</p>`).join('')}
            ${gallery}
          </div>
        </article>`;
    }
  }
})();

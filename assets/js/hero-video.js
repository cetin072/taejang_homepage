(function () {
  'use strict';

  function createPlayer(container) {
    const videoId = container.dataset.youtubeVideo;
    const title = container.dataset.youtubeTitle || 'YouTube video';
    if (!videoId) return;

    const iframe = document.createElement('iframe');
    iframe.className = 'hero-video-frame';
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&playsinline=1&rel=0`;
    iframe.title = title;
    iframe.loading = 'lazy';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; web-share';
    iframe.setAttribute('allowfullscreen', '');

    container.replaceChildren(iframe);
    container.classList.add('is-playing');
  }

  function restorePoster(container) {
    const iframe = container.querySelector('.hero-video-frame');
    if (!iframe) return;

    const videoId = container.dataset.youtubeVideo;
    const title = container.dataset.youtubeTitle || 'YouTube video';
    const poster = document.createElement('button');
    const thumbnail = document.createElement('img');
    const playIcon = document.createElement('span');

    poster.className = 'hero-video-poster';
    poster.type = 'button';
    poster.dataset.youtubePlay = '';
    poster.setAttribute('aria-label', `${title} 재생`);
    thumbnail.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
    thumbnail.alt = `${title} 썸네일`;
    thumbnail.loading = 'lazy';
    playIcon.className = 'hero-video-play';
    playIcon.setAttribute('aria-hidden', 'true');
    playIcon.textContent = '▶';
    poster.append(thumbnail, playIcon);

    container.replaceChildren(poster);
    container.classList.remove('is-playing');
  }

  function bindPlayButton(container) {
    const button = container.querySelector('[data-youtube-play]');
    if (!button || button.dataset.youtubePlayBound === 'true') return;

    button.dataset.youtubePlayBound = 'true';
    button.addEventListener('click', () => createPlayer(container), { once: true });
  }

  function setActiveSlide(slider, nextIndex) {
    const slides = Array.from(slider.querySelectorAll('[data-hero-video-slide]'));
    const indicators = Array.from(slider.querySelectorAll('[data-hero-video-indicator]'));
    if (!slides.length) return;

    const activeIndex = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const isActive = index === activeIndex;
      if (!isActive) restorePoster(slide);
      slide.hidden = !isActive;
      slide.setAttribute('aria-hidden', String(!isActive));
      if (isActive) bindPlayButton(slide);
    });

    indicators.forEach((indicator, index) => {
      indicator.setAttribute('aria-current', String(index === activeIndex));
    });
    slider.dataset.heroVideoActive = String(activeIndex);
  }

  document.querySelectorAll('[data-hero-video-slider]').forEach((slider) => {
    const slides = Array.from(slider.querySelectorAll('[data-hero-video-slide]'));
    if (!slides.length) return;

    let startX = null;
    const activeIndex = () => Number(slider.dataset.heroVideoActive || 0);
    const move = direction => setActiveSlide(slider, activeIndex() + direction);

    slider.querySelector('[data-hero-video-previous]')?.addEventListener('click', () => move(-1));
    slider.querySelector('[data-hero-video-next]')?.addEventListener('click', () => move(1));
    slider.querySelectorAll('[data-hero-video-indicator]').forEach((indicator) => {
      indicator.addEventListener('click', () => setActiveSlide(slider, Number(indicator.dataset.heroVideoIndicator)));
    });

    slider.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        move(1);
      }
    });

    slider.addEventListener('touchstart', (event) => {
      startX = event.changedTouches[0]?.clientX ?? null;
    }, { passive: true });
    slider.addEventListener('touchend', (event) => {
      const endX = event.changedTouches[0]?.clientX;
      if (startX === null || typeof endX !== 'number') return;
      const distance = endX - startX;
      startX = null;
      if (Math.abs(distance) < 40) return;
      move(distance > 0 ? -1 : 1);
    }, { passive: true });

    setActiveSlide(slider, activeIndex());
  });
}());

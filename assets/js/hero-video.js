(function () {
  'use strict';

  document.querySelectorAll('[data-youtube-video]').forEach((container) => {
    const button = container.querySelector('[data-youtube-play]');
    if (!button) return;

    button.addEventListener('click', () => {
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
    });
  });
}());

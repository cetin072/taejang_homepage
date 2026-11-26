/* Employee landing only. Static HTML owns every word; motion is optional. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reduce.matches;
  const cleanups = [];
  function setupCard(root) {
    const inner = root.querySelector('.employee-app-flip-inner');
    const face = root.querySelector('.employee-app-flip');
    const controls = root.querySelector('[data-card-controls]');
    const compare = controls.querySelector('[data-card-compare]');
    let animation = null, played = false, cardVisible = false;
    function staticView() {
      animation?.cancel(); animation = null;
      root.classList.remove('is-flipping', 'is-after');
      root.dataset.state = 'comparison'; compare.textContent = '두 내용 함께 보기';
      controls.hidden = reducedMotion;
    }
    function finish() {
      root.classList.add('is-after'); animation?.cancel(); animation = null;
      root.dataset.state = 'ended';
    }
    function play() {
      if (reducedMotion) return staticView();
      staticView(); played = true; root.classList.add('is-flipping');
      root.dataset.state = 'playing';
      animation = inner.animate([
        { transform: 'rotateY(0deg)', offset: 0 },
        { transform: 'rotateY(0deg)', offset: 2000 / 3000, easing: 'cubic-bezier(.45,0,.2,1)' },
        { transform: 'rotateY(180deg)', offset: 1 }
      ], { duration: 3000, easing: 'linear' });
      animation.onfinish = finish;
    }
    controls.querySelector('[data-card-replay]').addEventListener('click', play);
    compare.addEventListener('click', () => { played = true; staticView(); });
    // Trigger only when the actual card, not the earlier section heading,
    // is substantially in view. Tall cards still work with text zoom.
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      const visibleHeight = entry.intersectionRect.height;
      const requiredHeight = Math.min(entry.boundingClientRect.height * .6, innerHeight * .38);
      cardVisible = entry.isIntersecting && visibleHeight >= requiredHeight;
      if (!cardVisible || document.hidden || reducedMotion) {
        if (animation?.playState === 'running') {
          animation.pause();
          root.dataset.state = 'paused';
        }
      } else if (animation?.playState === 'paused') {
        animation.play();
        root.dataset.state = 'playing';
      } else if (!played) {
        play();
      }
    }, { threshold: [0, .15, .3, .45, .6, .75, 1], rootMargin: '0px 0px -12% 0px' });
    staticView();
    // Reserve both faces' maximum height before they enter the viewport.
    if (!reducedMotion) root.classList.add('is-flipping');
    observer.observe(face);
    cleanups.push(() => { played = true; staticView(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && animation?.playState === 'running') {
        animation.pause();
        root.dataset.state = 'paused';
      } else if (!document.hidden && cardVisible && animation?.playState === 'paused' && !reducedMotion) {
        animation.play();
        root.dataset.state = 'playing';
      }
    });
  }
  try {
    document.querySelectorAll('[data-comparison]').forEach(setupCard);
    reduce.addEventListener('change', event => {
      reducedMotion = event.matches;
      cleanups.forEach(reset => reset());
    });
    window.addEventListener('beforeprint', () => cleanups.forEach(reset => reset()));
  } catch (error) {
    cleanups.forEach(reset => reset());
    document.querySelectorAll('[data-comparison]').forEach(root => root.classList.remove('is-flipping', 'is-after'));
    document.querySelectorAll('.employee-app-motion-controls').forEach(el => { el.hidden = true; });
    console.error('직원앱 개선 기록을 정적으로 표시합니다.', error);
  }
})();

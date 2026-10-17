/* Employee landing only. Static HTML owns every word; motion is optional. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const cleanups = [];
  const hero = document.querySelector('[data-hero-motion]');
  if (!hero) return;
  function setupHero() {
    const root = hero;
    const byId = id => root.querySelector('#' + id);
    const line = byId('hero-record-line'), bridge = byId('hero-record-bridge');
    const check = byId('hero-card-check'), card = byId('hero-arrival-surface'), clock = byId('hero-clock-face');
    const controls = root.querySelector('[data-hero-controls]');
    const pauseButton = controls.querySelector('[data-hero-pause]');
    const duration = 5200;
    let time = duration, start = 0, raf = null, played = false;
    /* V2.1 render function inserted below; timings and paths preserved. */
  const bounded = x => Math.max(0, Math.min(1, x));
  const progress = (t, a, b) => bounded((t - a) / (b - a));
  const land = t => 1 - (1 - t) ** 3;
  const glide = t => t * t * (3 - 2 * t);
  const from = [[275, 163], [275, 189], [295, 202]];
  const to = [[253, 190], [269, 205], [300, 169]];
  function render(ms) {
    time = Math.max(0, Math.min(duration, ms));
    const p = land(progress(time, 600, 1900));
    const angle = time < 600 ? 8 * Math.sin(Math.PI * time / 600) : 0;
    const points = from.map((pt, i) => pt.map((n, axis) => n + (to[i][axis] - n) * p));
    line.setAttribute('d', points.map((pt, i) => (i ? 'L' : 'M') + pt.map(n => n.toFixed(3)).join(' ')).join(' '));
    line.setAttribute('transform', `rotate(${angle.toFixed(3)} 275 189)`);
    const travel = glide(progress(time, 2300, 3200));
    const clear = land(progress(time, 4000, 4700));
    bridge.style.strokeDashoffset = String(1 - travel);
    bridge.style.opacity = String(time >= 2300 ? 1 - clear : 0);
    check.style.strokeDashoffset = String(1 - land(progress(time, 3200, 3900)));
    const active = glide(progress(time, 3000, 3400)) * (1 - clear);
    card.style.stroke = active > .001 ? `rgb(${Math.round(221-176*active)},${Math.round(216-110*active)},${Math.round(206-127*active)})` : '#DDD8CE';
    // Confirmation remains visible; focus passes to the completed attendance card.
    const handoff = glide(progress(time, 3100, 3900));
    line.style.stroke = 'rgb(' + [27,67,50].map((n,i)=>Math.round(n+([104,128,113][i]-n)*handoff)).join(',') + ')';
    line.style.strokeWidth = String(5 - 1.5 * handoff);
    clock.style.stroke = 'rgb(' + [27,67,50].map((n,i)=>Math.round(n+([104,128,113][i]-n)*handoff)).join(',') + ')';
    root.dataset.time = String(Math.round(time));
    root.dataset.frame = time === duration ? 'end' : 'motion';
  }

    const stop = () => { cancelAnimationFrame(raf); raf = null; };
    function finish() {
      stop(); render(duration); root.dataset.state = 'ended';
      pauseButton.disabled = true; pauseButton.textContent = '일시정지';
      controls.hidden = reduce.matches;
    }
    function tick(now) {
      render(now - start);
      if (time >= duration) return finish();
      raf = requestAnimationFrame(tick);
    }
    function play(reset) {
      if (reduce.matches) return finish();
      stop(); if (reset) render(0);
      played = true; start = performance.now() - time;
      root.dataset.state = 'playing'; pauseButton.disabled = false;
      pauseButton.textContent = '일시정지'; raf = requestAnimationFrame(tick);
    }
    function pause() {
      if (root.dataset.state !== 'playing') return;
      stop(); root.dataset.state = 'paused'; pauseButton.textContent = '계속 재생';
    }
    pauseButton.addEventListener('click', () => root.dataset.state === 'playing' ? pause() : play(false));
    controls.querySelector('[data-hero-replay]').addEventListener('click', () => play(true));
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !played && !reduce.matches) play(true);
      else if (!entries[0].isIntersecting) pause();
    }, { threshold: .25 });
    render(duration); finish(); observer.observe(root);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    cleanups.push(() => { played = true; finish(); });
  }
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
      controls.hidden = reduce.matches;
    }
    function finish() {
      root.classList.add('is-after'); animation?.cancel(); animation = null;
      root.dataset.state = 'ended';
    }
    function play() {
      if (reduce.matches) return staticView();
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
      if (!cardVisible || document.hidden || reduce.matches) {
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
    if (!reduce.matches) root.classList.add('is-flipping');
    observer.observe(face);
    cleanups.push(() => { played = true; staticView(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && animation?.playState === 'running') {
        animation.pause();
        root.dataset.state = 'paused';
      } else if (!document.hidden && cardVisible && animation?.playState === 'paused' && !reduce.matches) {
        animation.play();
        root.dataset.state = 'playing';
      }
    });
  }
  try {
    setupHero();
    document.querySelectorAll('[data-comparison]').forEach(setupCard);
    reduce.addEventListener('change', () => cleanups.forEach(reset => reset()));
    window.addEventListener('beforeprint', () => cleanups.forEach(reset => reset()));
  } catch (error) {
    cleanups.forEach(reset => reset());
    document.querySelectorAll('[data-comparison]').forEach(root => root.classList.remove('is-flipping', 'is-after'));
    document.querySelectorAll('.employee-app-motion-controls').forEach(el => { el.hidden = true; });
    console.error('직원앱 안내 그림은 정적으로 표시합니다.', error);
  }
})();

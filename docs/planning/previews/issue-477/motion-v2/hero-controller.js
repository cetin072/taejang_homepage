/* Local design study only. Original SVG is the complete static fallback. */
(() => {
  'use strict';
  const root = document.querySelector('[data-hero-study]');
  if (!root) return;
  const byId = id => root.querySelector('#' + id);
  const line = byId('hero-record-line');
  const bridge = byId('hero-record-bridge');
  const check = byId('hero-card-check');
  const card = byId('hero-arrival-surface');
  const clock = byId('hero-clock-face');
  const status = document.querySelector('[data-study-status]');
  const controls = [...document.querySelectorAll('[data-study-action]')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const duration = 6800;
  let time = duration, start = 0, raf = null, state = 'static', hasStarted = false;
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
    const clear = land(progress(time, 4800, 5800));
    bridge.style.strokeDashoffset = String(1 - travel);
    bridge.style.opacity = String(time >= 2300 ? 1 - clear : 0);
    check.style.strokeDashoffset = String(1 - land(progress(time, 3200, 3900)));
    const active = glide(progress(time, 3000, 3400)) * (1 - clear);
    card.style.stroke = active > .001 ? `rgb(${Math.round(221-176*active)},${Math.round(216-110*active)},${Math.round(206-127*active)})` : '#DDD8CE';
    clock.style.stroke = '#1B4332';
    root.dataset.time = String(Math.round(time));
    root.dataset.frame = time === duration ? 'end' : 'motion';
  }
  function stop() { if (raf !== null) cancelAnimationFrame(raf); raf = null; }
  function announce(text) { status.textContent = text; }
  function updateControls() {
    const unavailable = reduce.matches || new URLSearchParams(location.search).get('motion') === 'static';
    controls.forEach(button => {
      const action = button.dataset.studyAction;
      button.disabled = unavailable || (action === 'pause' && state !== 'playing') || (action === 'play' && (state === 'playing' || time >= duration));
      if (action === 'play' || action === 'pause') button.setAttribute('aria-pressed', String(action === 'play' ? state === 'playing' : state === 'paused'));
    });
    document.querySelector('[data-study-controls]').hidden = unavailable;
    root.dataset.state = state;
  }
  function finish(reason = '한 번 재생을 마쳤습니다. 전체 그림을 읽을 수 있습니다.') {
    stop(); render(duration); state = 'ended'; updateControls(); announce(reason);
  }
  function tick(now) {
    render(now - start);
    if (time >= duration) { finish(); return; }
    raf = requestAnimationFrame(tick);
  }
  function play(reset = false) {
    if (reduce.matches) return finish('모션 감소 설정으로 완성된 그림을 표시합니다.');
    stop();
    if (reset || time >= duration) render(0);
    hasStarted = true; state = 'playing'; start = performance.now() - time;
    updateControls(); announce(reset ? '처음부터 다시 재생합니다.' : '모션을 재생합니다.');
    raf = requestAnimationFrame(tick);
  }
  function pause(reason = '일시정지했습니다.') {
    if (state !== 'playing') return;
    stop(); state = 'paused'; updateControls(); announce(reason);
  }
  function seek(ms) {
    if (!Number.isFinite(ms) || ms < 0 || ms > duration) throw new RangeError('frame outside 0–6800 ms');
    if (reduce.matches) return finish('모션 감소 설정으로 완성된 그림을 표시합니다.');
    stop(); render(ms); state = ms === duration ? 'ended' : 'paused'; hasStarted = true;
    updateControls(); announce(`비교용 ${Math.round(ms / duration * 100)}% 프레임입니다.`);
  }
  try {
    controls.forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.studyAction;
      if (action === 'play') play();
      else if (action === 'pause') pause();
      else if (action === 'replay') play(true);
      else seek(Number(action));
    }));
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause('탭이 숨겨져 일시정지했습니다.'); });
    window.addEventListener('beforeprint', () => finish('인쇄용 완성 그림을 표시합니다.'));
    reduce.addEventListener('change', () => {
      if (reduce.matches) finish('모션 감소 설정으로 완성된 그림을 표시합니다.');
      else { state = 'ended'; updateControls(); announce('다시 보기를 누르면 재생합니다.'); }
    });
    const query = new URLSearchParams(location.search);
    const explicitStatic = query.get('motion') === 'static';
    let allowAuto = false;
    const frame = query.get('at');
    render(duration);
    root.classList.add('motion-ready');
    document.querySelector('[data-study-controls]').hidden = false;
    if (reduce.matches || explicitStatic) {
      state = 'ended'; updateControls(); announce('완성된 정적 그림을 표시합니다.');
    } else if (query.get('motion') === 'frame' && /^\d+$/.test(frame || '') && Number(frame) <= duration) {
      seek(Number(frame));
    } else if (query.get('motion') === 'manual') {
      seek(0); announce('재생을 누르면 시안이 시작됩니다.');
    } else {
      state = 'ready'; time = 0; updateControls();
      allowAuto = true;
    }
    const observer = new IntersectionObserver(entries => {
      const visible = entries[0].isIntersecting;
      if (visible && allowAuto && !hasStarted) play(true);
      else if (!visible) pause('그림이 화면 밖으로 나가 일시정지했습니다.');
    }, {threshold: .25});
    observer.observe(root);
    window.TaejangHeroStudy = {duration, seek, play, pause, finish,
      inspect: () => ({time, state, scheduledFrames: raf === null ? 0 : 1, hasStarted})};
  } catch (error) {
    stop(); render(duration); state = 'error';
    document.querySelector('[data-study-controls]').hidden = true;
    announce('완성된 그림을 표시합니다.');
    console.error(error);
  }
})();

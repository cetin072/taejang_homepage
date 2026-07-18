
(function(){
  const menuBtn = document.querySelector('[data-menu-button]');
  const mobileNav = document.querySelector('[data-mobile-nav]');
  if(menuBtn && mobileNav){
    menuBtn.addEventListener('click', function(){
      const open = mobileNav.classList.toggle('open');
      document.body.classList.toggle('nav-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', function(){
      mobileNav.classList.remove('open');
      document.body.classList.remove('nav-open');
      menuBtn.setAttribute('aria-expanded','false');
    }));
  }

  document.querySelectorAll('[data-faq-button]').forEach(btn => {
    btn.addEventListener('click', function(){
      const item = btn.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(x => {
        x.classList.remove('open');
        const q = x.querySelector('[data-faq-button]');
        if(q) q.setAttribute('aria-expanded','false');
      });
      if(!wasOpen){
        item.classList.add('open');
        btn.setAttribute('aria-expanded','true');
      }
    });
  });

  const year = document.querySelector('[data-current-year]');
  if(year) year.textContent = new Date().getFullYear();

  const slider = document.querySelector('[data-hero-slider]');
  if(slider){
    const slides = Array.from(slider.querySelectorAll('.hero-slide'));
    const dots = Array.from(document.querySelectorAll('[data-hero-dot]'));
    const prev = document.querySelector('[data-hero-prev]');
    const next = document.querySelector('[data-hero-next]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let index = 0;
    let timer = null;

    function showSlide(nextIndex){
      index = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, i) => slide.classList.toggle('active', i === index));
      dots.forEach((dot, i) => {
        const active = i === index;
        dot.classList.toggle('active', active);
        dot.setAttribute('aria-selected', String(active));
      });
    }

    function stopAuto(){
      if(timer){
        clearInterval(timer);
        timer = null;
      }
    }

    function startAuto(){
      stopAuto();
      if(!reduceMotion){
        timer = setInterval(() => showSlide(index + 1), 6000);
      }
    }

    prev?.addEventListener('click', () => {
      showSlide(index - 1);
      startAuto();
    });

    next?.addEventListener('click', () => {
      showSlide(index + 1);
      startAuto();
    });

    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        showSlide(Number(dot.dataset.heroDot));
        startAuto();
      });
    });

    const hero = slider.closest('.hero-slider');
    hero?.addEventListener('mouseenter', stopAuto);
    hero?.addEventListener('mouseleave', startAuto);
    hero?.addEventListener('focusin', stopAuto);
    hero?.addEventListener('focusout', startAuto);

    showSlide(0);
    startAuto();
  }

})();

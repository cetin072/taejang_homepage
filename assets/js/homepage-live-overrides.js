(function () {
  'use strict';

  // Legacy home-only targets remain as a compatibility fallback for existing
  // overrides created before the Issue #146 slot registry existed.
  const LEGACY_TEXT_TARGETS = {
    'home.hero.title': '#hero-title',
    'home.hero.intro': '.hero-content > p:not(.hero-kicker)',
    'home.about.title': '#about-title',
    'home.about.intro': '#about .about-intro > p',
    'home.business.title': '#business-title',
    'home.business.intro': '#business .business-section-lead',
    'home.workplace.title': '#workplace-title',
    'home.workplace.intro': '.workplace-bridge .lead',
    'home.partnership.title': '#partnership-title',
    'home.partnership.intro': '.partnership-overview .lead',
    'home.contact.title': '#contact-title',
    'home.contact.intro': '#contact .contact-direct > .lead'
  };

  const LEGACY_LINK_TARGETS = {
    'home.hero.primary_link': { selector: '.hero-actions .hero-primary', arrow: false },
    'home.hero.secondary_link': { selector: '.hero-actions .hero-secondary', arrow: false },
    'home.about.link': { selector: '#about .text-link', arrow: true },
    'home.business.link': { selector: '#business .section-head .text-link', arrow: true },
    'home.workplace.link': { selector: '.workplace-bridge .workplace-link', arrow: false },
    'home.partnership.link': { selector: '.partnership-overview .partnership-overview-cta a', arrow: false }
  };

  const LEGACY_IMAGE_TARGETS = {
    'home.photo.02': '02',
    'home.photo.03': '03',
    'home.photo.04': '04',
    'home.photo.05': '05',
    'home.photo.06': '06'
  };

  function currentPageName() {
    const page = window.location.pathname.split('/').filter(Boolean).pop() || 'index.html';
    return page.endsWith('.html') ? page : 'index.html';
  }

  function setText(target, value) {
    if (!target || typeof value !== 'string') return false;
    const parts = value.split(/\r?\n/);
    target.replaceChildren();
    parts.forEach((part, index) => {
      if (index) target.append(document.createElement('br'));
      target.append(document.createTextNode(part));
    });
    return true;
  }

  function registeredTarget(item) {
    if (!item?.registered || typeof item.selector !== 'string' || typeof item.public_path !== 'string') return null;
    if (item.public_path !== currentPageName()) return null;
    try {
      const target = document.querySelector(item.selector);
      if (target) target.dataset.homepageLiveSlot = item.slot_key;
      return target;
    } catch {
      return null;
    }
  }

  function applyRegisteredText(item) {
    const target = registeredTarget(item);
    return setText(target, item.text_value || '');
  }

  function applyRegisteredImage(item) {
    const target = registeredTarget(item);
    if (!target || typeof item.image_url !== 'string') return false;
    if (target instanceof HTMLImageElement) {
      target.src = item.image_url;
      target.alt = item.image_alt || target.alt || '태장 홈페이지 사진';
      const slot = target.closest('[data-photo-slot]');
      if (slot) {
        slot.classList.add('photo-slot--has-image');
        slot.dataset.photoState = 'ready';
        slot.removeAttribute('role');
        slot.removeAttribute('aria-label');
      }
      return true;
    }
    return false;
  }

  function applyLegacyText(item) {
    const selector = LEGACY_TEXT_TARGETS[item.slot_key];
    if (!selector || currentPageName() !== 'index.html') return;
    setText(document.querySelector(selector), item.text_value || '');
  }

  function applyLegacyLink(item) {
    const config = LEGACY_LINK_TARGETS[item.slot_key];
    if (!config || currentPageName() !== 'index.html' || typeof item.link_url !== 'string' || typeof item.link_label !== 'string') return;
    const target = document.querySelector(config.selector);
    if (!target) return;
    target.href = item.link_url;
    target.replaceChildren(document.createTextNode(item.link_label));
    if (config.arrow) {
      target.append(document.createTextNode(' '));
      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      target.append(arrow);
    }
  }

  function applyLegacyImage(item) {
    const number = LEGACY_IMAGE_TARGETS[item.slot_key];
    if (!number || currentPageName() !== 'index.html' || typeof item.image_url !== 'string') return;
    const slot = document.querySelector(`[data-photo-slot="${number}"]`);
    if (!slot) return;
    let image = slot.querySelector(':scope > img');
    if (!image) {
      image = document.createElement('img');
      image.decoding = 'async';
      image.loading = 'lazy';
      slot.prepend(image);
    }
    image.src = item.image_url;
    image.alt = item.image_alt || `태장 홈페이지 사진 ${number}`;
    slot.classList.add('photo-slot--has-image');
    slot.dataset.photoState = 'ready';
    slot.removeAttribute('role');
    slot.removeAttribute('aria-label');
  }

  function apply(items) {
    (Array.isArray(items) ? items : []).forEach(item => {
      if (!item || typeof item.slot_key !== 'string') return;

      if (item.slot_kind === 'text') {
        if (!applyRegisteredText(item)) applyLegacyText(item);
        return;
      }
      if (item.slot_kind === 'image') {
        if (!applyRegisteredImage(item)) applyLegacyImage(item);
        return;
      }
      if (item.slot_kind === 'link') applyLegacyLink(item);
    });
  }

  async function load() {
    try {
      const response = await fetch('/.netlify/functions/public-homepage-overrides', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      apply(payload?.items);
    } catch {
      // Static homepage remains the fallback if Supabase/Netlify live content is unavailable.
    }
  }

  load();
}());

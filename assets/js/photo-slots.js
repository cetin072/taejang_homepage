(function () {
  'use strict';

  /*
   * 검수 중에는 true를 유지합니다.
   * 공식 공개 직전에 false로 바꾸면 실제 사진 위의 PHOTO 번호가 숨겨집니다.
   */
  const PHOTO_REVIEW_MODE = false;
  const PHOTO_BASE_PATH = 'images/homepage/';

  /*
   * 최종 WebP 파일을 images/homepage/에 넣은 뒤 해당 슬롯의 enabled만 true로 바꿉니다.
   * objectPosition은 PC, mobileObjectPosition은 760px 이하 화면의 크롭 기준입니다.
   */
  const PHOTO_SLOTS = {
    '01': {
      file: 'photo-01.webp',
      enabled: true,
      alt: '태장 직원과 작업 현장이 함께 보이는 사업장 전경',
      objectPosition: 'center 50%',
      mobileObjectPosition: 'center 50%',
      priority: true
    },
    '02': {
      file: 'photo-02.webp',
      enabled: true,
      alt: '잉어 민화 도안을 채색하는 작업자와 물감 팔레트',
      objectPosition: 'center center',
      mobileObjectPosition: 'center center'
    },
    '03': {
      file: 'photo-03.webp',
      enabled: true,
      alt: '울타리 옆에서 집게와 봉투로 환경정비 활동을 하는 작업자',
      objectPosition: 'center center',
      mobileObjectPosition: 'center center'
    },
    '04': {
      file: 'photo-04.webp',
      enabled: true,
      alt: '상자를 조립하고 포장 테이프 작업을 하는 두 작업자',
      objectPosition: 'center center',
      mobileObjectPosition: 'center center'
    },
    '05': {
      file: 'photo-05.webp',
      enabled: true,
      alt: '상자 포장 작업에 집중하는 작업자와 포장 자재',
      objectPosition: 'center center',
      mobileObjectPosition: 'center center'
    },
    '06': {
      file: 'photo-06.webp',
      enabled: true,
      alt: '상자를 접고 테이프로 포장하는 작업자의 손',
      objectPosition: 'center center',
      mobileObjectPosition: 'center center'
    },
    '07': {
      file: 'photo-07.webp',
      enabled: true,
      alt: '태장 회사소개를 위한 사업장 또는 구성원 전경',
      objectPosition: '50% 50%',
      mobileObjectPosition: '50% 50%'
    },
    '08': {
      file: 'photo-08.webp',
      enabled: true,
      alt: '농업회사법인 태장 주식회사 대표이사 이영희',
      objectPosition: '50% 42%',
      mobileObjectPosition: '50% 38%'
    }
  };

  window.TAEJANG_PHOTO_SETTINGS = {
    reviewMode: PHOTO_REVIEW_MODE,
    basePath: PHOTO_BASE_PATH,
    slots: PHOTO_SLOTS
  };

  const root = document.documentElement;
  root.classList.remove('photo-review-mode', 'photo-public-mode');
  root.classList.add(PHOTO_REVIEW_MODE ? 'photo-review-mode' : 'photo-public-mode');

  document.querySelectorAll('[data-photo-slot]').forEach((slot) => {
    const number = String(slot.dataset.photoSlot || '').padStart(2, '0');
    const config = PHOTO_SLOTS[number];
    if (!config) return;

    slot.dataset.photoSlot = number;
    slot.dataset.photoState = config.enabled ? 'loading' : 'empty';
    slot.style.setProperty('--photo-position-desktop', config.objectPosition || 'center center');
    slot.style.setProperty('--photo-position-mobile', config.mobileObjectPosition || config.objectPosition || 'center center');

    if (!config.enabled) return;

    const existingImage = slot.querySelector(':scope > img');
    if (existingImage) {
      slot.classList.add('photo-slot--has-image');
      slot.dataset.photoState = 'ready';
      slot.removeAttribute('role');
      slot.removeAttribute('aria-label');
      return;
    }

    const image = document.createElement('img');
    image.alt = config.alt;
    image.decoding = 'async';
    image.loading = config.priority ? 'eager' : 'lazy';
    if (config.priority) image.setAttribute('fetchpriority', 'high');

    const fallbackLabel = slot.getAttribute('aria-label') || `PHOTO ${number}`;
    image.addEventListener('load', () => {
      slot.classList.add('photo-slot--has-image');
      slot.dataset.photoState = 'ready';
      slot.removeAttribute('role');
      slot.removeAttribute('aria-label');
    });
    image.addEventListener('error', () => {
      image.remove();
      slot.classList.remove('photo-slot--has-image');
      slot.dataset.photoState = 'missing';
      slot.setAttribute('role', 'img');
      slot.setAttribute('aria-label', `${fallbackLabel} — 이미지 파일을 확인해 주세요`);
    });

    image.src = `${PHOTO_BASE_PATH}${config.file}`;
    slot.prepend(image);
  });
}());

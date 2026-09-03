(() => {
  'use strict';

  let deferredPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  function ensureManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '../staff/manifest.webmanifest';
    document.head.append(link);
  }

  async function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    try { await navigator.serviceWorker.register('../sw.js', { scope: '/' }); } catch { /* web app remains usable */ }
  }

  function makeInstallCard() {
    if (isStandalone()) return null;
    const card = document.createElement('section');
    card.className = 'worker-install-card';
    card.dataset.workerInstallCard = '1';

    const title = document.createElement('h2');
    title.textContent = '태장 업무앱 설치';
    const copy = document.createElement('p');
    copy.textContent = '휴대폰 홈 화면에 태장 아이콘을 만들면 다음부터 아이콘만 누르면 됩니다.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'worker-primary-button';

    if (isIos()) {
      button.textContent = '설치 방법 보기';
      button.addEventListener('click', () => {
        copy.textContent = '아래 공유 버튼 → 홈 화면에 추가 → 추가 순서로 눌러주세요.';
        button.hidden = true;
      });
    } else {
      button.textContent = '휴대폰에 설치하기';
      button.addEventListener('click', async () => {
        if (!deferredPrompt) {
          copy.textContent = '브라우저 메뉴에서 홈 화면에 추가 또는 앱 설치를 눌러주세요.';
          return;
        }
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(() => null);
        deferredPrompt = null;
        if (isStandalone()) card.remove();
      });
    }

    card.append(title, copy, button);
    return card;
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    document.dispatchEvent(new CustomEvent('taejang-pwa-install-ready'));
  });
  window.addEventListener('appinstalled', () => document.querySelector('[data-worker-install-card]')?.remove());

  ensureManifest();
  registerWorker();
  window.TaejangPwaInstall = { makeInstallCard, isStandalone };
})();

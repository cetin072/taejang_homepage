(() => {
  'use strict';

  let deferredPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  function ensureStyles() {
    if (document.querySelector('style[data-pwa-install-card]')) return;
    const style = document.createElement('style');
    style.dataset.pwaInstallCard = '1';
    style.textContent = `
      .worker-install-card { background:#fff; border:1px solid #deded7; border-radius:20px; padding:20px; box-shadow:0 8px 26px rgba(0,0,0,.045); }
      .worker-install-card h2 { margin:0 0 10px; font-size:23px; line-height:1.3; }
      .worker-install-card p { font-size:18px; line-height:1.55; }
      .worker-primary-button { width:100%; min-height:68px; border-radius:16px; border:0; font:inherit; font-size:21px; font-weight:900; cursor:pointer; background:#173f31; color:#fff; }
      .worker-primary-button:disabled { opacity:.55; cursor:not-allowed; }
    `;
    document.head.append(style);
  }

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
    ensureStyles();
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

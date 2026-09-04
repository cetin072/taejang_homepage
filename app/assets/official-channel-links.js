(() => {
  'use strict';

  const ALLOWED_ROLES = new Set(['promotion_staff', 'promotion_lead', 'operations_manager']);
  const CHANNELS = [
    { id: 'homepage', label: '홈페이지', href: '../index.html' },
    { id: 'blog', label: '공식 블로그', href: 'https://blog.naver.com/taejang-official' },
    { id: 'youtube', label: '공식 유튜브', href: 'https://youtube.com/@taejangofficial' }
  ];

  const route = () => window.TaejangApp?.getRoute?.();

  function removeExisting(nav) {
    nav?.querySelectorAll?.('[data-official-channel-group], [data-official-channel-link]')?.forEach?.(node => node.remove());
  }

  function makeLink(channel) {
    const link = document.createElement('a');
    link.href = channel.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = channel.label;
    link.className = 'app-nav-official-channel';
    link.dataset.officialChannelLink = channel.id;
    link.dataset.channel = channel.id;
    link.setAttribute('aria-label', `${channel.label} 새 탭에서 열기`);
    return link;
  }

  function makeGroup() {
    const group = document.createElement('section');
    group.className = 'app-nav-channel-group';
    group.dataset.officialChannelGroup = '1';
    group.dataset.navSection = 'official_channels';
    group.setAttribute('aria-label', '공식 채널');

    const label = document.createElement('p');
    label.className = 'app-nav-group-label';
    label.textContent = '공식 채널';
    group.append(label);
    CHANNELS.forEach(channel => group.append(makeLink(channel)));
    return group;
  }

  function sync() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    removeExisting(nav);
    if (!ALLOWED_ROLES.has(route())) return;

    [...nav.children].forEach(node => {
      if ((node.textContent || '').trim() === '홈페이지' && node.tagName === 'A') node.remove();
    });
    nav.append(makeGroup());
  }

  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 120));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 120));

  const start = () => setTimeout(sync, 120);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangOfficialChannelLinks = { sync, CHANNELS, ALLOWED_ROLES };
})();

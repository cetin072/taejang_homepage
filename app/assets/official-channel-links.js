(() => {
  'use strict';

  const ALLOWED_ROLES = new Set(['promotion_staff', 'promotion_lead', 'operations_manager']);
  const CHANNELS = [
    {
      id: 'blog',
      label: '공식 블로그',
      href: 'https://blog.naver.com/taejang-official'
    },
    {
      id: 'youtube',
      label: '공식 유튜브',
      href: 'https://youtube.com/@taejangofficial'
    }
  ];

  const route = () => window.TaejangApp?.getRoute?.();

  function removeExisting(nav) {
    nav?.querySelectorAll?.('[data-official-channel-link]')?.forEach?.(node => node.remove());
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

  function sync() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    removeExisting(nav);
    if (!ALLOWED_ROLES.has(route())) return;
    CHANNELS.forEach(channel => nav.append(makeLink(channel)));
  }

  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 120));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 120));

  const start = () => setTimeout(sync, 120);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangOfficialChannelLinks = { sync, CHANNELS, ALLOWED_ROLES };
})();

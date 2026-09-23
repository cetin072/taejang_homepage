(() => {
  'use strict';

  const channels = () => window.TaejangOfficialChannels?.list || [];

  function menuKey(channel) {
    return `public.${channel.id}`;
  }

  function makeLink(channel) {
    const link = document.createElement('a');
    link.href = channel.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = channel.label;
    link.className = 'app-nav-item app-nav-official-channel';
    link.dataset.officialChannelLink = channel.id;
    link.dataset.channel = channel.id;
    link.dataset.menuKey = menuKey(channel);
    link.setAttribute('aria-label', `${channel.label} 새 탭에서 열기`);
    return link;
  }

  function sameLink(node, channel) {
    return node
      && node.dataset?.officialChannelLink === channel.id
      && node.dataset?.menuKey === menuKey(channel)
      && node.textContent?.trim() === channel.label
      && node.getAttribute?.('href') === channel.href;
  }

  function sync() {
    const nav = document.getElementById('app-nav');
    const expected = channels();
    if (!nav || !expected.length) return;

    nav.querySelectorAll(':scope > [data-official-channel-group]').forEach(node => node.remove());

    const existing = new Map(
      [...nav.querySelectorAll(':scope > [data-official-channel-link]')]
        .map(node => [node.dataset.officialChannelLink, node])
    );
    let changed = false;

    expected.forEach(channel => {
      let node = existing.get(channel.id);
      if (!sameLink(node, channel)) {
        const replacement = makeLink(channel);
        if (node) node.replaceWith(replacement);
        else nav.append(replacement);
        node = replacement;
        changed = true;
      }
      existing.delete(channel.id);
    });

    existing.forEach(node => {
      node.remove();
      changed = true;
    });

    if (changed) {
      window.TaejangRoleNavigationPriority?.schedule?.();
      document.dispatchEvent(new CustomEvent('taejang-official-channels-rendered'));
    }
  }

  document.addEventListener('taejang-official-channels-ready', () => queueMicrotask(sync));
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 0));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 0));

  const start = () => setTimeout(sync, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangOfficialChannelLinks = { sync, channels };
})();

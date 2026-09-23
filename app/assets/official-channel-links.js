(() => {
  'use strict';

  const channels = () => window.TaejangOfficialChannels?.list || [];

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
    channels().forEach(channel => group.append(makeLink(channel)));
    return group;
  }

  function reconcileGroup(group) {
    const expected = channels();
    if (!group || !expected.length) return false;
    const current = [...group.querySelectorAll(':scope > [data-official-channel-link]')];
    const same = current.length === expected.length && expected.every((channel, index) => {
      const node = current[index];
      return node?.dataset?.officialChannelLink === channel.id
        && node?.textContent?.trim() === channel.label
        && node?.getAttribute?.('href') === channel.href;
    });
    if (same) return false;

    const label = group.querySelector(':scope > .app-nav-group-label') || document.createElement('p');
    label.className = 'app-nav-group-label';
    label.textContent = '공식 채널';
    group.replaceChildren(label, ...expected.map(makeLink));
    return true;
  }

  function sync() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    [...nav.children].forEach(node => {
      if ((node.textContent || '').trim() === '홈페이지' && node.tagName === 'A' && !node.dataset.officialChannelLink) node.remove();
    });

    let group = nav.querySelector('[data-official-channel-group]');
    if (!group) {
      group = makeGroup();
      nav.append(group);
    }
    const changed = reconcileGroup(group);
    if (changed) document.dispatchEvent(new CustomEvent('taejang-official-channels-rendered'));
  }

  document.addEventListener('taejang-official-channels-ready', () => queueMicrotask(sync));
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 0));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 0));

  const start = () => setTimeout(sync, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangOfficialChannelLinks = { sync, channels };
})();
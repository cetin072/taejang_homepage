// Versioned article document. No HTML from stored/user content is trusted.
(function (root) {
  'use strict';
  const PREFIX = 'TAEJANG_ARTICLE_V1\n';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isRich = value => String(value || '').startsWith(PREFIX);
  function parse(value) {
    if (!isRich(value) || value.length > 30000) return null;
    try {
      const doc = JSON.parse(value.slice(PREFIX.length));
      const types = new Set(['doc','paragraph','heading','text','image','hardBreak','horizontalRule','blockquote','bulletList','orderedList','listItem']);
      function valid(node,depth=0) {
        return node && depth <= 30 && types.has(node.type)
          && (node.type !== 'text' || typeof node.text === 'string')
          && (node.content === undefined || Array.isArray(node.content) && node.content.every(child=>valid(child,depth+1)))
          && (node.marks === undefined || Array.isArray(node.marks))
          && (node.type !== 'image' || typeof node.attrs?.src === 'string');
      }
      return doc?.type === 'doc' && Array.isArray(doc.content) && valid(doc) ? doc : null;
    } catch { return null; }
  }
  function plain(value) {
    if (!isRich(value)) return String(value || '');
    const doc = parse(value);
    function text(node, depth = 0) {
      if (!node || depth > 30) return '';
      if (node.type === 'text') return String(node.text || '');
      if (node.type === 'image') return String(node.attrs?.alt || '') + '\n';
      if (node.type === 'hardBreak') return '\n';
      return (Array.isArray(node.content) ? node.content : []).map(n => text(n, depth + 1)).join('') + (['paragraph','heading','listItem'].includes(node.type) ? '\n' : '');
    }
    return doc ? text(doc).trim() : '';
  }
  function fromPlain(value) {
    return {type:'doc', content: String(value || '').split(/\n\s*\n/).map(paragraph => ({type:'paragraph', content: paragraph.split('\n').flatMap((line,i) => [...(i ? [{type:'hardBreak'}] : []), ...(line ? [{type:'text',text:line}] : [])])}))};
  }
  function safeLink(value) {
    try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
  }
  function render(item) {
    if (!isRich(item?.public_body)) return null;
    const doc = parse(item.public_body);
    if (!doc) return '<div class="taejang-article"><p>본문 형식을 확인할 수 없습니다.</p></div>';
    const allowed = new Set((Array.isArray(item.public_media) ? item.public_media : []).filter(entry => root.TAEJANG_PUBLIC_MEDIA?.persistent(entry?.url)).map(entry => entry.url));
    function node(n, depth = 0) {
      if (!n || depth > 30) return '';
      if (n.type === 'text') {
        let out = escape(n.text);
        for (const mark of Array.isArray(n.marks) ? n.marks : []) {
          if (mark.type === 'bold') out = '<strong>' + out + '</strong>';
          if (mark.type === 'italic') out = '<em>' + out + '</em>';
          if (mark.type === 'strike') out = '<s>' + out + '</s>';
          if (mark.type === 'underline') out = '<u>' + out + '</u>';
          if (mark.type === 'link' && safeLink(mark.attrs?.href)) out = '<a href="' + escape(safeLink(mark.attrs.href)) + '" target="_blank" rel="noopener noreferrer">' + out + '</a>';
        }
        return out;
      }
      if (n.type === 'image') {
        const url = n.attrs?.src;
        if (!allowed.has(url)) return '';
        const caption = String(n.attrs?.alt || '');
        return '<figure><img src="' + escape(url) + '" alt="' + escape(caption) + '" loading="lazy" decoding="async">' + (caption ? '<figcaption>' + escape(caption) + '</figcaption>' : '') + '</figure>';
      }
      if (n.type === 'hardBreak') return '<br>';
      if (n.type === 'horizontalRule') return '<hr>';
      const tags = {doc:'div', paragraph:'p', heading: n.attrs?.level === 3 ? 'h3' : 'h2', blockquote:'blockquote',bulletList:'ul',orderedList:'ol',listItem:'li'};
      const tag = tags[n.type];
      if (!tag) return '';
      return '<' + tag + '>' + (Array.isArray(n.content) ? n.content : []).map(c => node(c,depth+1)).join('') + '</' + tag + '>';
    }
    const body = node(doc);
    return '<div class="taejang-article">' + body + '</div>';
  }
  function renderDOM(item, document) {
    const html = render(item);
    if (html === null) return null;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html; // Only the strict node/attribute whitelist above creates HTML.
    return wrapper.firstElementChild;
  }
  root.TAEJANG_ARTICLE_DOCUMENT = Object.freeze({PREFIX,isRich,parse,plain,fromPlain,safeLink,render,renderDOM});
}(globalThis));

(() => {
  'use strict';
  const element = id => document.getElementById(id);
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value || '';
    return node;
  };
  const clear = id => element(id).replaceChildren();
  const message = (id, value, error = false) => {
    const target = element(id);
    target.textContent = value;
    target.classList.toggle('error', error);
    target.hidden = !value;
  };
  const imageOrNotice = (url, alt, emptyText) => {
    if (!url) return text('p', emptyText, 'image-notice');
    const image = document.createElement('img');
    image.src = url;
    image.alt = alt || '작업방법 이미지';
    image.className = 'guide-image';
    image.addEventListener('error', () => {
      image.replaceWith(text('p', '이미지를 불러오지 못했습니다. 글 안내를 확인하세요.', 'image-notice'));
    }, { once: true });
    return image;
  };
  window.TaejangAppUi = { element, text, clear, message, imageOrNotice };
})();

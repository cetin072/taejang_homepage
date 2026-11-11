/* Progressive enhancement only: portfolio links still reach the native inquiry form without JS. */
(() => {
  'use strict';
  const style = document.getElementById('terrarium-style-select');
  if (!style) return;

  document.querySelectorAll('[data-terrarium-style]').forEach(link => {
    link.addEventListener('click', () => {
      const requested = link.dataset.terrariumStyle;
      if ([...style.options].some(option => option.value === requested)) {
        style.value = requested;
      }
    });
  });
})();

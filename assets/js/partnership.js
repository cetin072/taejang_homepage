(function () {
  'use strict';

  const form = document.querySelector('form[name="taejang-inquiry"]');
  const type = form?.elements.namedItem('inquiry-type');
  if (!type) return;

  // Only the type changes. Keep every field, native validation and POST intact.
  document.querySelectorAll('[data-inquiry-type]').forEach(link => {
    link.addEventListener('click', () => {
      const requested = link.dataset.inquiryType;
      if ([...type.options].some(option => option.value === requested)) {
        type.value = requested;
      }
    });
  });

  // Progressive enhancement: without this script, every answer stays readable.
  document.body.classList.add('partnership-enhanced');
}());

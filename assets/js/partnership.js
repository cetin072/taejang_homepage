(function () {
  'use strict';

  const form = document.querySelector('form[name="taejang-inquiry"]');
  const type = form?.elements.namedItem('inquiry-type');
  if (!type) return;

  const recruitmentGuide = document.getElementById('partnership-inquiry-type-guide');
  function updateTypeGuide() {
    const recruitment = type.value === '채용·근무 문의';
    if (recruitmentGuide) recruitmentGuide.hidden = !recruitment;
    type.setAttribute('aria-describedby', recruitment
      ? 'partnership-required-guide partnership-inquiry-type-guide'
      : 'partnership-required-guide');
  }
  type.addEventListener('change', updateTypeGuide);
  // Restore the conditional hint when returning from a native form submission.
  window.addEventListener('pageshow', updateTypeGuide);
  updateTypeGuide();

  // Only the type changes. Keep every field, native validation and POST intact.
  document.querySelectorAll('[data-inquiry-type]').forEach(link => {
    link.addEventListener('click', () => {
      const requested = link.dataset.inquiryType;
      if ([...type.options].some(option => option.value === requested)) {
        type.value = requested;
        updateTypeGuide();
      }
    });
  });

  // Progressive enhancement: without this script, every answer stays readable.
  document.body.classList.add('partnership-enhanced');
}());

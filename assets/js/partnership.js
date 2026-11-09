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

  // The product landing links here without adding another form or submission path.
  // Whitelisted source only: never use URL input as free-form message content.
  if (new URLSearchParams(window.location.search).get('source') === 'new-zealand-salt') {
    const message = form.elements.namedItem('message');
    if (!type.value) type.value = '제품·행사 문의';
    if (message && !message.value.trim()) {
      message.value = '뉴질랜드 천일염(Grade 27 Fine Solar Salt) 구매·납품 문의\n희망 규격(10kg/25kg): \n예상 수량: \n희망 일정·수령 지역: ';
    }
  }

  // Progressive enhancement: without this script, every answer stays readable.
  document.body.classList.add('partnership-enhanced');
}());

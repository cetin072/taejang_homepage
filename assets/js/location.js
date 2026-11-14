(() => {
  const button = document.querySelector('[data-copy-address]');
  const address = document.getElementById('office-address');
  const status = document.querySelector('[data-copy-status]');
  if (!button || !address || !status) return;
  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = '';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(address.innerText.replace(/\s+/g, ' ').trim());
      status.textContent = '주소를 복사했습니다.';
    } catch {
      status.textContent = '복사하지 못했습니다. 위 주소를 길게 누르거나 선택해 복사해 주세요.';
    } finally {
      button.disabled = false;
    }
  });
})();

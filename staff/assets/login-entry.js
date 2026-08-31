(() => {
  'use strict';

  const startPanel = document.getElementById('start-panel');
  const loginButton = document.getElementById('show-login');
  if (!startPanel || !loginButton) return;

  const openLogin = () => {
    if (!startPanel.hidden) loginButton.click();
  };

  new MutationObserver(openLogin).observe(startPanel, {
    attributes: true,
    attributeFilter: ['hidden']
  });

  openLogin();
})();

(() => {
  'use strict';

  const panelIds = [
    'setup-panel', 'start-panel', 'login-panel', 'signup-panel', 'recovery-panel',
    'pending-panel', 'blocked-panel', 'unassigned-panel', 'issue-panel', 'admin-panel'
  ];
  const el = id => document.getElementById(id);

  function showOnly(id) {
    panelIds.forEach(panelId => {
      const panel = el(panelId);
      if (panel) panel.hidden = panelId !== id;
    });
  }

  function setMessage(text, error = false) {
    const target = el('message');
    if (!target) return;
    target.textContent = text;
    target.classList.toggle('error', error);
    target.hidden = !text;
  }

  function fieldError(form, text) {
    const input = form.elements.email;
    const target = el('recovery-email-error');
    input?.setAttribute('aria-invalid', 'true');
    if (target) {
      target.textContent = text;
      target.hidden = false;
    }
  }

  function clearError(form) {
    form.elements.email?.removeAttribute('aria-invalid');
    const target = el('recovery-email-error');
    if (target) {
      target.textContent = '';
      target.hidden = true;
    }
  }

  async function loadConfig() {
    if (window.TAEJANG_STAFF_CONFIG?.url && window.TAEJANG_STAFF_CONFIG?.publishableKey) {
      return window.TAEJANG_STAFF_CONFIG;
    }
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config?.url || !config?.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  function recoveryRedirectUrl() {
    return new URL('reset-password.html', window.location.href).href.split('#')[0];
  }

  async function sendRecovery(email) {
    const config = await loadConfig();
    const redirectTo = recoveryRedirectUrl();
    const response = await fetch(
      `${config.url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: 'POST',
        headers: {
          apikey: config.publishableKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      }
    );
    if (response.status === 429) throw new Error('RATE_LIMIT');
    if (!response.ok) throw new Error('RECOVERY_FAILED');
  }

  const openButton = el('show-recovery');
  const backButton = el('recovery-back');
  const form = el('recovery-form');

  openButton?.addEventListener('click', () => {
    setMessage('');
    showOnly('recovery-panel');
    form?.elements.email?.focus();
  });

  backButton?.addEventListener('click', () => {
    setMessage('');
    showOnly('login-panel');
    el('login-form')?.elements.email?.focus();
  });

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    clearError(form);
    setMessage('');
    const email = String(form.elements.email.value || '').trim();
    if (!email || !form.elements.email.validity.valid) {
      fieldError(form, '가입할 때 사용한 이메일 주소를 확인하세요.');
      form.elements.email.focus();
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await sendRecovery(email);
      form.reset();
      setMessage('등록된 계정이면 비밀번호 재설정 메일이 발송됩니다. 받은 편지함과 스팸함을 확인하세요.');
    } catch (error) {
      if (String(error?.message) === 'RATE_LIMIT') {
        setMessage('재설정 요청이 너무 많습니다. 잠시 후 다시 시도하세요.', true);
      } else {
        setMessage('재설정 요청을 처리하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.', true);
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  });
})();

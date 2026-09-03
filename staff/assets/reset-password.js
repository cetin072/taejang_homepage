(() => {
  'use strict';

  const el = id => document.getElementById(id);
  const panels = ['reset-loading', 'reset-form-panel', 'reset-success', 'reset-invalid'];
  let config = null;
  let recoveryToken = null;

  function show(id) {
    panels.forEach(panelId => {
      const panel = el(panelId);
      if (panel) panel.hidden = panelId !== id;
    });
  }

  function message(text, error = false) {
    const target = el('reset-message');
    if (!target) return;
    target.textContent = text;
    target.classList.toggle('error', error);
    target.hidden = !text;
  }

  async function loadConfig() {
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const payload = await response.json();
    if (!payload?.url || !payload?.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return payload;
  }

  function hashParams() {
    return new URLSearchParams(window.location.hash.replace(/^#/, ''));
  }

  async function verifyRecoveryToken(token) {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${token}`
      }
    });
    return response.ok;
  }

  async function updatePassword(password) {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${recoveryToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
    if (!response.ok) throw new Error('PASSWORD_UPDATE_FAILED');
  }

  async function bootstrap() {
    try {
      config = await loadConfig();
      const params = hashParams();
      const type = params.get('type');
      const token = params.get('access_token');
      if (type !== 'recovery' || !token) {
        show('reset-invalid');
        return;
      }
      if (!await verifyRecoveryToken(token)) {
        show('reset-invalid');
        return;
      }
      recoveryToken = token;
      show('reset-form-panel');
      el('reset-password-form')?.elements.password?.focus();
    } catch {
      message('비밀번호 재설정 화면을 준비하지 못했습니다. 잠시 후 다시 시도하세요.', true);
      show('reset-invalid');
    }
  }

  el('reset-password-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    message('');
    const form = event.currentTarget;
    const password = String(form.elements.password.value || '');
    const confirm = String(form.elements.password_confirm.value || '');
    if (password.length < 8) {
      message('새 비밀번호는 8자 이상 입력하세요.', true);
      form.elements.password.focus();
      return;
    }
    if (password !== confirm) {
      message('새 비밀번호가 서로 다릅니다.', true);
      form.elements.password_confirm.focus();
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await updatePassword(password);
      recoveryToken = null;
      window.history.replaceState(null, '', window.location.pathname);
      form.reset();
      message('');
      show('reset-success');
    } catch {
      message('비밀번호를 변경하지 못했습니다. 링크가 만료됐을 수 있으니 재설정 메일을 다시 요청하세요.', true);
      if (submit) submit.disabled = false;
    }
  });

  bootstrap();
})();

(() => {
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const rpc = (name, args) => window.TaejangApp.rpc(name, args);
  const button = (label, quiet = false) => {
    const control = node('button', label, quiet ? 'button button-quiet' : 'button');
    control.type = 'button';
    return control;
  };
  const field = (label, input) => {
    const wrapper = node('label');
    wrapper.append(node('span', label), input);
    return wrapper;
  };

  function mountSelf() {
    const mount = document.getElementById(window.TaejangApp.getRoute() === 'general_worker'
      ? 'worker-remote-work' : 'desktop-remote-work');
    if (!mount || mount.hasChildNodes()) return;
    const trigger = button('내 재택근무 주소', true);
    const dialog = node('dialog', null, 'employee-form');
    dialog.setAttribute('aria-label', '내 직원카드 재택근무 주소');
    const form = node('form', null, 'employee-form app-authoring');
    const address = node('input');
    address.required = true;
    address.minLength = 5;
    address.maxLength = 200;
    address.autocomplete = 'street-address';
    const feedback = node('p', null, 'help');
    feedback.setAttribute('role', 'status');
    const save = button('주소 저장');
    save.type = 'submit';
    const close = button('닫기', true);
    close.addEventListener('click', () => dialog.close());
    const actions = node('div', null, 'quick-links');
    actions.append(save, close);
    form.append(node('h2', '내 직원카드'), field('재택근무 주소', address), feedback, actions);
    dialog.append(form);
    document.body.append(dialog);
    const display = (result, saved) => {
      address.value = result.address || '';
      feedback.textContent = result.approved ? '본사와 이 주소에서 출퇴근할 수 있습니다.'
        : saved ? '주소를 저장했습니다. 운영총괄이 위치를 승인하면 사용할 수 있습니다.'
          : '주소를 등록하면 운영총괄이 위치를 확인합니다.';
    };
    trigger.addEventListener('click', async () => {
      address.value = '';
      feedback.textContent = '주소를 불러오고 있습니다.';
      address.disabled = save.disabled = true;
      dialog.showModal();
      try {
        display(await rpc('get_my_employee_remote_work_location'), false);
        address.disabled = save.disabled = false;
      } catch {
        feedback.textContent = '연결된 직원카드의 주소를 불러오지 못했습니다.';
      }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      address.disabled = save.disabled = close.disabled = true;
      try { display(await rpc('save_my_employee_remote_work_address', { p_address: address.value }), true); }
      catch { feedback.textContent = '주소를 저장하지 못했습니다. 다시 시도해 주세요.'; }
      finally { address.disabled = save.disabled = close.disabled = false; }
    });
    dialog.addEventListener('close', () => { address.value = ''; feedback.textContent = ''; });
    mount.append(trigger);
  }

  function adminPanel(employee) {
    const details = node('details', null, 'employee-profile-section employee-profile-fold employee-section-work');
    const body = node('div', null, 'employee-profile-fold-body');
    details.append(node('summary', '재택근무'), body);
    let generation = 0;
    async function load() {
      const attempt = ++generation;
      body.replaceChildren(node('p', '재택근무 설정을 불러오고 있습니다.', 'help'));
      try {
        const result = await rpc('get_employee_remote_work_location', { p_employee_uuid: employee.id });
        if (attempt === generation && details.open && details.isConnected) render(result);
      } catch {
        if (attempt === generation) body.replaceChildren(node('p', '재택근무 설정을 불러오지 못했습니다.', 'message error'));
      }
    }
    function render(result) {
      body.replaceChildren();
      if (!result.address) {
        body.append(node('p', '직원이 본인 직원카드에 주소를 등록하면 위치를 승인할 수 있습니다.', 'help'));
        return;
      }
      body.append(node('p', result.address), node('p', result.approved ? '재택 GPS 승인됨' : '재택 GPS 승인 대기', 'help'));
      const form = node('form', null, 'employee-form app-authoring');
      const map = node('a', '지도에서 주소 확인');
      map.href = 'https://map.naver.com/p/search/' + encodeURIComponent(result.address);
      map.target = '_blank';
      map.rel = 'noopener noreferrer';
      const latitude = node('input');
      const longitude = node('input');
      for (const [input, range] of [[latitude, 90], [longitude, 180]]) {
        input.type = 'number';
        input.step = 'any';
        input.min = -range;
        input.max = range;
        input.required = true;
      }
      const fields = node('div', null, 'employee-form-grid');
      fields.append(field('위도', latitude), field('경도', longitude));
      const save = button(result.approved ? '위치 다시 승인' : '재택근무 승인');
      save.type = 'submit';
      const revoke = button('재택근무 사용 중지', true);
      revoke.hidden = !result.approved;
      const feedback = node('p', null, 'help');
      feedback.setAttribute('role', 'status');
      const actions = node('div', null, 'quick-links');
      actions.append(save, revoke);
      const update = async enabled => {
        const attempt = generation;
        for (const control of [latitude, longitude, save, revoke]) control.disabled = true;
        try {
          const updated = await rpc('set_employee_remote_work_location', {
            p_employee_uuid: employee.id, p_revision: result.revision, p_enabled: enabled,
            p_latitude: enabled ? latitude.valueAsNumber : null,
            p_longitude: enabled ? longitude.valueAsNumber : null
          });
          if (attempt === generation && details.open && details.isConnected) render(updated);
        } catch {
          feedback.textContent = '저장하지 못했습니다. 주소를 다시 확인한 뒤 시도해 주세요.';
          for (const control of [latitude, longitude, save, revoke]) control.disabled = false;
        }
      };
      form.addEventListener('submit', event => { event.preventDefault(); void update(true); });
      revoke.addEventListener('click', () => { void update(false); });
      form.append(map, fields, actions, feedback);
      body.append(form);
    }
    details.addEventListener('toggle', () => {
      if (details.open) void load();
      else { generation++; body.replaceChildren(); }
    });
    return details;
  }

  document.addEventListener('taejang-app-ready', mountSelf);
  window.TaejangEmployeeRemoteWork = { adminPanel };
})();

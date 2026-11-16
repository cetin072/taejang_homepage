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

  function adminPanel(employee) {
    const details = node('div', null, 'employee-basic-remote-work');
    const body = node('div', null, 'employee-profile-fold-body');
    details.append(body);
    let generation = 0;
    async function load() {
      const attempt = ++generation;
      body.replaceChildren(node('p', '재택근무 설정을 불러오고 있습니다.', 'help'));
      try {
        const result = await rpc('get_employee_remote_work_location', { p_employee_uuid: employee.id });
        if (attempt === generation && details.isConnected) render(result);
      } catch {
        if (attempt === generation) body.replaceChildren(node('p', '재택근무 설정을 불러오지 못했습니다.', 'message error'));
      }
    }
    function render(result) {
      body.replaceChildren();
      body.append(node('p', '주소 · ' + (result.address || '미등록')),
        node('p', result.approved ? '재택근무 · 사용' : '재택근무 · 사용 안 함', 'help'));
      const edit = button('주소·재택근무 수정', true);
      body.append(edit);
      const form = node('form', null, 'employee-form app-authoring');
      form.hidden = true;
      edit.addEventListener('click', () => { form.hidden = false; edit.hidden = true; address.focus(); });
      const address = node('input');
      address.value = result.address || '';
      address.required = true;
      address.minLength = 5;
      address.maxLength = 200;
      address.autocomplete = 'street-address';
      const enabled = node('input');
      enabled.type = 'checkbox';
      enabled.checked = !!result.approved;
      form.append(field('주소', address), field('재택근무자', enabled));
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
      const locationRequired = () => enabled.checked && (!result.approved || address.value.trim() !== result.address);
      const sync = () => {
        fields.hidden = !locationRequired();
        latitude.required = longitude.required = locationRequired();
        map.href = 'https://map.naver.com/p/search/' + encodeURIComponent(address.value);
      };
      address.addEventListener('input', sync);
      enabled.addEventListener('change', sync);
      sync();
      const save = button('주소·재택근무 저장');
      save.type = 'submit';
      const cancel = button('취소', true);
      cancel.addEventListener('click', () => render(result));
      const feedback = node('p', null, 'help');
      feedback.setAttribute('role', 'status');
      const actions = node('div', null, 'quick-links');
      actions.append(save, cancel);
      const update = async () => {
        const attempt = generation;
        for (const control of [address, enabled, latitude, longitude, save, cancel]) control.disabled = true;
        try {
          const updated = await rpc('save_employee_basic_remote_address', {
            p_employee_uuid: employee.id, p_revision: result.revision || null, p_address: address.value.trim(), p_enabled: enabled.checked,
            p_latitude: locationRequired() ? latitude.valueAsNumber : null,
            p_longitude: locationRequired() ? longitude.valueAsNumber : null
          });
          if (attempt === generation && details.isConnected) render(updated);
        } catch {
          feedback.textContent = '저장하지 못했습니다. 주소를 다시 확인한 뒤 시도해 주세요.';
          for (const control of [address, enabled, latitude, longitude, save, cancel]) control.disabled = false;
        }
      };
      form.addEventListener('submit', event => { event.preventDefault(); void update(); });
      form.append(map, fields, actions, feedback);
      fields.prepend(node('p', '처음 설정하거나 주소를 바꾸면 지도에서 위치를 확인해 주세요.', 'help'));
      body.append(form);
    }
    queueMicrotask(load);
    return details;
  }

  window.TaejangEmployeeRemoteWork = { adminPanel };
})();

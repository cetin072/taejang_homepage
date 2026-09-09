(() => {
  'use strict';

  const allowedRoles = new Set(['operations_manager', 'ceo']);
  const state = { active: false, route: null, profileData: null, observer: null };
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value ?? '';
    return node;
  };
  const el = id => document.getElementById(id);
  const array = value => Array.isArray(value) ? value : [];
  const clean = value => String(value ?? '').trim();
  const bool = value => Boolean(value);
  const unique = values => [...new Set(values.map(clean).filter(Boolean))];
  const code = (prefix, existing) => existing || `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  function canUse() {
    const route = window.TaejangApp?.getRoute?.();
    return allowedRoles.has(route);
  }

  function canEdit() {
    return window.TaejangApp?.getRoute?.() === 'operations_manager';
  }

  function closeSidebar() {
    const shell = el('desktop-app-shell');
    shell?.classList.remove('sidebar-open');
    el('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function setPageTitle(value) {
    const title = el('desktop-page-title');
    if (title) title.textContent = value;
  }

  function button(label, action, quiet = false) {
    const node = text('button', label, quiet ? 'button button-quiet' : 'button');
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function field(label, value = '', { type = 'text', name, placeholder = '', required = false, min, max } = {}) {
    const wrap = document.createElement('label');
    wrap.append(text('span', label));
    const input = document.createElement('input');
    input.type = type;
    if (name) input.name = name;
    input.value = value ?? '';
    input.placeholder = placeholder;
    input.required = required;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    wrap.append(input);
    return wrap;
  }

  function textareaField(label, value = '', { name, placeholder = '', rows = 3, required = false } = {}) {
    const wrap = document.createElement('label');
    wrap.append(text('span', label));
    const input = document.createElement('textarea');
    if (name) input.name = name;
    input.value = value ?? '';
    input.placeholder = placeholder;
    input.rows = rows;
    input.required = required;
    wrap.append(input);
    return wrap;
  }

  function selectField(label, value, options, name) {
    const wrap = document.createElement('label');
    wrap.append(text('span', label));
    const select = document.createElement('select');
    if (name) select.name = name;
    options.forEach(([optionValue, optionLabel]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionLabel;
      option.selected = optionValue === value;
      select.append(option);
    });
    wrap.append(select);
    return wrap;
  }

  function checkField(label, checked, name) {
    const wrap = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    if (name) input.name = name;
    input.checked = Boolean(checked);
    wrap.append(input, text('span', label));
    return wrap;
  }

  function section(title, help) {
    const node = document.createElement('section');
    node.className = 'support-radar-section';
    node.append(text('h3', title));
    if (help) node.append(text('p', help, 'support-radar-muted'));
    return node;
  }

  function header(title, copy, actions = []) {
    const node = document.createElement('header');
    node.className = 'support-radar-header';
    const copyWrap = document.createElement('div');
    copyWrap.append(text('p', '지원사업 레이더', 'eyebrow'), text('h2', title), text('p', copy));
    const actionWrap = document.createElement('div');
    actionWrap.className = 'support-radar-actions';
    actions.forEach(action => actionWrap.append(action));
    node.append(copyWrap, actionWrap);
    return node;
  }

  function stat(label, value, note = '') {
    const node = document.createElement('article');
    node.className = 'support-radar-stat';
    node.append(text('span', label, 'support-radar-muted'), text('strong', value));
    if (note) node.append(text('span', note, 'support-radar-muted'));
    return node;
  }

  function formatDate(value) {
    if (!value) return '미확인';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(date);
  }

  function profileCompleteness(data) {
    if (!data?.profile) return 0;
    const checks = [
      Boolean(clean(data.profile.company_name) && clean(data.profile.corporation_type)),
      array(data.locations).length > 0,
      array(data.qualifications).length > 0,
      array(data.business_areas).length > 0,
      Array.isArray(data.profile.industries) && data.profile.industries.length > 0,
      array(data.benefits).length > 0
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }

  async function loadProfile() {
    state.profileData = await window.TaejangApp.rpc('support_get_company_profile');
    return state.profileData;
  }

  function defaultProfileData() {
    return {
      profile: {
        company_name: '농업회사법인 태장 주식회사',
        corporation_type: '주식회사',
        agricultural_corporation: true,
        subsidiary_standard_workplace: true,
        disabled_employment_company: true,
        industries: ['농업', '제조업'],
        current_benefit_summary: '한국장애인고용공단 고용장려금 수혜 중'
      },
      locations: [
        { label: '의창구 사업장', province: '경상남도', city: '창원시', district: '의창구', eup_myeon: '', site_type: 'workplace', rural_area: false, active: true },
        { label: '진전면 농장', province: '경상남도', city: '창원시', district: '마산합포구', eup_myeon: '진전면', site_type: 'farm', rural_area: true, active: true }
      ],
      qualifications: [
        { code: 'subsidiary_standard_workplace', name: '자회사형 장애인표준사업장', status: 'valid', obtainable: true, evidence_summary: '' },
        { code: 'sme_confirmation', name: '중소기업확인서', status: 'missing', obtainable: true, evidence_summary: '현재 미보유. 추후 취득 가능성 있음.' }
      ],
      business_areas: [
        { code: 'employment', name: '인건비·고용', priority: 'highest', active: true },
        { code: 'culture', name: '문화', priority: 'highest', active: true },
        { code: 'horticulture', name: '원예', priority: 'highest', active: true },
        { code: 'ai_digital', name: 'AI·디지털', priority: 'highest', active: true },
        { code: 'agriculture', name: '농업', priority: 'high', active: true },
        { code: 'manufacturing', name: '제조', priority: 'high', active: true },
        { code: 'esg', name: 'ESG', priority: 'normal', active: true }
      ],
      partners: [],
      benefits: [
        { name: '장애인 고용장려금', provider: '한국장애인고용공단', status: 'active', benefit_type: 'cash', notes: '' }
      ],
      can_edit: true,
      stale_evaluation_count: 0
    };
  }

  function renderProfileSummary(root, data) {
    const profile = data.profile;
    if (!profile) {
      const empty = document.createElement('div');
      empty.className = 'support-radar-empty';
      empty.append(text('h3', '아직 기업 프로필이 없습니다.'), text('p', '첫 프로필을 저장하면 이후 지원사업 판정의 기준으로 사용합니다.'));
      if (canEdit()) empty.append(button('기업 프로필 만들기', () => renderProfileEditor(root, defaultProfileData())));
      root.append(empty);
      return;
    }
    const summary = document.createElement('div');
    summary.className = 'support-radar-summary';
    summary.append(
      stat('현재 버전', `v${profile.version}`, `업데이트 ${formatDate(profile.verified_at || profile.created_at)}`),
      stat('프로필 완성도', `${profileCompleteness(data)}%`, '지원사업 판정 기준정보'),
      stat('사업장', `${array(data.locations).filter(item => item.active !== false).length}곳`, '사업장·농장 포함'),
      stat('자격·확인서', `${array(data.qualifications).length}건`, `${array(data.qualifications).filter(item => item.status === 'unknown').length}건 확인 필요`),
      stat('재평가 필요', `${Number(data.stale_evaluation_count || 0)}건`, '프로필 변경 후 과거 평가')
    );
    root.append(summary);

    const card = section('현재 기업 프로필');
    const dl = document.createElement('dl');
    dl.className = 'profile-summary';
    const rows = [
      ['회사명', profile.company_name],
      ['법인형태', profile.corporation_type],
      ['농업회사법인', profile.agricultural_corporation ? '해당' : '아님'],
      ['자회사형 장애인표준사업장', profile.subsidiary_standard_workplace ? '해당' : '아님'],
      ['장애인 고용기업', profile.disabled_employment_company ? '해당' : '아님'],
      ['업종', array(profile.industries).join(', ') || '미등록']
    ];
    rows.forEach(([label, value]) => {
      const wrap = document.createElement('div');
      wrap.append(text('dt', label), text('dd', value));
      dl.append(wrap);
    });
    card.append(dl);
    if (array(data.qualifications).some(item => item.status === 'missing' || item.status === 'unknown')) {
      const warning = text('p', '미보유 또는 확인이 필요한 자격이 있습니다. 취득·확인 시 바로 업데이트하면 이후 지원사업 판정에 반영됩니다.', 'support-radar-warning');
      card.append(warning);
    }
    if (canEdit()) card.append(button('기업 프로필 수정', () => renderProfileEditor(root, data)));
    root.append(card);
  }

  async function renderProfile() {
    if (!canUse()) return;
    state.active = true;
    closeSidebar();
    setPageTitle('기업 프로필');
    const main = el('dashboard-main');
    main.replaceChildren(text('p', '기업 프로필을 불러오고 있습니다.', 'message'));
    try {
      const data = await loadProfile();
      const root = document.createElement('div');
      root.className = 'support-radar-shell';
      root.append(header('기업 프로필', '지원사업 판정에 사용하는 태장의 기준정보입니다. 언제든 수정할 수 있고 과거 버전은 그대로 보존됩니다.', [
        button('지원사업 레이더', () => open('dashboard'), true)
      ]));
      renderProfileSummary(root, data);
      main.replaceChildren(root);
      main.focus();
    } catch (error) {
      main.replaceChildren(text('p', window.TaejangApp.friendlyError(error), 'message error'));
    }
  }

  function removableRow(kind, initial, buildFields) {
    const row = document.createElement('div');
    row.className = 'support-radar-row';
    row.dataset.kind = kind;
    if (initial?.code) row.dataset.code = initial.code;
    const grid = document.createElement('div');
    grid.className = 'support-radar-row-grid';
    buildFields(grid, initial || {});
    const actions = document.createElement('div');
    actions.className = 'support-radar-row-actions';
    actions.append(button('항목 삭제', () => row.remove(), true));
    row.append(grid, actions);
    return row;
  }

  function addLocation(list, initial = {}) {
    list.append(removableRow('location', initial, (grid, item) => {
      grid.append(
        field('표시명', item.label || '', { name: 'label', required: true, placeholder: '예: 진전면 농장' }),
        field('시·도', item.province || '경상남도', { name: 'province', required: true }),
        field('시·군', item.city || '창원시', { name: 'city' }),
        field('구', item.district || '', { name: 'district' }),
        field('읍·면', item.eup_myeon || '', { name: 'eup_myeon' }),
        selectField('시설 유형', item.site_type || 'workplace', [['head_office','본사'],['workplace','사업장'],['farm','농장'],['factory','공장'],['training','교육장'],['other','기타']], 'site_type')
      );
      const checks = document.createElement('div'); checks.className = 'support-radar-checks';
      checks.append(checkField('농어촌 지역', item.rural_area, 'rural_area'), checkField('현재 사용', item.active !== false, 'active'));
      grid.append(checks);
    }));
  }

  function addQualification(list, initial = {}) {
    list.append(removableRow('qualification', initial, (grid, item) => {
      grid.append(
        field('자격·확인서 이름', item.name || '', { name: 'name', required: true, placeholder: '예: 중소기업확인서' }),
        selectField('현재 상태', item.status || 'unknown', [['valid','보유·유효'],['missing','현재 없음'],['planned','취득 예정'],['expired','만료'],['not_applicable','해당 없음'],['unknown','확인 필요']], 'status'),
        field('취득 예상 일수', item.estimated_days_to_obtain ?? '', { name: 'estimated_days_to_obtain', type: 'number', min: 0 }),
        field('유효 시작일', item.valid_from || '', { name: 'valid_from', type: 'date' }),
        field('유효 종료일', item.valid_until || '', { name: 'valid_until', type: 'date' }),
        textareaField('증빙·메모', item.evidence_summary || '', { name: 'evidence_summary', rows: 2 })
      );
      const checks = document.createElement('div'); checks.className = 'support-radar-checks';
      checks.append(checkField('취득 가능', item.obtainable, 'obtainable'));
      grid.append(checks);
    }));
  }

  function addBusinessArea(list, initial = {}) {
    list.append(removableRow('business_area', initial, (grid, item) => {
      grid.append(
        field('사업 분야', item.name || '', { name: 'name', required: true, placeholder: '예: 원예' }),
        selectField('우선순위', item.priority || 'normal', [['highest','최우선'],['high','높음'],['normal','일반']], 'priority'),
        textareaField('메모', item.notes || '', { name: 'notes', rows: 2 })
      );
      const checks = document.createElement('div'); checks.className = 'support-radar-checks';
      checks.append(checkField('현재 사업분야', item.active !== false, 'active'));
      grid.append(checks);
    }));
  }

  function addPartner(list, initial = {}) {
    list.append(removableRow('partner', initial, (grid, item) => {
      grid.append(
        field('협력기관명', item.name || '', { name: 'name', required: true }),
        selectField('기관 유형', item.partner_type || 'other', [['nonprofit','비영리'],['public_agency','공공기관'],['company','기업'],['school','학교'],['association','협회'],['foundation','재단'],['other','기타']], 'partner_type'),
        selectField('협력 상태', item.relationship_status || 'candidate', [['candidate','후보'],['discussing','협의 중'],['active','협력 중'],['inactive','현재 중단']], 'relationship_status'),
        field('가능한 역할', array(item.possible_roles).join(', '), { name: 'possible_roles', placeholder: '예: 공동신청, 교육운영' }),
        textareaField('메모', item.notes || '', { name: 'notes', rows: 2 })
      );
    }));
  }

  function addBenefit(list, initial = {}) {
    list.append(removableRow('benefit', initial, (grid, item) => {
      grid.append(
        field('수혜사업명', item.name || '', { name: 'name', required: true }),
        field('지원기관', item.provider || '', { name: 'provider' }),
        selectField('상태', item.status || 'active', [['planned','예정'],['active','수혜 중'],['completed','종료'],['stopped','중단'],['unknown','확인 필요']], 'status'),
        selectField('지원 형태', item.benefit_type || 'cash', [['cash','지원금'],['in_kind','현물'],['service','서비스·컨설팅'],['mixed','복합'],['other','기타']], 'benefit_type'),
        field('시작일', item.valid_from || '', { name: 'valid_from', type: 'date' }),
        field('종료일', item.valid_until || '', { name: 'valid_until', type: 'date' }),
        field('금액', item.amount ?? '', { name: 'amount', type: 'number', min: 0 }),
        textareaField('중복지원 제한 메모', item.duplicate_restriction_notes || '', { name: 'duplicate_restriction_notes', rows: 2 }),
        textareaField('메모', item.notes || '', { name: 'notes', rows: 2 })
      );
    }));
  }

  function values(row) {
    const result = {};
    row.querySelectorAll('[name]').forEach(input => {
      result[input.name] = input.type === 'checkbox' ? input.checked : clean(input.value);
    });
    return result;
  }

  function collectRows(list, kind) {
    return [...list.querySelectorAll(`.support-radar-row[data-kind="${kind}"]`)].map(row => ({ row, values: values(row) }));
  }

  function renderProfileEditor(root, sourceData) {
    const data = sourceData?.profile ? sourceData : defaultProfileData();
    const profile = data.profile || {};
    root.replaceChildren();
    root.append(header(profile.version ? `기업 프로필 v${profile.version} 수정` : '첫 기업 프로필 만들기', '저장할 때마다 새 버전이 만들어집니다. 과거 지원사업 평가는 당시 버전을 계속 참조합니다.', [button('취소', renderProfile, true)]));

    const form = document.createElement('form');
    form.className = 'support-radar-form';

    const basic = section('1. 회사 기본정보', '지원사업 자격 판정의 기본값입니다.');
    const basicGrid = document.createElement('div'); basicGrid.className = 'support-radar-grid';
    basicGrid.append(
      field('회사명', profile.company_name || '', { name: 'company_name', required: true }),
      field('법인형태', profile.corporation_type || '주식회사', { name: 'corporation_type', required: true }),
      field('업종', array(profile.industries).join(', '), { name: 'industries', placeholder: '예: 농업, 제조업' })
    );
    basic.append(basicGrid);
    const flags = document.createElement('div'); flags.className = 'support-radar-checks';
    flags.append(
      checkField('농업회사법인', profile.agricultural_corporation, 'agricultural_corporation'),
      checkField('자회사형 장애인표준사업장', profile.subsidiary_standard_workplace, 'subsidiary_standard_workplace'),
      checkField('장애인 고용기업', profile.disabled_employment_company, 'disabled_employment_company')
    );
    basic.append(flags, textareaField('현재 수혜사업 요약', profile.current_benefit_summary || '', { name: 'current_benefit_summary', rows: 2 }));
    form.append(basic);

    const locations = section('2. 사업장·농장 위치', '지역 제한 사업을 놓치지 않도록 실제 운영 거점을 모두 등록하세요.');
    const locationList = document.createElement('div'); locationList.className = 'support-radar-list';
    array(data.locations).forEach(item => addLocation(locationList, item));
    locations.append(locationList, button('+ 사업장 추가', () => addLocation(locationList), true));
    form.append(locations);

    const qualifications = section('3. 자격·확인서', '없음·예정·만료 상태도 중요합니다. 취득하면 여기서 바로 바꾸면 됩니다.');
    const qualificationList = document.createElement('div'); qualificationList.className = 'support-radar-list';
    array(data.qualifications).forEach(item => addQualification(qualificationList, item));
    qualifications.append(qualificationList, button('+ 자격 추가', () => addQualification(qualificationList), true));
    form.append(qualifications);

    const areas = section('4. 사업분야', '지원사업 추천 우선순위를 결정하는 핵심 정보입니다.');
    const areaList = document.createElement('div'); areaList.className = 'support-radar-list';
    array(data.business_areas).forEach(item => addBusinessArea(areaList, item));
    areas.append(areaList, button('+ 사업분야 추가', () => addBusinessArea(areaList), true));
    form.append(areas);

    const partners = section('5. 협력기관', '태장이 직접 신청하지 못하는 사업의 공동·협력 경로 판단에 사용합니다.');
    const partnerList = document.createElement('div'); partnerList.className = 'support-radar-list';
    array(data.partners).forEach(item => addPartner(partnerList, item));
    partners.append(partnerList, button('+ 협력기관 추가', () => addPartner(partnerList), true));
    form.append(partners);

    const benefits = section('6. 현재·과거 수혜사업', '중복지원 제한과 실제 수혜이력을 판단하는 데 사용합니다.');
    const benefitList = document.createElement('div'); benefitList.className = 'support-radar-list';
    array(data.benefits).forEach(item => addBenefit(benefitList, item));
    benefits.append(benefitList, button('+ 수혜사업 추가', () => addBenefit(benefitList), true));
    form.append(benefits);

    const save = section('7. 저장');
    save.append(textareaField('변경 사유', '', { name: 'change_reason', rows: 2, required: true, placeholder: '예: 중소기업확인서 취득 상태 반영' }));
    const notice = text('p', '저장하면 기존 프로필을 수정하는 대신 새 버전이 만들어집니다. 이미 평가된 지원사업은 필요 시 재평가 대상으로 표시됩니다.', 'support-radar-note');
    save.append(notice);
    const actions = document.createElement('div'); actions.className = 'form-actions';
    const submit = text('button', '새 버전으로 저장', 'button'); submit.type = 'submit';
    actions.append(submit, button('취소', renderProfile, true));
    save.append(actions);
    form.append(save);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const formValues = values(form);
      if (!window.confirm('기업 프로필을 새 버전으로 저장할까요? 과거 버전과 과거 평가는 그대로 보존됩니다.')) return;
      submit.disabled = true;
      submit.textContent = '저장 중…';
      try {
        const locationRows = collectRows(locationList, 'location').map(({ values: item }) => ({
          ...item, rural_area: bool(item.rural_area), active: bool(item.active)
        })).filter(item => item.label && item.province);
        const qualificationRows = collectRows(qualificationList, 'qualification').map(({ row, values: item }) => ({
          code: code('qualification', row.dataset.code),
          name: item.name,
          status: item.status,
          obtainable: bool(item.obtainable),
          estimated_days_to_obtain: item.estimated_days_to_obtain || null,
          valid_from: item.valid_from || null,
          valid_until: item.valid_until || null,
          evidence_summary: item.evidence_summary
        })).filter(item => item.name);
        const businessRows = collectRows(areaList, 'business_area').map(({ row, values: item }) => ({
          code: code('area', row.dataset.code),
          name: item.name,
          priority: item.priority,
          active: bool(item.active),
          notes: item.notes
        })).filter(item => item.name);
        const partnerRows = collectRows(partnerList, 'partner').map(({ values: item }) => ({
          ...item, possible_roles: unique(item.possible_roles.split(','))
        })).filter(item => item.name);
        const benefitRows = collectRows(benefitList, 'benefit').map(({ values: item }) => ({
          ...item, amount: item.amount || null, valid_from: item.valid_from || null, valid_until: item.valid_until || null
        })).filter(item => item.name);
        const result = await window.TaejangApp.rpc('support_save_company_profile', {
          p_company_name: formValues.company_name,
          p_corporation_type: formValues.corporation_type,
          p_agricultural_corporation: bool(formValues.agricultural_corporation),
          p_subsidiary_standard_workplace: bool(formValues.subsidiary_standard_workplace),
          p_disabled_employment_company: bool(formValues.disabled_employment_company),
          p_industries: unique(formValues.industries.split(',')),
          p_current_benefit_summary: formValues.current_benefit_summary || null,
          p_locations: locationRows,
          p_qualifications: qualificationRows,
          p_business_areas: businessRows,
          p_partners: partnerRows,
          p_benefits: benefitRows,
          p_change_reason: formValues.change_reason
        });
        if (!result?.ok) throw new Error(result?.code || 'SAVE_FAILED');
        await renderProfile();
        const main = el('dashboard-main');
        const success = text('p', `기업 프로필 v${result.version}으로 업데이트했습니다. 이후 지원사업 분석부터 새 프로필을 사용합니다.`, 'support-radar-success');
        main.prepend(success);
      } catch (error) {
        const message = error?.message?.includes('CHANGE_REASON') ? '변경 사유를 입력해주세요.' : window.TaejangApp.friendlyError(error);
        save.prepend(text('p', message, 'message error'));
      } finally {
        submit.disabled = false;
        submit.textContent = '새 버전으로 저장';
      }
    });

    root.append(form);
  }

  async function renderDashboard() {
    if (!canUse()) return;
    state.active = true;
    closeSidebar();
    setPageTitle('지원사업 레이더');
    const main = el('dashboard-main');
    main.replaceChildren(text('p', '지원사업 정보를 준비하고 있습니다.', 'message'));
    try {
      const data = await loadProfile();
      const root = document.createElement('div'); root.className = 'support-radar-shell';
      root.append(header('지원사업 레이더', '태장에 맞는 지원사업을 찾고, 판단하고, 신청 진행까지 관리합니다.', [button('기업 프로필', renderProfile)]));
      const profile = data.profile;
      const summary = document.createElement('div'); summary.className = 'support-radar-summary';
      summary.append(
        stat('기업 프로필', profile ? `v${profile.version}` : '미등록', profile ? `${profileCompleteness(data)}% 완성` : '먼저 등록 필요'),
        stat('재평가 필요', `${Number(data.stale_evaluation_count || 0)}건`, '프로필 변경 영향'),
        stat('자동 수집', '준비 중', 'Phase 2 공식 API 연결'),
        stat('현재 단계', 'Phase 1', '수동·반자동 MVP')
      );
      root.append(summary);
      const next = section('바로 할 일');
      next.append(text('p', profile ? '기업 프로필이 준비되어 있습니다. 다음으로 공고 등록·적합도 평가·신청관리 화면을 연결합니다.' : '기업 프로필을 먼저 저장하면 지원사업 판정 기준이 준비됩니다.'));
      next.append(button(profile ? '기업 프로필 확인·수정' : '기업 프로필 만들기', renderProfile));
      root.append(next);
      main.replaceChildren(root);
      main.focus();
    } catch (error) {
      main.replaceChildren(text('p', window.TaejangApp.friendlyError(error), 'message error'));
    }
  }

  function open(view = 'dashboard') {
    if (!canUse()) return;
    if (view === 'profile') return renderProfile();
    return renderDashboard();
  }

  function navButton(label, view) {
    const node = text('button', label);
    node.type = 'button';
    node.dataset.supportRadarNav = view;
    node.addEventListener('click', () => open(view));
    return node;
  }

  function injectNavigation() {
    if (!canUse()) return;
    const nav = el('app-nav');
    if (!nav || nav.querySelector('[data-support-radar-nav]')) return;
    const marker = nav.querySelector('[data-official-channel-group]');
    const group = document.createElement('section');
    group.className = 'support-radar-nav-group';
    group.dataset.supportRadarNavGroup = '1';
    group.append(text('p', '지원사업', 'support-radar-nav-label'), navButton('지원사업 레이더', 'dashboard'), navButton('기업 프로필', 'profile'));
    if (marker) nav.insertBefore(group, marker); else nav.append(group);
  }

  function injectDashboardShortcut() {
    if (!canUse() || state.active) return;
    const main = el('dashboard-main');
    const grid = main?.querySelector('.dashboard-grid');
    if (!grid || grid.querySelector('[data-support-radar-shortcut]')) return;
    const card = document.createElement('article');
    card.className = 'dashboard-card support-radar-dashboard-shortcut';
    card.dataset.supportRadarShortcut = '1';
    card.append(text('span', '지원사업', 'status-label'), text('h3', '지원사업 레이더'), text('p', '기업 프로필을 기준으로 지원사업을 찾고 검토합니다.'));
    const actions = document.createElement('div'); actions.className = 'support-radar-actions';
    actions.append(button('레이더 열기', () => open('dashboard')), button('기업 프로필', () => open('profile'), true));
    card.append(actions);
    grid.append(card);
  }

  function watchDashboard() {
    if (state.observer) return;
    const main = el('dashboard-main');
    if (!main) return;
    state.observer = new MutationObserver(() => queueMicrotask(injectDashboardShortcut));
    state.observer.observe(main, { childList: true, subtree: true });
  }

  function setup(event) {
    state.route = event.detail?.route || window.TaejangApp?.getRoute?.();
    if (!allowedRoles.has(state.route)) return;
    state.active = false;
    queueMicrotask(() => {
      injectNavigation();
      watchDashboard();
      injectDashboardShortcut();
    });
  }

  document.addEventListener('taejang-app-ready', setup);
  document.addEventListener('taejang-dashboard-refresh', () => {
    state.active = false;
    queueMicrotask(injectDashboardShortcut);
  });

  window.TaejangSupportRadar = { open, renderProfile, loadProfile };
})();

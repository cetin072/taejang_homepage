(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaejangStaffInformationUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEDULE_TYPES = Object.freeze({
    work: '근무', training: '교육', external_activity: '외부활동', holiday: '휴무',
    location_change: '근무장소 변경', special_event: '특별행사',
    transport: '차량·이동', other: '기타 안내'
  });
  const NOTICE_KINDS = Object.freeze({
    safety: '안전', working_hours: '근무시간', work_location: '근무장소',
    training: '교육', external_activity: '외부활동', holiday: '휴무',
    transport: '차량·이동', materials: '준비물', clothing: '복장',
    company_life: '회사생활', general: '일반공지'
  });
  const IMPORTANCE = Object.freeze({ normal: '일반', important: '중요', urgent: '긴급' });
  const GUIDANCE_CATEGORIES = Object.freeze({
    working_hours: '근무시간', breaks_meals: '휴게·식사', places: '장소안내', safety: '안전',
    clothing_supplies: '복장·준비물', absence_contact: '지각·결근', pay_documents: '급여·서류',
    help_request: '도움요청', company_life: '회사생활', other: '기타'
  });
  const STATUS = Object.freeze({ draft: '작성 중', published: '게시', cancelled: '취소', inactive: '사용 중지' });
  const GROUP_ORDER = ['today', 'tomorrow', 'week', 'later'];
  const GROUP_LABELS = Object.freeze({ today: '오늘', tomorrow: '내일', week: '이번 주', later: '그 이후 예정' });

  const element = id => document.getElementById(id);
  const array = value => Array.isArray(value) ? value : [];

  function text(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value || '';
    if (className) node.className = className;
    return node;
  }

  function message(id, value, error = false) {
    const node = element(id);
    if (!node) return;
    node.textContent = value || '';
    node.hidden = !value;
    node.classList.toggle('error', Boolean(error));
  }

  function formatDate(value, options = {}) {
    if (!value) return '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? new Date(`${value}T12:00:00+09:00`)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: options.short ? undefined : 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }).format(date);
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function formatDateTime(value, allDay = false) {
    if (!value) return '';
    return allDay ? formatDate(value) : `${formatDate(value)} ${formatTime(value)}`;
  }

  function formatRange(start, end, allDay = false) {
    if (!start) return '시간 미정';
    const startLabel = formatDateTime(start, allDay);
    if (!end) return startLabel;
    return `${startLabel} ~ ${formatDateTime(end, allDay)}`;
  }

  function kstDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function kstTime(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(value));
  }

  function toKstIso(date, time = '00:00') {
    if (!date) return null;
    return `${date}T${time || '00:00'}:00+09:00`;
  }

  function scheduleGroup(value, todayValue) {
    const scheduleDate = kstDate(value);
    const today = new Date(`${todayValue || kstDate(new Date())}T12:00:00+09:00`);
    const target = new Date(`${scheduleDate}T12:00:00+09:00`);
    const days = Math.round((target - today) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days <= 6) return 'week';
    return 'later';
  }

  function setWorkerScreen(name) {
    for (const id of ['general-worker-board', 'work-guide-screen', 'schedule-screen', 'notice-screen', 'guidance-screen']) {
      const node = element(id);
      if (node) node.hidden = id !== name;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function fillSelect(select, items, emptyLabel) {
    if (!select) return;
    const current = select.value;
    select.replaceChildren();
    if (emptyLabel !== undefined) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = emptyLabel;
      select.append(option);
    }
    array(items).forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name || item.title;
      select.append(option);
    });
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }

  function fillScopeSelect(select, options) {
    const scopes = [];
    if (options?.company_allowed) scopes.push({ id: 'company', name: '전체 직원' });
    if (array(options?.departments).length) scopes.push({ id: 'department', name: '부서' });
    if (array(options?.work_groups).length) scopes.push({ id: 'work_group', name: '작업반' });
    if (array(options?.profiles).length) scopes.push({ id: 'profile', name: '개인' });
    fillSelect(select, scopes);
  }

  function fillTargetSelect(scopeSelect, targetSelect, options, selected = '') {
    const scope = scopeSelect.value;
    const items = scope === 'department' ? options?.departments
      : scope === 'work_group' ? options?.work_groups
        : scope === 'profile' ? options?.profiles : [];
    fillSelect(targetSelect, items, scope === 'company' ? '전체 직원' : '대상을 선택하세요');
    targetSelect.disabled = scope === 'company';
    if (selected) targetSelect.value = selected;
  }

  function targetPayload(scopeSelect, targetSelect) {
    const scope = scopeSelect.value;
    const id = scope === 'company' ? null : targetSelect.value;
    if (scope !== 'company' && !id) throw new Error('TARGET_REQUIRED');
    return {
      p_target_scope: scope,
      p_target_department_id: scope === 'department' ? id : null,
      p_target_work_group_id: scope === 'work_group' ? id : null,
      p_target_profile_id: scope === 'profile' ? id : null
    };
  }

  function targetId(record) {
    if (record?.target_scope === 'department') return record.target_department_id || '';
    if (record?.target_scope === 'work_group') return record.target_work_group_id || '';
    if (record?.target_scope === 'profile') return record.target_profile_id || '';
    return '';
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url : null;
    } catch {
      return null;
    }
  }

  function appendDetail(container, label, value) {
    if (!value) return;
    const row = document.createElement('div');
    row.className = 'detail-row';
    row.append(text('dt', label), text('dd', value));
    container.append(row);
  }

  return {
    SCHEDULE_TYPES, NOTICE_KINDS, IMPORTANCE, GUIDANCE_CATEGORIES, STATUS, GROUP_ORDER, GROUP_LABELS,
    element, array, text, message, formatDate, formatTime, formatDateTime, formatRange,
    kstDate, kstTime, toKstIso, scheduleGroup, setWorkerScreen, fillSelect,
    fillScopeSelect, fillTargetSelect, targetPayload, targetId, safeHttpsUrl, appendDetail
  };
});

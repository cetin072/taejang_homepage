(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaejangTodayBoard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KIND_LABELS = Object.freeze({
    work_hours: '근무시간',
    training: '교육',
    external_activity: '외부활동',
    holiday: '휴무',
    location_change: '근무장소 변경',
    event: '특별행사',
    transport: '차량·이동',
    notice: '중요공지',
    safety: '안전 안내'
  });

  const STATUS_LABELS = Object.freeze({
    draft: '작성 중',
    published: '사용 중',
    cancelled: '취소',
    inactive: '사용 중지'
  });

  const SCOPE_LABELS = Object.freeze({
    company: '전체 직원',
    department: '부서',
    work_group: '작업반',
    profile: '개인'
  });

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function formatDate(value) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }).format(new Date(Date.UTC(year, month - 1, day, 3)));
  }

  function formatTime(value) {
    if (!value) return '';
    const [hour, minute] = String(value).split(':');
    return `${hour}:${minute}`;
  }

  function timeRange(start, end, fallback = '시간 미정') {
    if (start && end) return `${formatTime(start)} ~ ${formatTime(end)}`;
    if (start) return `${formatTime(start)}부터`;
    if (end) return `${formatTime(end)}까지`;
    return fallback;
  }

  function sortByTime(items) {
    return [...array(items)].sort((left, right) => {
      const leftTime = left?.start_time || '99:99:99';
      const rightTime = right?.start_time || '99:99:99';
      return leftTime.localeCompare(rightTime);
    });
  }

  function boardState(board) {
    const tasks = array(board?.tasks);
    const workHours = array(board?.work_hours);
    const information = array(board?.information);
    if (!tasks.length && !workHours.length && !information.length) return 'empty';
    return 'ready';
  }

  function emptyMessage() {
    return '오늘 등록된 업무가 없습니다. 담당 반장에게 확인하세요.';
  }

  function guideMessage(guide) {
    return guide
      ? '상세 작업순서는 다음 단계에서 연결됩니다.'
      : '등록된 작업방법이 없습니다. 담당 반장에게 확인하세요.';
  }

  function targetId(record) {
    if (!record) return '';
    if (record.target_scope === 'department') return record.target_department_id || '';
    if (record.target_scope === 'work_group') return record.target_work_group_id || '';
    if (record.target_scope === 'profile') return record.target_profile_id || '';
    return '';
  }

  function targetParameters(scope, id) {
    return {
      p_target_department_id: scope === 'department' ? id || null : null,
      p_target_work_group_id: scope === 'work_group' ? id || null : null,
      p_target_profile_id: scope === 'profile' ? id || null : null
    };
  }

  return {
    KIND_LABELS,
    STATUS_LABELS,
    SCOPE_LABELS,
    array,
    formatDate,
    formatTime,
    timeRange,
    sortByTime,
    boardState,
    emptyMessage,
    guideMessage,
    targetId,
    targetParameters
  };
});

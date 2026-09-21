(() => {
  'use strict';

  const ITEMS = Object.freeze([
    { key:'dashboard', label:'대시보드', section:null, locked:true },
    { key:'employee.manage', label:'직원 관리', section:'직원·계정', capabilities:['employee.view_all','employee.view_scoped'] },
    { key:'employee.new', label:'신규 직원 등록', section:'직원·계정', capabilities:['employee.create','employee.request_change'] },
    { key:'account.approval', label:'가입 승인', section:'직원·계정', capabilities:['employee.onboard','account.approve','account.reject'] },
    { key:'account.recovery', label:'복구·계정 관리', section:'직원·계정', capabilities:['account.view_management'] },

    { key:'promotion.review', label:'홍보 검토', section:'홍보', capabilities:['promotion.review_lead','promotion.review_operations','promotion.review_ceo'] },
    { key:'promotion.write', label:'홍보 글 작성', section:'홍보', capabilities:['promotion.write','promotion.edit_any_unpublished'] },
    { key:'promotion.sent', label:'보낸 글', section:'홍보', capabilities:['promotion.write'] },
    { key:'promotion.revision', label:'보완 요청받은 글', section:'홍보', capabilities:['promotion.edit_own','promotion.edit_any_unpublished'] },
    { key:'promotion.existing', label:'기존 글 관리', section:'홍보', capabilities:['promotion.manage_recent_public','promotion.archive','promotion.restore'] },
    { key:'promotion.archive', label:'홍보글 관리·복구', section:'홍보', capabilities:['promotion.archive','promotion.restore','promotion.hide','promotion.republish'] },
    { key:'promotion.publication', label:'발행 대기', section:'홍보', capabilities:['promotion.queue_publication'] },

    { key:'homepage.content', label:'홈페이지 내용 관리', section:'홈페이지', capabilities:['homepage.draft','homepage.review','homepage.approve_apply'] },
    { key:'homepage.direct', label:'홈페이지 직접 수정', section:'홈페이지', capabilities:['homepage.direct_edit'] },

    { key:'task.manage', label:'업무 배정', section:'업무 운영', capabilities:['task.manage'] },
    { key:'schedule.manage', label:'일정 관리', section:'업무 운영', capabilities:['schedule.manage'] },
    { key:'schedule.calendar', label:'일정 캘린더', section:'업무 운영', capabilities:['schedule.manage'] },

    { key:'notice.read', label:'공지 확인', section:'공지·안내' },
    { key:'notice.manage', label:'공지 관리', section:'공지·안내', capabilities:['notice.manage','information.review','information.submit'] },
    { key:'guidance.manage', label:'상시 안내 관리', section:'공지·안내', capabilities:['guidance.manage'] },

    { key:'payroll.manage', label:'근태·급여관리', section:'근태·급여', capabilities:['payroll.manage'] },
    { key:'payroll.handoff.approve', label:'외부 급여초안 검토', section:'근태·급여', capabilities:['payroll.handoff.approve'] },
    { key:'payroll.handoff.review', label:'외부 급여초안 상신', section:'근태·급여', capabilities:['payroll.handoff.review'] },
    { key:'attendance.view', label:'출근부', section:'근태·급여', capabilities:['attendance.admin_view'] },
    { key:'attendance.correct', label:'근태 보정', section:'근태·급여', capabilities:['attendance.correct'] },

    { key:'support.radar', label:'지원사업 레이더', section:'지원사업', capabilities:['support_radar.management_view'] },
    { key:'support.profile', label:'기업 프로필', section:'지원사업', capabilities:['support_radar.management_view','support_radar.management_edit'] },
    { key:'support.mywork', label:'내 지원사업', section:'지원사업', capabilities:['support_radar.assigned_work'] },

    { key:'platform.settings', label:'설정', section:'설정', capabilities:['platform.navigation.manage'], locked:true },
    { key:'public.homepage', label:'홈페이지', section:'공개 채널', public:true }
  ]);

  const ALIASES = Object.freeze({
    '팀 직원 관리':'employee.manage',
    '신규 직원 등록 요청':'employee.new',
    '계정 승인':'account.approval',
    '홍보 작성':'promotion.write',
    '새 홍보글 작성':'promotion.write',
    '수정·보완 요청':'promotion.revision',
    '홍보글 승인·검토':'promotion.review',
    '홍보 관리':'promotion.review',
    '승인·검토':'promotion.review',
    '글 관리':'promotion.existing',
    '홍보 글 관리':'promotion.existing',
    '공개글 관리':'promotion.existing',
    '홍보글 보관·복구':'promotion.archive',
    '안내 관리':'guidance.manage'
  });

  const byKey = new Map(ITEMS.map(item => [item.key,item]));
  const byLabel = new Map(ITEMS.map(item => [item.label,item]));

  function cleanLabel(value) {
    return String(value || '').replace(/\s*·\s*점검중\s*$/,'').trim();
  }

  function itemForLabel(label) {
    const clean = cleanLabel(label);
    const aliasKey = ALIASES[clean];
    return aliasKey ? byKey.get(aliasKey) : byLabel.get(clean);
  }

  function keyForNode(node) {
    if (!node) return null;
    if (node.dataset?.menuKey) return node.dataset.menuKey;
    const item = itemForLabel(node.textContent || '');
    return item?.key || null;
  }

  function itemForNode(node) {
    const key = keyForNode(node);
    return key ? byKey.get(key) || null : null;
  }

  function orderIndex(key) {
    const index = ITEMS.findIndex(item => item.key===key);
    return index < 0 ? 9000 : index;
  }

  window.TaejangPlatformNavigationRegistry = {
    ITEMS,
    ALIASES,
    items: () => ITEMS.slice(),
    byKey: key => byKey.get(key) || null,
    itemForLabel,
    keyForNode,
    itemForNode,
    orderIndex,
    cleanLabel
  };
})();
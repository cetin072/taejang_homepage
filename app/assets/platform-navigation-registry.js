(() => {
  'use strict';

  const SECTIONS = Object.freeze([
    { key:'sales', label:'영업·매출' },
    { key:'logistics', label:'물류' },
    { key:'services', label:'용역' },
    { key:'employee-account', label:'직원·계정' },
    { key:'payroll', label:'근태·급여' },
    { key:'operations', label:'공지' },
    { key:'promotion', label:'홍보' },
    { key:'homepage', label:'홈페이지' },
    { key:'support', label:'지원사업' },
    { key:'official_channels', label:'공식 채널' }
  ]);

  const ITEMS = Object.freeze([
    { key:'dashboard', label:'대시보드', section:null, locked:true },

    { key:'erp_sales.manage', label:'매출·정산', section:'영업·매출', capabilities:['erp_sales.read'], visibleRoles:['operations_manager'] },
    { key:'erp_sales.quotation', label:'공용 견적서', section:'영업·매출', capabilities:['erp_sales.read'], visibleRoles:['operations_manager'] },

    { key:'logistics.manage', label:'물류 견적·거래', section:'물류', capabilities:[], visibleRoles:['department_lead','promotion_lead','operations_manager','ceo'] },

    { key:'erp_sales.contracts', label:'용역 계약·월 매출', section:'용역', capabilities:['erp_sales.read'], visibleRoles:['operations_manager'] },
    { key:'monthly_client_documents.manage', label:'월간 용역 서류', section:'용역', capabilities:['monthly_client_documents.manage'], visibleRoles:['operations_manager'] },

    { key:'daily_work.manage', label:'일일 업무일지', section:'직원·계정', capabilities:[], visibleRoles:['department_lead','promotion_lead','operations_manager','ceo'] },
    { key:'employee.manage', label:'직원 관리', section:'직원·계정', capabilities:['employee.view_all','employee.view_scoped'] },
    { key:'employee.new', label:'신규 직원 등록', section:'직원·계정', capabilities:['employee.create','employee.request_change'] },
    { key:'account.approval', label:'직원앱 가입 승인', section:'직원·계정', capabilities:['employee.onboard','account.approve','account.reject'] },

    { key:'attendance.view', label:'출근부', section:'근태·급여', capabilities:['attendance.admin_view'] },
    { key:'attendance.correct', label:'근태 기록 보정', section:'근태·급여', capabilities:['attendance.correct'] },
    { key:'leave.manage', label:'연차 관리', section:'근태·급여', capabilities:['leave.manage'], visibleRoles:['operations_manager','promotion_lead'] },
    { key:'payroll.manage', label:'급여 관리', section:'근태·급여', capabilities:['payroll.manage'], visibleRoles:['operations_manager'] },
    { key:'payslip.issue', label:'급여명세서', section:'근태·급여', capabilities:['payslip.issue'], visibleRoles:['promotion_lead'] },

    { key:'notice.manage', label:'공지 관리', section:'공지', capabilities:['notice.manage'] },

    { key:'promotion.write', label:'홍보 글 작성', section:'홍보', capabilities:['promotion.write','promotion.edit_any_unpublished'], visibleRoles:['promotion_staff','promotion_lead','operations_manager'] },
    { key:'promotion.review', label:'승인 검토', section:'홍보', capabilities:['promotion.review_lead','promotion.review_operations','promotion.review_ceo'], visibleRoles:['promotion_lead','operations_manager','ceo'] },
    { key:'promotion.revision', label:'보완 요청받은 글', section:'홍보', capabilities:['promotion.edit_own','promotion.edit_any_unpublished'], visibleRoles:['promotion_staff'] },
    { key:'promotion.sent', label:'보낸 글', section:'홍보', capabilities:['promotion.write'], visibleRoles:['promotion_staff','promotion_lead','operations_manager'] },
    { key:'promotion.publication', label:'발행 관리', roleLabels:{ operations_manager:'발행 현황' }, section:'홍보', capabilities:[], visibleRoles:['promotion_lead','operations_manager'] },
    { key:'promotion.existing', label:'공개 글 관리', section:'홍보', capabilities:['promotion.manage_recent_public','promotion.archive','promotion.restore'], visibleRoles:['promotion_lead','operations_manager'] },

    { key:'homepage.content', label:'내용 수정 요청', section:'홈페이지', capabilities:['homepage.draft','homepage.review','homepage.approve_apply'] },
    { key:'homepage.direct', label:'직접 편집', section:'홈페이지', capabilities:['homepage.direct_edit'] },

    { key:'support.radar', label:'지원사업 찾기', section:'지원사업', capabilities:['support_radar.management_view'] },
    { key:'support.mywork', label:'내 지원사업', section:'지원사업', capabilities:['support_radar.assigned_work'] },
    { key:'support.profile', label:'기업 프로필', section:'지원사업', capabilities:['support_radar.management_view','support_radar.management_edit'] },

    { key:'platform.settings', label:'설정', section:null, capabilities:['platform.navigation.manage'], locked:true },

    { key:'public.homepage', label:'홈페이지', section:'공식 채널', public:true, locked:true },
    { key:'public.blog', label:'공식 블로그', section:'공식 채널', public:true, locked:true },
    { key:'public.youtube', label:'공식 유튜브', section:'공식 채널', public:true, locked:true }
  ]);

  const ALIASES = Object.freeze({
    '기준정보·매출 관리':'erp_sales.manage',
    '물류 관리':'logistics.manage',
    '계약·월 매출':'erp_sales.contracts',
    '용역 서류':'monthly_client_documents.manage',
    '가입 승인':'account.approval',
    '근태 보정':'attendance.correct',
    '근태·급여관리':'payroll.manage',
    '홍보 검토':'promotion.review',
    '공개 홍보글 관리':'promotion.existing',
    '홈페이지 내용 관리':'homepage.content',
    '홈페이지 직접 수정':'homepage.direct',
    '지원사업 레이더':'support.radar',
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
    '기존 글 관리':'promotion.existing',
    '발행 대기':'promotion.publication',
    '발행 현황':'promotion.publication',
    '홍보 검토 대기':'promotion.review',
    '홍보 승인 검토':'promotion.review',
    '안내 관리':'guidance.manage'
  });

  const byKey = new Map(ITEMS.map(item => [item.key,item]));
  const byLabel = new Map(ITEMS.filter(item => !item.public).map(item => [item.label,item]));
  const sectionByLabel = new Map(SECTIONS.map(section => [section.label,section]));
  const sectionByKey = new Map(SECTIONS.map(section => [section.key,section]));

  function cleanLabel(value) {
    return String(value || '').replace(/\s*·\s*점검중\s*$/,'').replace(/\s*⋮⋮\s*$/,'').trim();
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

  function sectionKeyForLabel(label) {
    return sectionByLabel.get(label)?.key || null;
  }

  function sectionForItem(item) {
    return item?.section ? sectionByLabel.get(item.section) || null : null;
  }

  function visibleForRole(itemOrKey, role) {
    const item = typeof itemOrKey === 'string' ? byKey.get(itemOrKey) : itemOrKey;
    return !item?.visibleRoles || item.visibleRoles.includes(role);
  }

  window.TaejangPlatformNavigationRegistry = {
    ITEMS,
    SECTIONS,
    ALIASES,
    items: () => ITEMS.slice(),
    sections: () => SECTIONS.slice(),
    byKey: key => byKey.get(key) || null,
    sectionByKey: key => sectionByKey.get(key) || null,
    sectionKeyForLabel,
    sectionForItem,
    itemForLabel,
    keyForNode,
    itemForNode,
    visibleForRole,
    orderIndex,
    cleanLabel
  };
})();

(() => {
  'use strict';

  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value || '';
    if (className) node.className = className;
    return node;
  };
  const array = value => Array.isArray(value) ? value : [];
  const lifecycleLabel = {
    draft: '작성 중', review_pending: '승인 대기', needs_revision: '보완 필요',
    approved: '승인 완료', scheduled: '게시 예정', published: '게시 완료',
    hidden: '숨김', archived: '보관'
  };

  async function open() {
    const app = window.TaejangApp;
    const main = document.getElementById('dashboard-main');
    if (!app || !main) return;
    main.hidden = false;
    main.replaceChildren(text('p', '홍보 업무를 불러오고 있습니다.', 'message'));
    try {
      const workspace = await app.rpc('get_my_promotion_workspace');
      render(main, workspace || {});
    } catch (error) {
      main.replaceChildren(text('p', app.friendlyError(error), 'message error'));
    }
  }

  function actionButton(label, handler, quiet = false) {
    const button = text('button', label, `button${quiet ? ' button-quiet' : ''}`);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function card(item) {
    const node = document.createElement('article');
    node.className = 'dashboard-card promotion-card';
    node.append(
      text('span', lifecycleLabel[item.lifecycle] || '검토', 'status-label'),
      text('h3', item.title),
      text('p', item.requested_publish_date ? `게시 희망일: ${item.requested_publish_date}` : '게시 희망일을 정하지 않았습니다.')
    );
    return node;
  }

  async function review(contentId, action) {
    const comment = window.prompt(action === 'changes_requested' ? '보완이 필요한 이유를 구체적으로 적어주세요.' : '검토 의견(선택)을 적어주세요.', '') || null;
    const revisit = action === 'on_hold' ? window.prompt('재확인 날짜를 YYYY-MM-DD 형식으로 적어주세요.', '') : null;
    try {
      await window.TaejangApp.rpc('review_promotion_revision', {
        p_content_id: contentId, p_action: action, p_comment: comment, p_revisit_at: revisit || null
      });
      await open();
    } catch (error) {
      window.alert(window.TaejangApp.friendlyError(error));
    }
  }

  function render(main, workspace) {
    const role = workspace.role;
    const intro = document.createElement('header');
    intro.className = 'dashboard-intro';
    intro.append(text('p', '홍보 업무', 'eyebrow'));
    intro.append(text('h2', role === 'promotion_staff' ? '작성과 보완' : '홍보 검토'));
    intro.append(text('p', role === 'promotion_staff'
      ? '중요도나 승인선을 고르지 않아도 됩니다. 사실과 자료를 입력하고 승인 요청하세요.'
      : '역할에 배정된 검토 안건만 표시합니다. 검토 의견은 구체적으로 남겨주세요.'));
    intro.append(actionButton('대시보드로', () => document.dispatchEvent(new Event('taejang-dashboard-refresh')), true));
    main.replaceChildren(intro);

    const mine = array(workspace.my_items);
    const mySection = document.createElement('section');
    mySection.className = 'dashboard-section';
    mySection.append(text('h2', role === 'promotion_staff' ? '내 콘텐츠' : '내가 작성한 콘텐츠'));
    const myGrid = document.createElement('div');
    myGrid.className = 'dashboard-grid';
    if (mine.length) mine.forEach(item => myGrid.append(card(item)));
    else myGrid.append(text('p', '아직 작성한 홍보 콘텐츠가 없습니다.', 'empty'));
    mySection.append(myGrid);
    main.append(mySection);

    if (role === 'promotion_lead') {
      const planning = document.createElement('section');
      planning.className = 'dashboard-section';
      planning.append(text('h2', '신규 사업기획'), text('p', '총괄 등기이사가 공식 요청으로 전환한 항목만 후속 화면에서 연결합니다. 비공식 아이디어는 실행업무로 만들지 않습니다.', 'help'));
      main.append(planning);
    }

    const reviews = array(workspace.review_items);
    if (!reviews.length) return;
    const reviewSection = document.createElement('section');
    reviewSection.className = 'dashboard-section';
    reviewSection.append(text('h2', role === 'ceo' ? '대표이사 확인 안건' : '검토 대기 안건'));
    const reviewGrid = document.createElement('div');
    reviewGrid.className = 'dashboard-grid';
    reviews.forEach(item => {
      const node = card({ ...item, lifecycle: 'review_pending' });
      node.append(text('p', `현재 단계: ${item.stage}`));
      if (role !== 'ceo' && item.required_stage) node.append(text('p', `필요 승인: ${item.required_stage}`));
      const actions = document.createElement('div');
      actions.className = 'quick-links';
      actions.append(actionButton('승인', () => review(item.content_id, 'approve')));
      actions.append(actionButton('보완 요청', () => review(item.content_id, 'changes_requested'), true));
      if (role === 'promotion_lead') actions.append(actionButton('운영총괄 상신', () => review(item.content_id, 'escalate_to_operations'), true));
      if (role === 'operations_manager') actions.append(actionButton('대표이사 상신', () => review(item.content_id, 'escalate_to_ceo'), true));
      actions.append(actionButton('검토 보류', () => review(item.content_id, 'on_hold'), true));
      node.append(actions);
      reviewGrid.append(node);
    });
    reviewSection.append(reviewGrid);
    main.append(reviewSection);
  }

  document.addEventListener('taejang-open-promotion-workspace', open);
})();

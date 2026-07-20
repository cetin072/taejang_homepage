(function () {
  const sample = [
    {
      id: 1,
      type: 'own',
      title: '태장 개소식 안내',
      meta: '행사·포스터',
      author: '홍보팀',
      date: '2026.07.24',
      updated: '2026.07.20',
      status: 'published',
      summary: '태장 개소식 안내입니다.'
    },
    {
      id: 2,
      type: 'external',
      title: '태장 근로자 직무교육 현장',
      meta: '네이버 블로그',
      author: '홍보팀',
      date: '2026.07.20',
      updated: '2026.07.20',
      status: 'requested',
      summary: '교육 현장의 이야기와 사진을 원문에서 확인하세요.'
    },
    {
      id: 3,
      type: 'external',
      title: '태장 회사 소개 영상',
      meta: '유튜브',
      author: '홍보팀',
      date: '2026.07.20',
      updated: '2026.07.19',
      status: 'published',
      summary: '태장과 함께하는 일자리 이야기를 영상으로 소개합니다.'
    },
    {
      id: 4,
      type: 'own',
      title: '신규 채용 공고',
      meta: '채용공고',
      author: '홍보팀',
      date: '-',
      updated: '2026.07.22',
      status: 'requested',
      summary: '함께 일할 동료를 모집합니다.'
    },
    {
      id: 5,
      type: 'own',
      title: '지역사회 연계 프로그램 진행',
      meta: '태장소식',
      author: '홍보팀',
      date: '-',
      updated: '2026.07.21',
      status: 'draft',
      summary: '지역사회와 함께한 프로그램 기록입니다.'
    },
    {
      id: 6,
      type: 'external',
      title: '농장 현장 한 장',
      meta: '인스타그램',
      author: '홍보팀',
      date: '2026.07.18',
      updated: '2026.07.18',
      status: 'published',
      summary: '오늘의 농장 현장을 만나보세요.'
    }
  ];

  const labels = {
    draft: '작성 중',
    requested: '게시 요청',
    published: '게시됨',
    hidden: '숨김'
  };

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));

  if (document.body.dataset.page === 'list') {
    const rows = document.querySelector('#content-rows');
    const count = document.querySelector('#result-count');
    const empty = document.querySelector('#empty');

    function drawRows() {
      const query = (document.querySelector('#search').value || '').toLowerCase();
      const type = document.querySelector('#type').value;
      const status = document.querySelector('#status').value;
      const data = sample.filter((item) => (
        (type === 'all' || item.type === type)
        && (status === 'all' || item.status === status)
        && [item.title, item.summary, item.meta].join(' ').toLowerCase().includes(query)
      ));

      count.textContent = data.length;
      empty.hidden = data.length > 0;
      rows.innerHTML = data.map((item) => `
        <tr>
          <td>
            <div class="table-content">
              <span class="thumb">이미지</span>
              <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.summary)}</small></div>
            </div>
          </td>
          <td><span class="tag ${item.type === 'external' ? 'external' : 'own'}">${item.type === 'external' ? '외부 콘텐츠' : '홈페이지 글'}</span><small>${escapeHtml(item.meta)}</small></td>
          <td>${escapeHtml(item.author)}</td>
          <td>${escapeHtml(item.date)}</td>
          <td><span class="status ${item.status}">${labels[item.status]}</span></td>
          <td>${escapeHtml(item.updated)}</td>
          <td>
            <div class="row-actions">
              <a href="${item.type === 'external' ? 'external-create.html' : 'content-create.html'}">수정</a>
              <a href="preview.html?type=${item.type === 'external' ? 'external' : 'post'}">미리보기</a>
              <button data-delete="${item.id}">삭제</button>
            </div>
          </td>
        </tr>
      `).join('');

      rows.querySelectorAll('[data-delete]').forEach((button) => {
        button.onclick = () => {
          if (confirm('이 콘텐츠를 휴지통으로 이동할까요?')) {
            button.closest('tr').remove();
          }
        };
      });
    }

    ['search', 'type', 'status'].forEach((id) => {
      document.querySelector(`#${id}`).addEventListener('input', drawRows);
    });

    document.querySelector('#reset-filters').onclick = () => {
      document.querySelector('#search').value = '';
      document.querySelector('#type').value = 'all';
      document.querySelector('#status').value = 'all';
      drawRows();
    };

    drawRows();
  }

  const postForm = document.querySelector('#post-form');

  if (postForm) {
    const board = postForm.elements.board;
    const eventFields = document.querySelector('#event-fields');
    const state = document.querySelector('#save-state');

    const savePost = () => {
      localStorage.setItem(
        'taejang-admin-post-demo',
        JSON.stringify(Object.fromEntries(new FormData(postForm)))
      );
      state.textContent = '마지막 저장: 방금 전';
    };

    board.addEventListener('change', () => {
      eventFields.hidden = board.value !== '행사·포스터';
    });

    document.querySelector('#save-draft').onclick = savePost;
    postForm.addEventListener('input', () => {
      state.textContent = '자동 저장 중';
      clearTimeout(window._save);
      window._save = setTimeout(savePost, 500);
    });

    postForm.addEventListener('submit', (event) => {
      event.preventDefault();
      savePost();
      alert('게시 요청 데모가 저장되었습니다. 실제 전송은 연결되지 않았습니다.');
    });
  }

  const externalForm = document.querySelector('#external-form');

  if (externalForm) {
    const url = document.querySelector('#external-url');
    const suggestion = document.querySelector('#suggestion');

    url.addEventListener('input', () => {
      suggestion.classList.toggle('ready', url.value.length > 8);
    });

    document.querySelector('#use-suggestion').onclick = () => {
      externalForm.elements.title.value = '태장 근로자 직무교육 현장';
      externalForm.elements.summary.value = '교육 현장의 이야기와 사진을 원문에서 확인하세요.';
    };

    const saveExternal = () => {
      localStorage.setItem(
        'taejang-admin-external-demo',
        JSON.stringify(Object.fromEntries(new FormData(externalForm)))
      );
      document.querySelector('#save-state').textContent = '마지막 저장: 방금 전';
    };

    document.querySelector('#save-external').onclick = saveExternal;
    externalForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveExternal();
      alert('게시 요청 데모가 저장되었습니다. 실제 전송은 연결되지 않았습니다.');
    });
  }

  if (document.body.dataset.page === 'preview') {
    const params = new URLSearchParams(location.search);
    document.querySelector('#post-preview').hidden = params.get('type') === 'external';
    document.querySelector('#external-preview').hidden = params.get('type') !== 'external';

    document.querySelectorAll('[data-width]').forEach((button) => {
      button.onclick = () => {
        document.querySelectorAll('[data-width]').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        document.querySelector('#preview-frame').classList.toggle('mobile', button.dataset.width === 'mobile');
      };
    });
  }
})();

const sections = [
  ['headlines', '오늘의 핵심'], ['work', '오늘의 업무'], ['staff', '근무 현황'],
  ['upcoming', '예정 일정'], ['rules', '기본 근무수칙']
];
const deliveryLabels = {
  copied: '전문 복사', copy_failed: '복사 실패', share_requested: '공유 요청 · 전송 확인 전',
  share_cancelled: '공유 취소', share_failed: '공유 실패'
};
const timeZone = 'Asia/Seoul';
const nowDate = () => new Intl.DateTimeFormat('sv-SE', {timeZone}).format(new Date());
const clock = value => new Intl.DateTimeFormat('ko-KR', {
  timeZone, hour: 'numeric', minute: '2-digit'
}).format(new Date(value));
const dateTime = value => value ? new Intl.DateTimeFormat('ko-KR', {
  timeZone, dateStyle: 'short', timeStyle: 'short'
}).format(new Date(value)) : '—';
const sectionText = (brief, key) => brief.edits?.[key] ?? brief.source.sections[key].join('\n');

function messageLines(text) {
  return text.split(/\r\n?|\n/).map(line => line.trim()
    .replace(/^(?:(?:\x60{3,}|~{3,})(?:[a-z][\w+-]*)?|([-*_])(?:\s*\1){1,})$/i, '')
    .replace(/^(?:>\s*)+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-+*·•]\s+/, '')
    .replace(/!?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/(\x60+)(?=\S)(.*?\S)\1/g, '$2')
    .replace(/(\*{2,3}|~~)(?=\S)(.*?\S)\1/g, '$2')
    .replace(/(^|[\s(])(\*|_{1,3})(?=\S)(.*?\S)\2(?=$|[\s).,!?:;])/g, '$1$3')
    .trim()
  ).filter(Boolean);
}

export function briefingMessage(brief) {
  if (!brief) return '';
  const date = new Intl.DateTimeFormat('ko-KR', {
    timeZone, month: 'long', day: 'numeric', weekday: 'long'
  }).format(new Date(brief.work_date + 'T00:00:00+09:00'));
  const blocks = sections.flatMap(([key,label], i) => {
    if (brief.hidden?.includes(key)) return [];
    const lines = messageLines(sectionText(brief,key));
    if (key === 'headlines' && brief.note) lines.push(...messageLines(brief.note));
    if (!lines.length) return [];
    const body = key === 'rules' ? lines.join(' / ') : lines.map(line => '· ' + line).join('\n');
    return ['0' + (i + 1) + '. ' + label + '\n' + body];
  });
  const stamp = brief.confirmed_at || brief.source.generated_at || brief.created_at;
  return ['[태장 데일리 브리핑]\n' + date, ...blocks, '태장 ERP · ' + clock(stamp) + ' 기준'].join('\n\n');
}

const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const button = (text, action, quiet = true) => {
  const el = node('button', text, quiet ? 'button button-quiet' : 'button');
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
};
const input = (type, value) => {
  const el = node('input');
  el.type = type;
  if (type === 'checkbox') el.checked = Boolean(value);
  else el.value = value ?? '';
  return el;
};
const label = (caption, field) => {
  const el = node('label');
  field.setAttribute('aria-label',caption);
  el.append(node('span',caption),field);
  return el;
};
const select = (options, value) => {
  const el = node('select');
  for (const [key,caption] of options) el.append(new Option(caption,key));
  el.value = value;
  return el;
};
const banner = (text, error = false) => {
  const el = node('p',text,error ? 'message error' : 'message');
  el.setAttribute('role', error ? 'alert' : 'status');
  return el;
};

const errors = {
  BRIEFING_FORBIDDEN: '일일 브리핑에 접근할 권한이 없습니다.',
  BRIEFING_STALE: '다른 화면에서 브리핑을 수정했습니다. 날짜를 다시 열어 확인해 주세요.',
  BRIEFING_SOURCE_CHANGED: '원본 내용이 바뀌었습니다. 최신 자료를 불러와 확인해 주세요.',
  BRIEFING_SOURCE_INCOMPLETE: '필수 정보를 확인할 수 없습니다. 최신 자료를 다시 불러와 주세요.',
  BRIEFING_SETTINGS_STALE: '다른 관리자가 설정을 수정했습니다. 설정을 다시 열어 확인해 주세요.',
  BRIEFING_INVALID_SETTINGS: '자동 생성·확인·공유 시각을 순서대로 입력해 주세요.',
  BRIEFING_INVALID_RULE: '반복 문구, 요일·일자 또는 적용 기간을 확인해 주세요.',
  BRIEFING_INVALID_INPUT: '입력 길이와 항목을 확인해 주세요.'
};
const errorText = error => errors[error?.message] || '일일 브리핑을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
let dirty = false;
let active;
export const briefingDirty = () => dirty && Boolean(active?.isConnected);

export async function mountDailyBriefing(target) {
  const app = window.TaejangApp;
  if (!document.querySelector('link[data-daily-briefing]')) {
    const style = node('link');
    style.dataset.dailyBriefing = '';
    style.rel = 'stylesheet';
    style.href = new URL('./daily-briefing.css',import.meta.url).href;
    document.head.append(style);
  }
  const page = node('section',null,'daily-briefing');
  active = page;
  const header = node('header',null,'dashboard-intro');
  header.append(node('h2','일일 브리핑'));
  const tabs = node('nav',null,'quick-links briefing-tabs');
  tabs.setAttribute('aria-label','일일 브리핑');
  const content = node('div');
  page.append(header,tabs,content);
  target.replaceChildren(page);
  let day = nowDate();
  let tab = 'today';
  let busy = false;
  const nav = [
    ['today','오늘의 브리핑',renderToday],
    ['settings','반복 설정',renderSettings],
    ['history','브리핑 이력',renderHistory]
  ];
  for (const [key,title,render] of nav) {
    const control = button(title, () => {
      if (busy || tab === key || !mayLeave()) return;
      tab = key;
      return show(render);
    });
    control.dataset.tab = key;
    tabs.append(control);
  }
  await show(renderToday);

  function mayLeave() {
    return !dirty || window.confirm('저장하지 않은 변경을 취소할까요?');
  }
  async function show(render) {
    if (busy) return;
    busy = true;
    dirty = false;
    for (const control of tabs.children) {
      if (control.dataset.tab === tab) control.setAttribute('aria-current','page');
      else control.removeAttribute('aria-current');
    }
    content.replaceChildren(banner('불러오는 중…'));
    try { await render(); }
    catch (error) {
      content.replaceChildren(banner(errorText(error),true),button('다시 불러오기', () => show(render)));
    } finally { busy = false; }
  }
  function createStatus() {
    const el = node('div',null,'briefing-feedback');
    el.setAttribute('aria-live','polite');
    return el;
  }
  async function run(status, action) {
    if (busy) return;
    busy = true;
    status.replaceChildren();
    try { await action(); }
    catch (error) { status.replaceChildren(banner(errorText(error),true)); }
    finally { busy = false; }
  }

  async function renderToday() {
    drawToday(await app.rpc('get_daily_briefing', {p_day:day}));
  }
  function drawToday(data, feedback) {
    const brief = data.briefing;
    const status = createStatus();
    if (feedback) status.append(banner(feedback));
    const toolbar = node('div',null,'briefing-toolbar');
    const dayInput = input('date',day);
    dayInput.addEventListener('change', () => {
      if (!dayInput.value || busy || !mayLeave()) { dayInput.value = day; return; }
      day = dayInput.value;
      show(renderToday);
    });
    toolbar.append(label('브리핑 날짜',dayInput),node('strong',!brief ? '기록 없음'
      : brief.confirmed_at ? '확정 · v' + brief.version : '초안 · v' + brief.version));
    if (brief && !brief.source.is_workday && !brief.source.issues.includes('근무일 판정')) {
      toolbar.append(node('span','회사 휴무일','briefing-hint'));
    }
    content.replaceChildren(toolbar,status);
    if (!brief) return;
    const meta = node('p',brief.confirmed_at
      ? [brief.confirmer,dateTime(brief.confirmed_at)].filter(Boolean).join(' · ')
      : '자료 기준 ' + dateTime(brief.source.generated_at || brief.created_at) +
        ' · 확인 ' + data.schedule.review_at.slice(0,5) + ' · 공유 ' + data.schedule.share_at.slice(0,5),'briefing-hint');
    content.append(meta);
    if (!brief.confirmed_at && brief.source.issues.length) {
      content.append(banner('확정 전에 확인이 필요합니다. ' + brief.source.issues.join(' · '),true));
    }
    const grid = node('div',null,'briefing-layout');
    const form = node('div',null,'briefing-editor');
    const output = node('pre',null,'briefing-output');
    const preview = node('section',null,'briefing-preview');
    preview.append(node('h3','카카오톡 메시지'),output);
    preview.tabIndex = -1;
    toolbar.append(button('메시지 보기', () => {
      preview.scrollIntoView({block:'start'});
      preview.focus({preventScroll:true});
    }));
    const actions = node('div',null,'quick-links briefing-actions');
    const working = {...brief,edits:{...brief.edits},hidden:[...brief.hidden]};
    const refreshPreview = () => { output.textContent = briefingMessage(working); };
    refreshPreview();
    if (brief.confirmed_at) {
      actions.append(button('수정본 작성', () => save('revise')));
      addDeliveryButtons(actions,brief,output,status);
      grid.append(preview);
    } else {
      for (const [key,caption] of sections) {
        const card = node('section',null,'briefing-section');
        const head = node('div',null,'briefing-section-head');
        const visible = input('checkbox',!working.hidden.includes(key));
        const field = node('textarea');
        field.rows = Math.min(5,Math.max(2,sectionText(working,key).split('\n').length));
        field.maxLength = 6000;
        field.value = sectionText(working,key);
        field.readOnly = key === 'staff';
        field.setAttribute('aria-label',caption);
        head.append(node('h3',caption),label('표시',visible));
        const reset = button('자동 내용 사용', () => {
          delete working.edits[key];
          field.value = sectionText(working,key);
          dirty = true;
          update();
        });
        function update() {
          field.disabled = !visible.checked;
          reset.hidden = !Object.hasOwn(working.edits,key);
          refreshPreview();
        }
        visible.addEventListener('change', () => {
          working.hidden = working.hidden.filter(hidden => hidden!==key);
          if (!visible.checked) working.hidden.push(key);
          dirty = true;
          update();
        });
        field.addEventListener('input', () => {
          working.edits[key] = field.value;
          dirty = true;
          update();
        });
        card.append(head,field);
        if (key !== 'staff') card.append(reset);
        update();
        form.append(card);
      }
      const note = node('textarea');
      note.rows = 2;
      note.maxLength = 1000;
      note.value = working.note;
      note.placeholder = '오늘만 전달할 내용을 입력하세요.';
      note.addEventListener('input', () => {
        working.note = note.value;
        dirty = true;
        refreshPreview();
      });
      form.append(label('오늘 특이사항',note));
      actions.append(button('최신 자료 불러오기', () => save('refresh')),
        button('초안 저장', () => save('save')));
      const confirm = button('브리핑 확정', () => save('confirm'),false);
      confirm.disabled = Boolean(brief.source.issues.length);
      actions.append(confirm);
      grid.append(form,preview);
    }
    refreshPreview();
    content.append(actions,grid);

    function save(action) {
      return run(status,async () => {
        const controls = [...content.querySelectorAll('input,textarea,button')].filter(control => !control.disabled);
        const payload = {
          p_day:brief.work_date,p_version:brief.version,p_updated_at:brief.updated_at,p_action:action,
          p_edits:working.edits,p_hidden:working.hidden,p_note:working.note
        };
        controls.forEach(control => { control.disabled = true; });
        try {
          const data = await app.rpc('write_daily_briefing',payload);
          dirty = false;
          drawToday(data,({save:'초안을 저장했습니다.',refresh:'최신 자료를 반영했습니다. 수동 편집은 유지했습니다.',
            confirm:'브리핑을 확정했습니다.',revise:'새 수정본을 열었습니다.'})[action]);
        } finally {
          controls.forEach(control => { control.disabled = false; });
        }
      });
    }
  }

  function addDeliveryButtons(actions,brief,output,status) {
    actions.append(button('전문 복사', () => deliver(false),false));
    if (navigator.share && (!navigator.canShare || navigator.canShare({text:output.textContent}))) {
      actions.append(button('카카오톡 공유', () => deliver(true)));
      actions.append(node('span','공유 목록에서 카카오톡과 업무방을 선택하세요.','briefing-hint'));
    }
    async function deliver(share) {
      if (busy) return;
      busy = true;
      const text = output.textContent;
      let result;
      let message;
      let failed = false;
      try {
        if (share) await navigator.share({text});
        else await navigator.clipboard.writeText(text);
        result = share ? 'share_requested' : 'copied';
        message = share ? '공유를 요청했습니다. 업무방에서 전송을 확인해 주세요.' : '복사했습니다. 카카오톡 업무방에 붙여넣으세요.';
      } catch (error) {
        failed = true;
        result = share ? (error.name === 'AbortError' ? 'share_cancelled' : 'share_failed') : 'copy_failed';
        message = result === 'share_cancelled' ? '공유를 취소했습니다.'
          : share ? '공유하지 못했습니다. 전문 복사를 사용해 주세요.' : '자동 복사에 실패했습니다. 미리보기에서 선택한 문장을 복사해 주세요.';
        if (!share) {
          const range = document.createRange();
          range.selectNodeContents(output);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
        }
      }
      status.replaceChildren(banner(message,failed && result!=='share_cancelled'));
      try {
        await app.rpc('record_daily_briefing_delivery',{p_id:crypto.randomUUID(),p_day:brief.work_date,
          p_version:brief.version,p_action:result});
      } catch {
        status.append(banner('전달 이력을 저장하지 못했습니다.',true));
      } finally { busy = false; }
    }
  }

  async function renderHistory() {
    const status = createStatus();
    const list = node('div',null,'briefing-history');
    const detail = node('section',null,'briefing-preview');
    content.replaceChildren(status,list,detail);
    await addHistoryPage();
    async function addHistoryPage(cursor) {
      const records = await app.rpc('list_daily_briefings',{
        p_before:cursor?.work_date ?? null,p_version:cursor?.version ?? null
      });
      if (!cursor && !records.length) list.append(node('p','작성된 브리핑이 없습니다.'));
      for (const record of records) {
        const item = node('article',null,'briefing-history-row');
        const info = node('div');
        info.append(node('strong',record.work_date + ' · v' + record.version + (record.confirmed_at ? ' · 확정' : ' · 초안')),
          node('p','작성 ' + record.author + ' · ' + dateTime(record.created_at)),
          node('p','수정 ' + (record.editor || '자동 생성') + ' · ' + dateTime(record.updated_at)));
        if (record.confirmed_at) info.append(node('p','확정 ' + record.confirmer + ' · ' + dateTime(record.confirmed_at)));
        info.append(node('p',(record.delivery_actions || []).map(action => deliveryLabels[action]).join(' / ') || '전달 기록 없음'));
        item.append(info,button('내용 보기', () => run(status,async () => {
          const brief = await app.rpc('get_daily_briefing_version',{p_day:record.work_date,p_version:record.version});
          const output = node('pre',briefingMessage(brief),'briefing-output');
          const actions = node('div',null,'quick-links');
          detail.replaceChildren(node('h3',record.work_date + ' · v' + record.version),output);
          if (brief.confirmed_at) addDeliveryButtons(actions,brief,output,status);
          actions.append(button('이 날짜 열기', () => {
            day = record.work_date;
            tab = 'today';
            show(renderToday);
          }));
          detail.append(actions);
          for (const entry of brief.deliveries) {
            detail.append(node('p',deliveryLabels[entry.action] + ' · ' + entry.by + ' · ' + dateTime(entry.at),'briefing-hint'));
          }
          detail.scrollIntoView({block:'nearest'});
        })));
        list.append(item);
      }
      if (records.length === 30) {
        const next = button('이전 이력 더 보기', () => run(status,async () => {
          await addHistoryPage(records.at(-1));
          next.remove();
        }));
        list.append(next);
      }
    }
  }

  async function renderSettings() {
    const settings = await app.rpc('get_daily_briefing_settings');
    const admin = app.getRoute() === 'operations_manager';
    const status = createStatus();
    const panel = node('section',null,'briefing-settings');
    const schedule = node('div',null,'briefing-settings-fields');
    const enabled = input('checkbox',settings.enabled);
    const generate = input('time',settings.generate_at.slice(0,5));
    const review = input('time',settings.review_at.slice(0,5));
    const share = input('time',settings.share_at.slice(0,5));
    for (const field of [enabled,generate,review,share]) field.disabled = !admin;
    schedule.append(label('근무일 자동 생성',enabled),label('생성 시각',generate),
      label('확인 시각 안내',review),label('공유 시각 안내',share));
    const rules = node('div',null,'briefing-rules');
    const readers = new Map();
    function addRule(rule) {
      const row = node('article',null,'briefing-section');
      const text = node('textarea');
      text.value = rule.text;
      text.rows = 2;
      text.maxLength = 400;
      const active = input('checkbox',rule.active);
      const kind = select([['task','오늘의 업무'],['rule','기본 근무수칙']],rule.kind);
      const audience = select([['전체','전체'],['오전반','오전반'],['오후반','오후반']],rule.audience);
      const frequency = select([['workday','매 근무일'],['weekly','지정 요일'],['monthly','매월 지정일'],['period','지정 기간']],rule.frequency);
      const from = input('date',rule.from);
      const until = input('date',rule.until);
      const monthDay = input('number',rule.month_day ?? 1);
      monthDay.min = 1;
      monthDay.max = 31;
      const order = input('number',rule.order);
      order.min = 0;
      order.max = 999;
      const weekdays = node('fieldset',null,'briefing-weekdays');
      weekdays.append(node('legend','적용 요일'));
      const dayInputs = ['월','화','수','목','금','토','일'].map((day,i) => {
        const option = input('checkbox',rule.weekdays?.includes(i + 1));
        weekdays.append(label(day,option));
        return option;
      });
      const fields = node('div',null,'briefing-settings-fields');
      const monthLabel = label('매월 일자',monthDay);
      function recurrenceFields() {
        weekdays.hidden = frequency.value !== 'weekly';
        monthLabel.hidden = frequency.value !== 'monthly';
      }
      frequency.addEventListener('change',recurrenceFields);
      recurrenceFields();
      fields.append(label('사용',active),label('구분',kind),label('대상',audience),label('반복 조건',frequency),
        label('시작일',from),label('종료일',until),monthLabel,label('표시 순서',order));
      row.append(label('반복 문구',text),fields,weekdays,button('이 문구 삭제', () => {
        readers.delete(row);
        row.remove();
        dirty = true;
      }));
      rules.append(row);
      readers.set(row,() => ({text:text.value.trim(),kind:kind.value,audience:audience.value,
        frequency:frequency.value,from:from.value||null,until:until.value||null,
        weekdays:dayInputs.flatMap((option,i) => option.checked ? [i+1] : []),
        month_day:Number(monthDay.value),order:Number(order.value),active:active.checked}));
    }
    settings.rules.forEach(addRule);
    panel.addEventListener('input', () => { dirty = true; });
    const actions = node('div',null,'quick-links');
    actions.append(button('반복 문구 추가', () => {
      addRule({text:'',active:true,kind:'task',audience:'전체',frequency:'workday',order:readers.size+1});
      dirty = true;
      rules.lastElementChild.querySelector('textarea').focus();
    }),button('설정 저장', () => run(status,async () => {
      const data = await app.rpc('save_daily_briefing_settings',{
        p_version:settings.version,p_enabled:enabled.checked,p_generate:generate.value,
        p_review:review.value,p_share:share.value,p_rules:[...readers.values()].map(read => read())
      });
      settings.version = data.version;
      dirty = false;
      status.append(banner('반복 설정을 저장했습니다.'));
    }),false));
    panel.append(node('h3','예약 시간'),schedule,node('p','한국 시간 기준 · 확인과 공유는 운영팀장이 진행합니다.','briefing-hint'),
      node('h3','반복 문구'),rules,actions);
    content.replaceChildren(status,panel);
  }
}

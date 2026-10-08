(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangAttendanceMonthly = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const labels = Object.freeze({ work:'출근', paid_leave:'유급휴가', unpaid_absence:'결근', paid_holiday:'유급휴일', off:'비대상', review_required:'확인 필요' });
  function monthDates(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || Number(month.slice(0,4)) < 1900) throw new Error('INVALID_MONTH');
    const [year,m] = month.split('-').map(Number);
    return Array.from({length:new Date(Date.UTC(year,m,0)).getUTCDate()},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
  }
  function time(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  }
  function cell(record,live,day,employee,date) {
    if (record) {
      const raw=record.record_snapshot?.attendance_status;
      const code=(typeof raw==='object' ? raw?.status : raw) || 'work';
      const missing=code==='work' && (!record.clock_in_at || !record.clock_out_at);
      return {label:missing?'누락':labels[code] || '확인 필요',code,confirmed:true,review:missing || code==='review_required' || !Object.hasOwn(labels,code),clockIn:time(record.clock_in_at),clockOut:time(record.clock_out_at),record};
    }
    if (!day) return {label:'조회 실패',confirmed:false,review:true,clockIn:'',clockOut:''};
    if (!live) {
      const outside=(employee?.hired_on && date<employee.hired_on)||(employee?.departed_on && date>employee.departed_on);
      return {label:outside?'재직기간 밖':(day.workday?.is_workday===false ? '휴일·비대상' : '비대상'),confirmed:false,review:false,clockIn:'',clockOut:''};
    }
    const code=live.attendance_status?.status || 'work';
    const holiday=day.workday?.is_workday===false && !(day.assignments || []).some(r=>String(r.employee_uuid)===String(employee.employee_uuid));
    if (holiday && code==='work' && !live.clock_in?.event_at && !live.clock_out?.event_at) return {label:'휴일',confirmed:false,review:false,clockIn:'',clockOut:''};
    const valid=e=>e?.event_at && !['exception_pending','exception_rejected','correction_invalidated'].includes(e.status);
    const clockIn=valid(live.clock_in)?time(live.clock_in.event_at):'';
    const clockOut=valid(live.clock_out)?time(live.clock_out.event_at):'';
    const missing=code==='work' && (!clockIn || !clockOut);
    return {label:`${missing?'누락':labels[code] || '확인 필요'} · 미확정`,code,confirmed:false,review:true,clockIn,clockOut};
  }
  function buildMonth({month,ledger,daily,employees=[],queriedAt=new Date().toISOString()}) {
    const dates=monthDates(month),people=new Map(),records=new Map();
    const metadata=new Map(employees.map(e=>[String(e.id),e]));
    // Metadata never adds identities beyond the attendance-authorized roster.
    for (const r of ledger?.rows || []) {
      if (r.is_reopened || !dates.includes(r.work_date)) continue;
      const key=`${r.employee_uuid}|${r.work_date}`;
      if (records.has(key)) throw new Error('DUPLICATE_CONFIRMED_EMPLOYEE_DAY');
      records.set(key,r);
      people.set(String(r.employee_uuid),{employee_uuid:r.employee_uuid,employee_id:r.employee_id_at_confirmation,display_name:r.display_name_at_confirmation});
    }
    for (const date of dates) for (const r of daily[date]?.rows || []) {
      people.set(String(r.employee_uuid),{...r,...people.get(String(r.employee_uuid))});
    }
    const rows=[...people.values()].map(person=>{
      const meta=metadata.get(String(person.employee_uuid)) || {};
      const employee={...meta,...person};
      employee.cells=dates.map(date=>cell(records.get(`${person.employee_uuid}|${date}`),daily[date]?.rows?.find(r=>String(r.employee_uuid)===String(person.employee_uuid)),daily[date],employee,date));
      employee.confirmedDays=employee.cells.filter(c=>c.confirmed).length;
      employee.reviewDays=employee.cells.filter(c=>c.review).length;
      return employee;
    }).sort((a,b)=>b.reviewDays-a.reviewDays || String(a.employee_id || '').localeCompare(String(b.employee_id || ''),'ko'));
    return {month,dates,rows,queriedAt,fingerprint:ledger?.period_fingerprint || '',failedDays:dates.filter(d=>!daily[d])};
  }
  function workbookSheets(model,rows=model.rows,scope='전체') {
    const note=`${model.dates[0]}~${model.dates.at(-1)} / ${scope} / 조회 ${model.queriedAt} / 한국시간 / 원장 ${model.fingerprint || '미등록'} / 미확정은 급여 인정시간이 아님`;
    return [
      {name:'월간 출근부',title:`태장 ${model.month} 월간 출근부`,note,headers:['사번','이름',...model.dates,'확정일수','확인 필요일수'],rows:rows.map(r=>[r.employee_id || '미등록',r.display_name || '미등록',...r.cells.map(c=>`${c.label}${c.clockIn || c.clockOut ? ` ${c.clockIn || '-'}~${c.clockOut || '-'}`:''}`),r.confirmedDays,r.reviewDays])},
      {name:'일별 상세',title:`태장 ${model.month} 근태 상세`,note,headers:['사번','이름','날짜','상태','출근(KST)','퇴근(KST)','확정','예외','revision','원장 근거'],rows:rows.flatMap(r=>r.cells.map((c,i)=>[r.employee_id || '미등록',r.display_name || '미등록',model.dates[i],c.label,c.clockIn,c.clockOut,c.confirmed?'확정':'미확정/비대상',c.review?'확인 필요':'',c.record?.revision_no || '',c.record?.record_fingerprint || '']))}
    ];
  }

  function classify(row, metadata = {}) {
    const linked = metadata.linked_profile;
    const knownAccount = linked?.account_status || (row.account_linked === true ? (row.account_active === true ? 'active' : row.account_active === false ? 'inactive' : null) : null);
    return {
      ...row,
      department: metadata.department_name || (Object.hasOwn(metadata,'department_name') ? '미배정' : '미확인'),
      job: metadata.position_name || '미확인',
      groups: metadata.groups || [],
      leaders: metadata.leaders || [],
      groupState: metadata.groupsKnown ? ((metadata.groups || []).length ? '배정' : '미배정') : '미확인',
      leaderState: metadata.groupsKnown ? ((metadata.leaders || []).length ? '배정' : '미배정') : '미확인',
      employment: metadata.employment_status || '미확인',
      attendance: typeof metadata.attendance_required === 'boolean' ? (metadata.attendance_required ? '대상' : '비대상') : '미확인',
      account: knownAccount ? (knownAccount === 'active' ? '활성' : '비활성·삭제') : (row.account_linked === false ? '미연결' : '미확인'),
      // No name/email/position heuristic is evidence of a test identity.
      testAccount: metadata.is_test_account === true || row.is_test_account === true,
    };
  }
  function matches(row, filters) {
    const query = (filters.search || '').trim().toLocaleLowerCase();
    if (!(String(row.display_name || '') + ' ' + String(row.employee_id || '')).toLocaleLowerCase().includes(query)) return false;
    if (filters.accounts !== 'all' && (row.account === '비활성·삭제' || row.testAccount)) return false;
    for (const key of ['department', 'job', 'employment', 'attendance']) if (filters[key] && row[key] !== filters[key]) return false;
    if (filters.group && !(row.groups || []).includes(filters.group) && row.groupState !== filters.group) return false;
    if (filters.leader && !(row.leaders || []).includes(filters.leader) && (row.leaders?.length || 0 || row.leaderState !== filters.leader)) return false;
    return true;
  }

  function download(model,rows,writer,scope='전체') {
    const bytes=writer.buildTableWorkbookXlsx(workbookSheets(model,rows,scope));
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download=`태장_월간출근부_${model.month}${rows.length===1?'_개인':''}.xlsx`;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return Object.freeze({monthDates,time,buildMonth,workbookSheets,download,classify,matches});
});

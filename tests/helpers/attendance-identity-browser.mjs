import assert from 'node:assert/strict';

// Deployed bundles and real Chrome DOM; all RPCs are synthetic, no DB requests.
export async function verifyIdentityUi(page, preview) {
 await page.evaluate(() => {
   document.body.innerHTML = '<div id="desktop-page-title"></div><main id="dashboard-main"></main>';
   window.identityCalls=[]; window.identityConfirmations=[]; window.identityAlerts=[];
   window.confirm=message=>{window.identityConfirmations.push(message);return window.identityAccept!==false;};
   window.alert=message=>window.identityAlerts.push(message);
   window.identityEvidence=Array.from({length:21},(_,i)=>{
     const employee={employee_uuid:'synthetic-'+i,employee_id:'TJ-'+(506000+i),display_name:'가상근로자'+i,department_name:'가상부서',team_name:'가상팀',position_name:'가상직책'};
     return {id:'evidence-'+i,source_system:'fingerprint_excel',source_employee_key:'DEVICE-'+i,source_display_name:employee.display_name,
       clock_in_at:'2026-10-18T23:47:00Z',clock_out_at:'2026-10-19T03:01:00Z',employee_uuid:null,
       identity:{mapping_employee_uuid:null,candidate_employee_uuid:employee.employee_uuid,candidates:[employee],employees:[employee],name_reused:false,time_conflict:false}};
   });
   window.identityAllowed=true;
   window.TaejangApp={getRoute:()=> 'promotion_lead',hasCapabilityContract:()=>true,can:cap=>window.identityAllowed && ['attendance.admin_view','attendance.evidence_import'].includes(cap),
    rpc:async(name,params)=>{
     window.identityCalls.push({name,params});
     if(name==='get_attendance_admin_today') return {work_date:'2026-10-19',rows:[]};
     if(name==='get_attendance_external_evidence') return {rows:window.identityEvidence,raw_row_count:42,batches:[{source_file_name:'synthetic-a.xls',import_row_count:21,import_unmatched_count:21,source_fingerprint:'synthetic-hash-a'},{source_file_name:'synthetic-b.xlsx',import_row_count:21,import_unmatched_count:21,source_fingerprint:'synthetic-hash-b'}]};
     if(name==='get_attendance_workday_status')return {is_workday:true};
     if(name==='save_attendance_source_identity_mapping') {
       if(window.identityFail) return {ok:false,code:'CANDIDATE_CHANGED'};
       const item=window.identityEvidence.find(e=>e.source_employee_key===params.p_source_employee_key);
       item.employee_uuid=params.p_employee_uuid;item.identity.mapping_employee_uuid=params.p_employee_uuid;
       return {ok:true,code:'IDENTITY_MAPPING_SAVED'};
     }
     return {rows:[],blockers:[],is_confirmed:false};
    }};
 });
 await page.addScriptTag({url:preview+'/app/assets/attendance-monthly.js'});
 await page.addScriptTag({url:preview+'/app/assets/attendance-admin.js'});
 await page.evaluate(()=>window.TaejangAttendanceAdmin.openAttendance('2026-10-19'));
 await page.getByText('안전한 이름 일치 후보 21명',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.identityCalls.filter(c=>c.name.startsWith('save_')).length),0,'view must never save');
 await page.evaluate(()=>window.identityAccept=false);
 await page.getByRole('button',{name:'일치 직원 일괄 연결',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.identityCalls.filter(c=>c.name.startsWith('save_')).length),0,'cancel must never save');
 await page.evaluate(()=>window.identityAccept=true);
 await page.getByRole('button',{name:'일치 직원 일괄 연결',exact:true}).click();
 await page.getByText('직원 미매칭 지문자료 0건 (현재 상태)',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.identityCalls.filter(c=>c.name.startsWith('save_')).length),21);
 assert.match(await page.evaluate(()=>window.identityAlerts.at(-1)),/21명 완료/);
 // Replacement is a second, separately cancellable dialog.
 await page.getByText('미매칭 수동 연결·기존 연결 확인/변경',{exact:true}).click();
 await page.evaluate(()=>{
   window.identityEvidence[0].identity.employees.push({employee_uuid:'other-person',employee_id:'TJ-999999',display_name:'다른가상직원'});
 });
 await page.evaluate(()=>window.TaejangAttendanceAdmin.openAttendance('2026-10-19'));
 await page.getByText('미매칭 수동 연결·기존 연결 확인/변경',{exact:true}).click();
 await page.getByRole('combobox',{name:'가상근로자0 연결할 직원',exact:true}).selectOption('other-person');
 await page.evaluate(()=>{
   window.confirm=message=>{window.identityConfirmations.push(message);return !message.includes('명시적으로 교체');};
 });
 await page.getByRole('button',{name:'직원 연결 변경',exact:true}).first().click();
 assert.equal(await page.evaluate(()=>window.identityCalls.filter(c=>c.name.startsWith('save_')).length),21,'cancel replacement cannot write');
 assert.match(await page.evaluate(()=>window.identityConfirmations.at(-1)),/명시적으로 교체/);
 // Conflict, homonym, missing, and server refusal remain visible, without bulk guesses.
 await page.evaluate(()=>{
   window.identityEvidence.forEach(e=>{e.employee_uuid=null;e.identity.mapping_employee_uuid=null;});
   window.identityEvidence[0].identity.name_reused=true;
   window.identityEvidence[1].identity.time_conflict=true;
   window.identityEvidence[2].identity.candidate_employee_uuid=null;
   window.identityEvidence[2].identity.candidates.push({employee_uuid:'homonym',employee_id:'TJ-888888',display_name:'동명이인'});
   window.identityEvidence[3].identity.candidate_employee_uuid=null;window.identityEvidence[3].identity.candidates=[];
   window.identityFail=true;window.confirm=()=>true;
 });
 await page.evaluate(()=>window.TaejangAttendanceAdmin.openAttendance('2026-10-19'));
 await page.getByText('안전한 이름 일치 후보 17명',{exact:true}).waitFor();
 await page.getByText('미매칭 수동 연결·기존 연결 확인/변경',{exact:true}).click();
 await page.getByText('연결 중지: 같은 지문기 번호의 과거 이름이 다릅니다.',{exact:true}).waitFor();
 await page.getByText('동명이인: 사번·부서·팀·직책을 비교하여 직접 선택해 주세요.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'일치 직원 일괄 연결',exact:true}).click();
 await page.waitForFunction(()=>window.identityAlerts.at(-1)?.includes('중지/미처리 17명'));
 assert.equal(await page.evaluate(()=>window.identityCalls.filter(c=>c.name.startsWith('save_')).length),22,'stop at first server refusal');
 // Read-only viewer sees evidence but no mapping controls.
 await page.evaluate(()=>{window.TaejangApp.can=cap=>cap==='attendance.admin_view';});
 await page.evaluate(()=>window.TaejangAttendanceAdmin.openAttendance('2026-10-19'));
 assert.equal(await page.getByRole('button',{name:'일치 직원 일괄 연결',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'직원 연결',exact:true}).count(),0);
}

// Called only by the localhost-only real Auth/Edge runner. No hosted fixtures.
export async function personalEmployeeAuth({fixture,rpc,sql,edge,api,check,ops,base,anon}) {
  if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('isolated Supabase required');
  check(Number(sql("select count(*) from public.menu_authority_catalog where adapter_ready"))===0,'all candidate adapters ship disabled');
  const actor=await fixture('menu-auth-delegate');
  const target=await fixture('menu-auth-target');
  const roleSnapshot=()=>sql(`select jsonb_agg(to_jsonb(r) order by id)::text from public.profile_roles r where profile_id='${actor.id}'`);
  const originalRoles=roleSnapshot();
  const grant=allowed=>rpc('set_profile_menu_authority',ops.token,{p_profile_id:actor.id,p_menu_key:'employee.manage',p_allowed:allowed,
    p_expected_revision:allowed?0:1,p_reason:allowed?'isolated menu grant':'isolated menu revoke'});
  check(!(await grant(true)).ok,'unverified adapter cannot be granted');
  // Fixture opt-in only. Never persist a ready flag into the candidate migration.
  sql("update public.menu_authority_catalog set adapter_ready=true where menu_key='employee.manage'");
  try {
    check((await grant(true)).ok,'real operations actor can grant employee menu');
    const admin=await rpc('get_menu_authority_administration',ops.token,{});
    check(admin.ok&&admin.data.accounts.some(a=>a.id===actor.id),'real enum administration lists delegate');
    const own=await rpc('get_my_access_context_v2',actor.token,{});
    check(own.ok&&own.data.capabilities.includes('employee.update')&&!own.data.capabilities.includes('payroll.manage'),'only employee capability bundle added');
    const roster=await rpc('get_employee_management_context',actor.token,{});
    check(roster.ok&&roster.data.access_level==='operations_manager','real delegate gets common employee UI branch');
    check(roster.data.employees.some(e=>e.id===target.e&&e.linked_profile?.work_email===target.email),'delegate receives same linked email fields');
    check(!(await rpc('get_menu_authority_administration',actor.token,{})).ok,'delegate cannot administer authority');
    const roleDenied=await rpc('set_profile_roles',actor.token,{p_target_profile_id:target.id,p_role_codes:['operations_manager'],p_reason_summary:'denied synthetic'});
    check(roleDenied.ok&&roleDenied.data?.ok===false&&roleDenied.data.code==='FORBIDDEN','delegate cannot assign operations role');
    const department=sql('select id from public.departments where active order by sort_order limit 1');
    const position=sql("select id from public.positions where code='general_worker'");
    const created=await rpc('create_employee',actor.token,{p_full_name:'Menu Auth synthetic employee',p_hired_on:'2026-01-01',p_department_id:department,p_position_id:position,p_attendance_required:false});
    check(created.ok&&created.data.employee_uuid,'delegate employee registration succeeds');
    const employee=created.data.employee_uuid;
    const edit={p_employee_uuid:employee,p_full_name:'Menu Auth synthetic edited',p_hired_on:'2026-01-01',p_department_id:department,
      p_position_id:position,p_employment_status:'active',p_departed_on:null,p_attendance_required:false,p_reason:'isolated employee update'};
    check((await rpc('update_employee_core',actor.token,edit)).ok,'delegate employee edit persists');
    const photoPath=employee+'/id_photo/isolated.png';
    const photoBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=','base64');
    const storage=async(token,method,path=photoPath)=>{
      const response=await fetch(base+'/storage/v1/object/'+(method==='GET'?'authenticated/':'')+'employee-private-media/'+path,
        {method,headers:{apikey:anon,Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'image/png'}:{})},...(method==='POST'?{body:photoBytes}:{})});
      await response.arrayBuffer();return response;
    };
    check((await storage(actor.token,'POST')).ok,'real Storage upload uses delegate JWT and RLS');
    check((await rpc('set_employee_photo',actor.token,{p_employee_uuid:employee,p_photo_type:'id_photo',p_storage_path:photoPath})).ok,'photo pointer saved');
    const photoReload=await rpc('get_employee_management_context',actor.token,{});
    check(photoReload.ok&&photoReload.data.employees.find(e=>e.id===employee)?.id_photo_path===photoPath,'saved photo pointer survives employee requery');
    check((await storage(actor.token,'GET')).ok,'authenticated Storage GET succeeds before revoke');
    const digits='820103123456';
    const weights=[2,3,4,5,6,7,8,9,2,3,4,5];
    const resident=digits+((11-[...digits].reduce((n,v,i)=>n+Number(v)*weights[i],0)%11)%10);
    const saved=await rpc('set_employee_resident_registration_number',actor.token,{p_employee_uuid:employee,p_resident_number:resident});
    check(saved.ok&&saved.data.resident_number_registered,'Vault sensitive identity setter succeeds for delegate');
    check(sql(`select (decrypted_secret='${resident}')::text from vault.decrypted_secrets where name='employee_rrn_${employee}'`)==='true','Vault decryption uses original server secret');
    check(sql(`select (secret<>'${resident}')::text from vault.secrets where name='employee_rrn_${employee}'`)==='true','persisted Vault secret is encrypted');
    const revealed=await rpc('get_employee_resident_registration_number',actor.token,{p_employee_uuid:employee,p_purpose:'employee_administration'});
    check(revealed.ok&&revealed.data.resident_number===resident,'delegate purpose-bound Vault read succeeds');
    check(!(await rpc('get_employee_resident_registration_number',actor.token,{p_employee_uuid:employee,p_purpose:'arbitrary'})).ok,'Vault read still requires allowed purpose');
    check(Number(sql(`select count(*) from public.audit_logs where target_id='${employee}' and action='employee_resident_number_viewed' and outcome='success'`))===1,'Vault read retains explicit access audit');
    const insurance={p_employee_uuid:employee,p_payroll_month:'2026-10-01',p_national_pension_on:false,p_health_insurance_on:true,p_employment_insurance_on:true,p_note:'isolated employee insurance settings'};
    check((await rpc('set_employee_insurance_deduction_settings',actor.token,insurance)).ok,'delegate saves employee insurance without payroll menu');
    check((await rpc('get_employee_insurance_deduction_settings',actor.token,{p_employee_uuid:employee,p_payroll_month:'2026-10-01'})).ok,'delegate reads employee insurance');
    check(!(await api('/rest/v1/employee_photos',{token:actor.token})).ok,'raw employee photo table is not generally exposed');
    check(!(await rpc('change_account_status',actor.token,{p_target_profile_id:ops.id,p_new_status:'suspended',p_reason_summary:'isolated protected actor'})).ok,'operations account remains protected');
    const reset=await edge(actor,target);
    check(reset.ok&&/^\d{16}$/.test(reset.data?.temporary_password),'delegate Edge reserve/begin/Admin/audit success path');
    check((await api('/auth/v1/token?grant_type=password',{body:{email:target.email,password:reset.data.temporary_password}})).data?.user?.id===target.id,'temporary credential authenticates same target UID');
    check(Number(sql(`select count(*) from public.audit_logs where target_id='${target.e}' and action='employee_credential_reset_finished' and outcome='success'`))===1,'delegate reset writes exactly one durable audit');
    reset.data.temporary_password='';
    check((await rpc('archive_employee',actor.token,{p_employee_uuid:employee,p_reason:'isolated employee archive'})).ok,'delegate archive succeeds');
    check((await rpc('restore_employee',actor.token,{p_employee_uuid:employee,p_reason:'isolated employee restore'})).ok,'delegate restore succeeds');
    check(roleSnapshot()===originalRoles,'employee menu never changes actual role records');
    check((await grant(false)).ok,'operations actor revokes the same menu revision');
    for(const [name,args] of [['get_employee_management_context',{}],['update_employee_core',edit],
      ['set_employee_photo',{p_employee_uuid:employee,p_photo_type:'id_photo',p_storage_path:photoPath}],
      ['set_employee_resident_registration_number',{p_employee_uuid:employee,p_resident_number:resident}],
      ['get_employee_resident_registration_number',{p_employee_uuid:employee,p_purpose:'employee_administration'}],
      ['set_employee_insurance_deduction_settings',insurance],['employee_password_reset_option',{p_employee_uuid:target.e}]]) {
      const denied=await rpc(name,actor.token,args);check(!denied.ok&&denied.status===403,'revoked direct employee endpoint denied: '+name);
    }
    check(!(await storage(actor.token,'GET')).ok,'previous JWT cannot GET photo after revoke');
    check(!(await storage(actor.token,'POST',employee+'/id_photo/revoked.png')).ok,'previous JWT cannot upload after revoke');
    check(!(await edge(actor,target)).ok,'revoked direct Edge reset denied');
    check(roleSnapshot()===originalRoles,'revocation leaves actual roles unchanged');
    console.log('PERSONAL_MENU_EMPLOYEE_AUTH_STORAGE_VAULT_EDGE_PASS');
  } finally {
    sql("update public.menu_authority_catalog set adapter_ready=false where menu_key='employee.manage'");
  }
}

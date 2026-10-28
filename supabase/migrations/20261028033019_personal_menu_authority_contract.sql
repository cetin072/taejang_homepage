-- Personal menu authority foundation. No existing visibility setting is imported.
-- New grants remain blocked until each menu passes isolated Auth/RLS/Storage QA.
begin;

create table public.menu_authority_catalog (
  menu_key text primary key,
  label text not null,
  scope_summary text not null,
  sensitive_fields text[] not null default '{}',
  capabilities text[] not null default '{}',
  adapter_ready boolean not null default false
);
create table public.profile_menu_authority (
  profile_id uuid not null references public.profiles(id),
  menu_key text not null references public.menu_authority_catalog(menu_key),
  allowed boolean not null,
  revision bigint not null check (revision > 0),
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 3 and 300),
  primary key(profile_id,menu_key)
);
alter table public.menu_authority_catalog enable row level security;
alter table public.profile_menu_authority enable row level security;
revoke all on public.menu_authority_catalog,public.profile_menu_authority from public,anon,authenticated;

-- These are reviewed authority bundles, not a wildcard over capabilities or role names.
-- No bundle includes role assignment, delegation administration, or technical authority.
-- A menu remains unavailable for new grants until its complete server adapter is verified.
insert into public.menu_authority_catalog(menu_key,label,scope_summary,sensitive_fields,capabilities) values
 ('employee.manage','직원 관리','전사 직원 조회·등록·수정·보관·복원, 사진·신원정보 관리, 계정 연결·상태·소속 관리. 권한 재위임 및 역할 변경 제외.',
  array['이메일','연락처','신분증 사진','주민등록번호','생년월일·보험정보'],
  array['employee.view_all','employee.view_scoped','employee.create','employee.update','employee.archive','employee.restore','employee.account_link','employee.account_unlink','employee.profile_photo_manage_scoped','employee.id_photo_manage','employee.review_change_requests','employee.sensitive_identity_manage','employee.resident_number_manage','employee.field_audit_manage','employee.password_reset','account.status_manage','account.organization_manage','account.view_management','employee.request_change']),
 ('employee.new','신규 직원 등록','신규 직원 등록에 필요한 조직·직책 조회와 등록. 기존 직원 전체 조회·계정 승인 제외.',array['성명','입사일','소속·직책'],array['employee.create']),
 ('account.approval','가입 승인','가입 신청 조회·승인·반려와 기존 직원 연결. 관리자 역할 부여 제외.',array['신청자 이메일','신청자 인사정보'],array['account.approve','account.reject','employee.onboard']),
 ('promotion.write','홍보 글 작성','운영총괄 작성 화면의 초안 작성·수정·첨부·상신.',array['미공개 홍보 원고','첨부 사진'],array['promotion.write','promotion.edit_own','promotion.edit_any_unpublished']),
 ('promotion.sent','보낸 글','운영총괄의 상신 목록과 처리 상태 조회.',array['미공개 홍보 원고'],array[]::text[]),
 ('promotion.review','홍보 승인 검토','운영총괄 단계의 검토·승인·반려. 대표이사 승인 단계는 대체하지 않음.',array['미공개 홍보 원고'],array['promotion.review_operations']),
 ('promotion.publication','발행 현황','운영총괄의 발행 현황 조회.',array[]::text[],array[]::text[]),
 ('promotion.existing','공개 홍보글 관리','공개글 수정·숨김·재공개·보관·복원·영구삭제. 기존 승인선과 삭제 확인 유지.',array['홍보 원고','첨부 사진'],array['promotion.hide','promotion.republish','promotion.archive','promotion.restore','promotion.manage_recent_public']),
 ('homepage.content','홈페이지 내용 관리','슬롯 초안·검토·승인 및 공개 반영.',array[]::text[],array['homepage.draft','homepage.review','homepage.approve_apply']),
 ('homepage.direct','홈페이지 직접 수정','승인된 safe-slot 직접 편집·반영.',array[]::text[],array['homepage.direct_edit']),
 ('notice.manage','공지 관리','전사 공지 조회·작성·수정·게시·보관·복원·첨부 관리.',array['내부 공지','첨부'],array['notice.manage']),
 ('monthly_client_documents.manage','거래처 문서 관리','거래처 문서 조회·작성·수정·제출·첨부 관리.',array['거래처 정보','계약·거래 문서'],array['monthly_client_documents.manage']),
 ('attendance.view','출근부','전사 근태 조회 및 운영총괄 화면의 예외 검토.',array['직원 근태','근태 위치·증빙'],array['attendance.admin_view','attendance.exception_review']),
 ('attendance.correct','근태 보정','운영총괄과 동일한 근태 보정. 원본 이력 보존.',array['직원 근태'],array['attendance.correct']),
 ('payroll.manage','근태·급여관리','전사 급여 조회·계산·수정·확정·내보내기. 기존 상태 전이·확인 유지.',array['급여','공제','개인별 급여자료'],array['payroll.manage']),
 ('payroll.handoff.approve','외부 급여초안 검토','외부 급여초안 검토·승인.',array['급여초안','급여 첨부'],array['payroll.handoff.approve']),
 ('support.profile','기업 프로필','지원사업 기업 정보 조회·수정.',array['기업 내부정보'],array['support_radar.management_view','support_radar.management_edit']),
 ('support.radar','지원사업 레이더','운영총괄의 지원사업 목록·판단·관리.',array['사업 검토정보'],array['support_radar.management_view']),
 ('support.mywork','내 지원사업','운영총괄 화면과 동일한 담당 업무 조회·처리.',array['지원사업 제출자료'],array['support_radar.assigned_work']);

create function public.private_menu_authority_manager()
returns boolean language sql stable security definer set search_path='' as $$
 select public.current_profile_is_active()
   and 'operations_manager'=any(public.private_actual_role_codes())
   and public.current_user_has_role('operations_manager');
$$;

create function public.private_menu_granted(p_menu_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.current_profile_is_active() and exists(
   select 1 from public.profile_menu_authority g
   join public.menu_authority_catalog c using(menu_key)
   where g.profile_id=auth.uid() and g.menu_key=p_menu_key and g.allowed and c.adapter_ready
 ) and not exists(select 1 from public.role_simulation_modes s
   where s.profile_id=auth.uid() and s.expires_at>now());
$$;

create function public.private_menu_denied(p_menu_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select not public.private_menu_authority_manager() and exists(
   select 1 from public.profile_menu_authority g join public.menu_authority_catalog c using(menu_key)
   where g.profile_id=auth.uid() and g.menu_key=p_menu_key and (not g.allowed or not c.adapter_ready)
 );
$$;

-- Use this in a reviewed menu's server adapter, NEVER in current_user_has_role.
-- It confers the operations branch for this one menu; actual roles remain unchanged.
create function public.private_menu_operations(p_menu_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.current_profile_is_active() and not public.private_menu_denied(p_menu_key)
   and (public.current_user_has_role('operations_manager') or public.private_menu_granted(p_menu_key));
$$;

-- Keep existing role grants until an explicit personal decision exists.
-- A false row is a durable denial, not deletion that restores legacy role access.
alter function public.private_actor_capabilities() rename to private_actor_capabilities_before_menu_authority;
revoke all on function public.private_actor_capabilities_before_menu_authority() from public,anon,authenticated;
create function public.private_actor_capabilities()
returns text[] language plpgsql stable security definer set search_path='' as $$
begin
 if not public.current_profile_is_active() then return '{}'::text[]; end if;
 -- The common role-only path keeps the proven resolver. Do not expand the
 -- whole menu catalog per capability, per notice, when no personal decision exists.
 if public.private_menu_authority_manager() or not exists(
   select 1 from public.profile_menu_authority g where g.profile_id=auth.uid()
 ) then
  return public.private_actor_capabilities_before_menu_authority();
 end if;
 return (select coalesce(array_agg(distinct candidate.code order by candidate.code),'{}'::text[])
 from (
   select unnest(public.private_actor_capabilities_before_menu_authority()) as code
   union
   select unnest(c.capabilities) from public.menu_authority_catalog c
   where public.private_menu_granted(c.menu_key)
 ) candidate
 join public.platform_capabilities cap on cap.code=candidate.code and cap.active
 where public.current_profile_is_active()
 and (public.private_menu_authority_manager() or not exists(
   select 1 from public.menu_authority_catalog c
   where candidate.code=any(c.capabilities) and public.private_menu_denied(c.menu_key)
   -- A separately approved menu can use a shared capability. Each RPC must still
   -- check its own menu denial; capability membership alone is insufficient.
   and not exists(select 1 from public.menu_authority_catalog granted
     where candidate.code=any(granted.capabilities) and public.private_menu_granted(granted.menu_key))
 )));
end;
$$;

create function public.get_my_menu_authority()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'can_manage',public.private_menu_authority_manager(),
   'decisions',coalesce((select jsonb_agg(jsonb_build_object(
     'menu_key',g.menu_key,'allowed',g.allowed and c.adapter_ready,
     'revision',g.revision,'scope_summary',c.scope_summary
   ) order by g.menu_key) from public.profile_menu_authority g
   join public.menu_authority_catalog c using(menu_key)
   where g.profile_id=auth.uid() and public.current_profile_is_active()
     and not exists(select 1 from public.role_simulation_modes s
       where s.profile_id=auth.uid() and s.expires_at>now())),'[]'::jsonb));
$$;

create function public.get_menu_authority_administration()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.private_menu_authority_manager() then
   raise exception using errcode='42501',message='MENU_AUTHORITY_ADMIN_FORBIDDEN';
 end if;
 return jsonb_build_object(
   'menus',(select coalesce(jsonb_agg(to_jsonb(c) order by c.menu_key),'[]') from public.menu_authority_catalog c),
   'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'account_status',p.account_status) order by p.display_name,p.id),'[]')
     from public.profiles p where p.account_status in ('active','suspended','departed') and p.id<>auth.uid()
     and not exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id
       where pr.profile_id=p.id and pr.revoked_at is null and r.active
         and r.code in ('operations_manager','super_admin'))),
   'decisions',(select coalesce(jsonb_agg(to_jsonb(g) order by g.profile_id,g.menu_key),'[]') from public.profile_menu_authority g));
end;
$$;

create function public.set_profile_menu_authority(
 p_profile_id uuid,p_menu_key text,p_allowed boolean,p_expected_revision bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing_revision bigint; next_revision bigint;
begin
 if not public.private_menu_authority_manager() then
   raise exception using errcode='42501',message='MENU_AUTHORITY_ADMIN_FORBIDDEN';
 end if;
 if p_allowed is null or p_expected_revision is null or p_expected_revision<0
    or p_reason is null or length(btrim(p_reason)) not between 3 and 300 then
   raise exception using errcode='22023',message='INVALID_MENU_AUTHORITY_INPUT';
 end if;
 -- Lock the target to serialize first grants and concurrent grant/revoke updates.
 perform 1 from public.profiles where id=p_profile_id for update;
 if not found or p_profile_id=auth.uid()
    or exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id
      where pr.profile_id=p_profile_id and pr.revoked_at is null and r.active
      and r.code in ('operations_manager','super_admin'))
    or (p_allowed and not exists(select 1 from public.profiles p where p.id=p_profile_id and p.account_status='active')) then
   raise exception using errcode='42501',message='MENU_AUTHORITY_TARGET_FORBIDDEN';
 end if;
 if not exists(select 1 from public.menu_authority_catalog c where c.menu_key=p_menu_key
   and (not p_allowed or c.adapter_ready)) then
   raise exception using errcode='22023',message='MENU_ADAPTER_NOT_READY';
 end if;
 select revision into existing_revision from public.profile_menu_authority
   where profile_id=p_profile_id and menu_key=p_menu_key;
 if coalesce(existing_revision,0)<>p_expected_revision then
   raise exception using errcode='40001',message='MENU_AUTHORITY_STALE_RELOAD_REQUIRED';
 end if;
 next_revision:=coalesce(existing_revision,0)+1;
 insert into public.profile_menu_authority(profile_id,menu_key,allowed,revision,changed_by,reason)
 values(p_profile_id,p_menu_key,p_allowed,next_revision,auth.uid(),btrim(p_reason))
 on conflict(profile_id,menu_key) do update set allowed=excluded.allowed,revision=excluded.revision,
   changed_by=excluded.changed_by,reason=excluded.reason,changed_at=now();
 perform public.private_append_audit(auth.uid(),'menu_authority_changed','profile',p_profile_id::text,
   'success',btrim(p_reason),jsonb_build_object('menu_key',p_menu_key,'allowed',p_allowed,'revision',next_revision));
 return jsonb_build_object('ok',true,'revision',next_revision);
end;
$$;

revoke all on function public.private_menu_authority_manager(),public.private_menu_granted(text),
 public.private_menu_denied(text),public.private_menu_operations(text),public.private_actor_capabilities(),
 public.get_my_menu_authority(),public.get_menu_authority_administration(),
 public.set_profile_menu_authority(uuid,text,boolean,bigint,text) from public,anon,authenticated;
grant execute on function public.get_my_menu_authority(),public.get_menu_authority_administration(),
 public.set_profile_menu_authority(uuid,text,boolean,bigint,text) to authenticated;
commit;

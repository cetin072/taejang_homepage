-- Issue #148 Phase A: additive capability authorization foundation.
-- Route selection remains for layout/landing only; feature authorization can migrate
-- incrementally to the server-owned capability contract.

begin;

create table if not exists public.platform_capabilities (
  code text primary key check (code ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  capability_kind text not null check (capability_kind in ('operational', 'technical')),
  operations_manager_auto_grant boolean not null default true,
  description text not null check (char_length(description) between 1 and 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_capability_grants (
  role_id uuid not null references public.roles(id) on delete cascade,
  capability_code text not null references public.platform_capabilities(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, capability_code)
);

alter table public.platform_capabilities enable row level security;
alter table public.role_capability_grants enable row level security;
revoke all on table public.platform_capabilities from anon, authenticated;
revoke all on table public.role_capability_grants from anon, authenticated;

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description)
values
  ('employee.view_all', 'operational', true, '전체 Employee 조회'),
  ('employee.create', 'operational', true, '신규 Employee 등록'),
  ('employee.update', 'operational', true, 'Employee 핵심정보 수정'),
  ('employee.archive', 'operational', true, 'Employee 복구가능 보관'),
  ('employee.restore', 'operational', true, 'Employee 복구'),
  ('employee.account_link', 'operational', true, 'Auth 계정과 Employee 연결'),
  ('employee.account_unlink', 'operational', true, 'Auth 계정과 Employee 연결 해제'),
  ('account.approve', 'operational', true, '가입 승인'),
  ('account.reject', 'operational', true, '가입 반려'),
  ('account.status_manage', 'operational', true, '일반 계정 상태 관리'),
  ('account.organization_manage', 'operational', true, '계정 부서와 직책 관리'),
  ('account.operational_roles_manage', 'operational', true, '일반 운영 역할 관리'),
  ('promotion.write', 'operational', true, '홍보 콘텐츠 작성'),
  ('promotion.edit_own', 'operational', true, '본인 홍보 초안 수정'),
  ('promotion.edit_any_unpublished', 'operational', true, '모든 미발행 홍보 초안 수정'),
  ('promotion.review_lead', 'operational', true, '운영팀장 홍보 검토'),
  ('promotion.review_operations', 'operational', true, '운영총괄 홍보 최종 검토'),
  ('promotion.hide', 'operational', true, '공개 홍보 콘텐츠 숨김'),
  ('promotion.republish', 'operational', true, '숨김 홍보 콘텐츠 재공개'),
  ('promotion.archive', 'operational', true, '홍보 콘텐츠 복구가능 보관'),
  ('promotion.restore', 'operational', true, '홍보 콘텐츠 복구'),
  ('homepage.draft', 'operational', true, '홈페이지 safe-slot 수정 초안'),
  ('homepage.review', 'operational', true, '홈페이지 수정요청 검토'),
  ('homepage.approve_apply', 'operational', true, '홈페이지 승인 및 공개 반영'),
  ('homepage.direct_edit', 'operational', true, '홈페이지 safe-slot 직접 수정'),
  ('attendance.self_record', 'operational', false, '본인 출퇴근 기록'),
  ('attendance.admin_view', 'operational', true, '관리자 출근부 조회'),
  ('attendance.exception_review', 'operational', true, '근태 예외 검토'),
  ('attendance.correct', 'operational', true, '근태 append-only 보정'),
  ('task.manage', 'operational', true, '업무 배정 관리'),
  ('schedule.manage', 'operational', true, '일정 관리'),
  ('notice.manage', 'operational', true, '공지 관리'),
  ('guidance.manage', 'operational', true, '상시 안내 관리'),
  ('simulation.start_lower_role', 'operational', true, '운영총괄 하위 역할 체험'),
  ('technical.bootstrap_super_admin', 'technical', false, '최초 최고관리자 bootstrap'),
  ('technical.manage_last_super_admin', 'technical', false, '마지막 최고관리자 보호 관리'),
  ('technical.emergency_system_access', 'technical', false, '기술 비상 접근'),
  ('audit.system_raw_read', 'technical', false, '시스템 전체 raw audit 조회')
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

-- Explicit lower-role grants intentionally mirror existing confirmed scope only.
-- Target/department/work-group limits remain enforced by each existing RPC.
with grants(role_code, capability_code) as (
  values
    ('general_worker', 'attendance.self_record'),
    ('office_staff', 'attendance.self_record'),
    ('work_assistant', 'attendance.self_record'),
    ('worker_support_staff', 'attendance.self_record'),
    ('worker_support_lead', 'attendance.self_record'),
    ('promotion_staff', 'attendance.self_record'),
    ('promotion_staff', 'promotion.write'),
    ('promotion_staff', 'promotion.edit_own'),
    ('promotion_lead', 'attendance.self_record'),
    ('promotion_lead', 'attendance.admin_view'),
    ('promotion_lead', 'attendance.exception_review'),
    ('promotion_lead', 'promotion.write'),
    ('promotion_lead', 'promotion.edit_own'),
    ('promotion_lead', 'promotion.review_lead'),
    ('promotion_lead', 'promotion.hide'),
    ('promotion_lead', 'promotion.republish'),
    ('promotion_lead', 'promotion.archive'),
    ('promotion_lead', 'employee.create'),
    ('promotion_lead', 'homepage.draft'),
    ('department_lead', 'attendance.self_record'),
    ('department_lead', 'task.manage'),
    ('department_lead', 'schedule.manage'),
    ('department_lead', 'notice.manage'),
    ('department_lead', 'guidance.manage'),
    ('field_lead', 'attendance.self_record'),
    ('field_lead', 'task.manage'),
    ('field_lead', 'schedule.manage'),
    ('field_lead', 'notice.manage'),
    ('field_lead', 'guidance.manage'),
    ('super_admin', 'technical.bootstrap_super_admin'),
    ('super_admin', 'technical.manage_last_super_admin'),
    ('super_admin', 'technical.emergency_system_access'),
    ('super_admin', 'audit.system_raw_read')
)
insert into public.role_capability_grants(role_id, capability_code)
select role.id, grants.capability_code
from grants
join public.roles role on role.code = grants.role_code
join public.platform_capabilities capability on capability.code = grants.capability_code
where role.active and capability.active
on conflict (role_id, capability_code) do nothing;

create or replace function public.private_actual_role_codes()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(role.code order by role.code), array[]::text[])
  from public.profile_roles assignment
  join public.roles role on role.id = assignment.role_id
  where assignment.profile_id = (select auth.uid())
    and assignment.revoked_at is null
    and role.active;
$$;

create or replace function public.private_effective_role_codes()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.role_simulation_modes simulation
      where simulation.profile_id = (select auth.uid())
        and simulation.expires_at > now()
    ) then array[(
      select simulation.role_code
      from public.role_simulation_modes simulation
      where simulation.profile_id = (select auth.uid())
        and simulation.expires_at > now()
      order by simulation.updated_at desc
      limit 1
    )]::text[]
    else public.private_actual_role_codes()
  end;
$$;

create or replace function public.private_actor_capabilities()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actual_roles text[] := public.private_actual_role_codes();
  effective_roles text[] := public.private_effective_role_codes();
  result text[];
begin
  if not public.current_profile_is_active() then
    return array[]::text[];
  end if;

  select coalesce(array_agg(capability.code order by capability.code), array[]::text[])
  into result
  from public.platform_capabilities capability
  where capability.active
    and (
      (
        capability.capability_kind = 'operational'
        and (
          ('operations_manager' = any(effective_roles) and capability.operations_manager_auto_grant)
          or exists (
            select 1
            from public.role_capability_grants grant_row
            join public.roles role on role.id = grant_row.role_id
            where grant_row.capability_code = capability.code
              and role.code = any(effective_roles)
              and role.active
          )
        )
      )
      or (
        capability.capability_kind = 'technical'
        and exists (
          select 1
          from public.role_capability_grants grant_row
          join public.roles role on role.id = grant_row.role_id
          where grant_row.capability_code = capability.code
            and role.code = any(actual_roles)
            and role.active
        )
      )
    );

  return result;
end;
$$;

create or replace function public.private_actor_can(p_capability_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_capability_code = any(public.private_actor_capabilities()), false);
$$;

create or replace function public.get_my_access_context_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_context jsonb := public.get_my_access_context();
  actual_roles jsonb := '[]'::jsonb;
  capability_codes text[] := array[]::text[];
begin
  if base_context is null then
    return null;
  end if;

  if coalesce(base_context->>'account_status', '') = 'active' then
    select coalesce(
      jsonb_agg(jsonb_build_object('code', role.code, 'name', role.name) order by role.code),
      '[]'::jsonb
    )
    into actual_roles
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = (select auth.uid())
      and assignment.revoked_at is null
      and role.active;

    capability_codes := public.private_actor_capabilities();
  end if;

  return base_context || jsonb_build_object(
    'access_contract_version', 2,
    'actual_roles', actual_roles,
    'effective_roles', coalesce(base_context->'roles', '[]'::jsonb),
    'capabilities', to_jsonb(capability_codes)
  );
end;
$$;

revoke all on function public.private_actual_role_codes() from public, anon, authenticated;
revoke all on function public.private_effective_role_codes() from public, anon, authenticated;
revoke all on function public.private_actor_capabilities() from public, anon, authenticated;
revoke all on function public.private_actor_can(text) from public, anon, authenticated;
revoke all on function public.get_my_access_context_v2() from public, anon;
grant execute on function public.get_my_access_context_v2() to authenticated;

comment on table public.platform_capabilities is
  'Server-owned capability registry. Route is presentation; capabilities are feature authorization contracts.';
comment on table public.role_capability_grants is
  'Explicit lower-role and technical capability grants. Operations-manager operational superset is computed separately.';
comment on function public.private_actor_can(text) is
  'Private server authorization helper using effective operational roles and actual technical roles.';

commit;

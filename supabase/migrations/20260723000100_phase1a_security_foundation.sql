-- Taejang Work Platform Phase 1A security foundation.
-- Apply to a local or non-production Supabase project before any production use.

begin;

create extension if not exists pgcrypto;

create type public.account_status as enum (
  'pending',
  'active',
  'suspended',
  'departed',
  'deleted'
);

create type public.role_scope_type as enum (
  'company',
  'department',
  'work_group',
  'self'
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(coalesce(description, '')) <= 300),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(coalesce(description, '')) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 80),
  work_email text,
  account_status public.account_status not null default 'pending',
  department_id uuid references public.departments(id) on delete restrict,
  position_id uuid references public.positions(id) on delete restrict,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references public.profiles(id) on delete restrict,
  status_reason text check (char_length(coalesce(status_reason, '')) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (account_status = 'pending' and approved_at is null)
    or account_status <> 'pending'
  )
);

create table public.profile_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  role_id uuid not null references public.roles(id) on delete restrict,
  scope_type public.role_scope_type not null default 'company',
  scope_id uuid,
  granted_by uuid references public.profiles(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  check (
    (scope_type in ('company', 'self') and scope_id is null)
    or (scope_type in ('department', 'work_group') and scope_id is not null)
  )
);

create unique index profile_roles_one_current_assignment
  on public.profile_roles (profile_id, role_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

create table public.account_status_history (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  previous_status public.account_status,
  new_status public.account_status not null,
  reason text check (char_length(coalesce(reason, '')) <= 300),
  changed_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  action text not null check (char_length(action) between 1 and 80),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id text,
  outcome text not null check (outcome in ('success', 'denied', 'failed')),
  reason_summary text check (char_length(coalesce(reason_summary, '')) <= 300),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One internal profile per Supabase Auth user. Account status is checked on every protected request.';
comment on table public.positions is
  'Organization display and reporting position. It is not an authorization source.';
comment on table public.roles is
  'Authorization roles. No person name or email is embedded in a role code.';
comment on table public.account_status_history is
  'Append-only account status history. Ordinary clients cannot insert, update, or delete rows.';
comment on table public.audit_logs is
  'Append-only security audit trail. Never store passwords, tokens, keys, health details, or consultation text.';

insert into public.departments (code, name, sort_order) values
  ('operations', '운영', 10),
  ('production', '생산', 20),
  ('logistics', '물류', 30),
  ('promotion', '홍보', 40),
  ('worker_support', '근로자지원', 50)
on conflict (code) do nothing;

insert into public.positions (code, name, sort_order) values
  ('ceo', '대표이사', 10),
  ('operations_manager', '운영총괄', 20),
  ('system_super_admin', '시스템 최고관리자', 30),
  ('department_lead', '부서 팀장', 40),
  ('general_field_lead', '총괄반장', 50),
  ('task_field_lead', '업무반장', 60),
  ('field_manager', '현장 관리자', 70),
  ('staff', '담당자', 80),
  ('general_worker', '일반 근로자', 90),
  ('work_assistant', '근로지원인', 100),
  ('external_guide', '외부지도자', 110)
on conflict (code) do nothing;

insert into public.roles (code, name) values
  ('ceo', '대표이사'),
  ('operations_manager', '운영총괄'),
  ('super_admin', '시스템 최고관리자'),
  ('department_lead', '부서 팀장'),
  ('field_lead', '현장 책임자'),
  ('worker_support_lead', '근로자지원 책임자'),
  ('worker_support_staff', '근로자지원 담당자'),
  ('promotion_lead', '홍보팀장'),
  ('promotion_staff', '홍보 직원'),
  ('office_staff', '일반 사무직원'),
  ('general_worker', '일반 근로자'),
  ('work_assistant', '근로지원인'),
  ('external_guide', '외부지도자')
on conflict (code) do nothing;

create or replace function public.current_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.account_status = 'active'
  );
$$;

create or replace function public.current_user_has_role(p_role_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and exists (
      select 1
      from public.profile_roles assignment
      join public.roles role on role.id = assignment.role_id
      where assignment.profile_id = (select auth.uid())
        and assignment.revoked_at is null
        and role.active
        and role.code = p_role_code
    );
$$;

create or replace function public.private_append_audit(
  p_actor_profile_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_outcome text,
  p_reason_summary text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('success', 'denied', 'failed') then
    raise exception using errcode = '22023', message = 'INVALID_AUDIT_OUTCOME';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or octet_length(p_metadata::text) > 4096 then
    raise exception using errcode = '22023', message = 'INVALID_AUDIT_METADATA';
  end if;
  -- Inspect the serialized object so sensitive key names are rejected at every
  -- nesting level, not only at the top level.
  if p_metadata::text ~* '"[^"]*(password|token|secret|api[_-]?key|refresh|health|disability|consultation|비밀번호|토큰|비밀키|건강|장애|상담)[^"]*"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'UNSAFE_AUDIT_METADATA_KEY';
  end if;
  if coalesce(p_reason_summary, '') ~* '(password|access[ _-]?token|refresh[ _-]?token|service[ _-]?role|secret[ _-]?key|api[ _-]?key|sb_secret_|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}|비밀번호|접근[ ]?토큰|새로고침[ ]?토큰|서비스[ ]?키|비밀키|건강[ ]?상세|장애[ ]?상세|상담[ ]?원문)' then
    raise exception using errcode = '22023', message = 'UNSAFE_AUDIT_REASON';
  end if;

  insert into public.audit_logs (
    actor_profile_id,
    action,
    target_type,
    target_id,
    outcome,
    reason_summary,
    metadata
  ) values (
    p_actor_profile_id,
    left(p_action, 80),
    left(p_target_type, 80),
    p_target_id,
    p_outcome,
    left(p_reason_summary, 300),
    p_metadata
  );
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_display_name text;
begin
  safe_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  if safe_display_name is null then
    safe_display_name := '가입자';
  end if;

  insert into public.profiles (id, display_name, work_email, account_status)
  values (new.id, left(safe_display_name, 80), new.email, 'pending');

  insert into public.account_status_history (
    profile_id,
    previous_status,
    new_status,
    reason,
    changed_by
  ) values (
    new.id,
    null,
    'pending',
    '회원가입',
    null
  );

  perform public.private_append_audit(
    new.id,
    'account_signed_up',
    'profile',
    new.id::text,
    'success',
    '회원가입 후 승인 대기 상태 생성'
  );

  return new;
end;
$$;

create trigger on_auth_user_created_create_pending_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.get_my_access_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', profile.id,
    'display_name', case
      when profile.account_status in ('pending', 'active') then profile.display_name
      else null
    end,
    'account_status', profile.account_status,
    'department', case
      when profile.account_status <> 'active' or department.id is null then null
      else jsonb_build_object('id', department.id, 'code', department.code, 'name', department.name)
    end,
    'position', case
      when profile.account_status <> 'active' or position.id is null then null
      else jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name)
    end,
    'roles', case
      when profile.account_status <> 'active' then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object('code', role.code, 'name', role.name) order by role.code)
        from public.profile_roles assignment
        join public.roles role on role.id = assignment.role_id
        where assignment.profile_id = profile.id
          and assignment.revoked_at is null
          and role.active
      ), '[]'::jsonb)
    end
  )
  from public.profiles profile
  left join public.departments department on department.id = profile.department_id
  left join public.positions position on position.id = profile.position_id
  where profile.id = (select auth.uid());
$$;

create or replace function public.list_pending_profiles()
returns table (
  id uuid,
  display_name text,
  work_email text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('super_admin') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return query
  select profile.id, profile.display_name, profile.work_email, profile.created_at
  from public.profiles profile
  where profile.account_status = 'pending'
  order by profile.created_at;
end;
$$;

create or replace function public.approve_pending_user(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_role_codes text[],
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_profile public.profiles%rowtype;
  normalized_roles text[];
  role_record record;
begin
  if not public.current_user_has_role('super_admin') then
    perform public.private_append_audit(actor_id, 'account_approval', 'profile', p_target_profile_id::text, 'denied', '최고관리자 역할 없음');
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_profile_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target_profile.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;
  if p_department_id is null or not exists (select 1 from public.departments where id = p_department_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DEPARTMENT');
  end if;
  if p_position_id is null or not exists (select 1 from public.positions where id = p_position_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_POSITION');
  end if;

  select coalesce(array_agg(distinct code order by code), array[]::text[])
  into normalized_roles
  from unnest(coalesce(p_role_codes, array[]::text[])) as requested(code);

  if cardinality(normalized_roles) = 0
     or (select count(*) from public.roles where active and code = any(normalized_roles)) <> cardinality(normalized_roles) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLES');
  end if;

  update public.profiles
  set account_status = 'active',
      department_id = p_department_id,
      position_id = p_position_id,
      approved_at = now(),
      approved_by = actor_id,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = left(coalesce(p_reason_summary, '가입 승인'), 300),
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history (
    profile_id, previous_status, new_status, reason, changed_by
  ) values (
    p_target_profile_id, 'pending', 'active', left(coalesce(p_reason_summary, '가입 승인'), 300), actor_id
  );

  for role_record in
    select id, code from public.roles where active and code = any(normalized_roles)
  loop
    insert into public.profile_roles (profile_id, role_id, granted_by)
    values (p_target_profile_id, role_record.id, actor_id);
    perform public.private_append_audit(
      actor_id, 'role_granted', 'profile', p_target_profile_id::text, 'success',
      left(coalesce(p_reason_summary, '가입 승인 역할 배정'), 300),
      jsonb_build_object('role_code', role_record.code)
    );
  end loop;

  perform public.private_append_audit(
    actor_id, 'account_approved', 'profile', p_target_profile_id::text, 'success',
    left(coalesce(p_reason_summary, '가입 승인'), 300),
    jsonb_build_object('department_id', p_department_id, 'position_id', p_position_id)
  );

  return jsonb_build_object('ok', true, 'code', 'ACCOUNT_APPROVED');
end;
$$;

create or replace function public.record_pending_decision(
  p_target_profile_id uuid,
  p_decision text,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if not public.current_user_has_role('super_admin') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_decision not in ('deferred', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DECISION');
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_target_profile_id and account_status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;

  perform public.private_append_audit(
    actor_id,
    case when p_decision = 'deferred' then 'account_approval_deferred' else 'account_approval_rejected' end,
    'profile',
    p_target_profile_id::text,
    'success',
    left(p_reason_summary, 300)
  );
  return jsonb_build_object('ok', true, 'code', upper(p_decision));
end;
$$;

create or replace function public.change_account_status(
  p_target_profile_id uuid,
  p_new_status public.account_status,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_profile public.profiles%rowtype;
  active_super_admin_count integer;
begin
  if not public.current_user_has_role('super_admin') then
    perform public.private_append_audit(actor_id, 'account_status_change', 'profile', p_target_profile_id::text, 'denied', '최고관리자 역할 없음');
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_new_status = 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PENDING_REQUIRES_NEW_SIGNUP');
  end if;

  perform pg_advisory_xact_lock(77134001);
  select * into target_profile from public.profiles where id = p_target_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target_profile.account_status = 'pending' and p_new_status = 'active' then
    return jsonb_build_object('ok', false, 'code', 'USE_APPROVAL_FUNCTION');
  end if;
  if target_profile.account_status = p_new_status then
    return jsonb_build_object('ok', true, 'code', 'NO_CHANGE');
  end if;

  if target_profile.account_status = 'active' and p_new_status <> 'active'
     and exists (
       select 1
       from public.profile_roles assignment
       join public.roles role on role.id = assignment.role_id
       where assignment.profile_id = p_target_profile_id
         and assignment.revoked_at is null
         and role.code = 'super_admin'
     ) then
    select count(distinct profile.id)
    into active_super_admin_count
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active';

    if active_super_admin_count <= 1 then
      perform public.private_append_audit(
        actor_id, 'last_super_admin_change_denied', 'profile', p_target_profile_id::text, 'denied',
        '마지막 활성 최고관리자 보호'
      );
      return jsonb_build_object('ok', false, 'code', 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED');
    end if;
  end if;

  update public.profiles
  set account_status = p_new_status,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = left(p_reason_summary, 300),
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history (
    profile_id, previous_status, new_status, reason, changed_by
  ) values (
    p_target_profile_id, target_profile.account_status, p_new_status, left(p_reason_summary, 300), actor_id
  );

  perform public.private_append_audit(
    actor_id,
    case
      when p_new_status = 'active' then 'account_reactivated'
      else 'account_status_changed'
    end,
    'profile',
    p_target_profile_id::text,
    'success',
    left(p_reason_summary, 300),
    jsonb_build_object('from', target_profile.account_status, 'to', p_new_status)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'STATUS_CHANGED',
    'database_access_blocked', p_new_status <> 'active',
    'auth_session_revocation_required', p_new_status <> 'active'
  );
end;
$$;

create or replace function public.assign_profile_organization(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_profile public.profiles%rowtype;
begin
  if not public.current_user_has_role('super_admin') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if not exists (select 1 from public.departments where id = p_department_id and active)
     or not exists (select 1 from public.positions where id = p_position_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ASSIGNMENT');
  end if;

  select * into target_profile from public.profiles where id = p_target_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;

  update public.profiles
  set department_id = p_department_id,
      position_id = p_position_id,
      updated_at = now()
  where id = p_target_profile_id;

  perform public.private_append_audit(
    actor_id, 'organization_assignment_changed', 'profile', p_target_profile_id::text, 'success',
    left(p_reason_summary, 300),
    jsonb_build_object(
      'previous_department_id', target_profile.department_id,
      'new_department_id', p_department_id,
      'previous_position_id', target_profile.position_id,
      'new_position_id', p_position_id
    )
  );
  return jsonb_build_object('ok', true, 'code', 'ASSIGNMENT_CHANGED');
end;
$$;

create or replace function public.set_profile_roles(
  p_target_profile_id uuid,
  p_role_codes text[],
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_status public.account_status;
  normalized_roles text[];
  active_super_admin_count integer;
  role_to_revoke record;
  requested_role record;
begin
  if not public.current_user_has_role('super_admin') then
    perform public.private_append_audit(actor_id, 'role_change', 'profile', p_target_profile_id::text, 'denied', '최고관리자 역할 없음');
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  perform pg_advisory_xact_lock(77134001);
  select account_status into target_status from public.profiles where id = p_target_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;

  select coalesce(array_agg(distinct code order by code), array[]::text[])
  into normalized_roles
  from unnest(coalesce(p_role_codes, array[]::text[])) as requested(code);

  if (select count(*) from public.roles where active and code = any(normalized_roles)) <> cardinality(normalized_roles) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLES');
  end if;
  if 'super_admin' = any(normalized_roles) and target_status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'SUPER_ADMIN_MUST_BE_ACTIVE');
  end if;

  if exists (
    select 1
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = p_target_profile_id
      and assignment.revoked_at is null
      and role.code = 'super_admin'
  ) and not ('super_admin' = any(normalized_roles)) then
    select count(distinct profile.id)
    into active_super_admin_count
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active';

    if active_super_admin_count <= 1 then
      perform public.private_append_audit(
        actor_id, 'last_super_admin_change_denied', 'profile', p_target_profile_id::text, 'denied',
        '마지막 활성 최고관리자 역할 보호'
      );
      return jsonb_build_object('ok', false, 'code', 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED');
    end if;
  end if;

  for role_to_revoke in
    select assignment.id, role.code
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = p_target_profile_id
      and assignment.revoked_at is null
      and not (role.code = any(normalized_roles))
  loop
    update public.profile_roles
    set revoked_at = now(), revoked_by = actor_id
    where id = role_to_revoke.id;
    perform public.private_append_audit(
      actor_id, 'role_revoked', 'profile', p_target_profile_id::text, 'success',
      left(p_reason_summary, 300), jsonb_build_object('role_code', role_to_revoke.code)
    );
  end loop;

  for requested_role in
    select role.id, role.code
    from public.roles role
    where role.active
      and role.code = any(normalized_roles)
      and not exists (
        select 1 from public.profile_roles assignment
        where assignment.profile_id = p_target_profile_id
          and assignment.role_id = role.id
          and assignment.revoked_at is null
      )
  loop
    insert into public.profile_roles (profile_id, role_id, granted_by)
    values (p_target_profile_id, requested_role.id, actor_id);
    perform public.private_append_audit(
      actor_id, 'role_granted', 'profile', p_target_profile_id::text, 'success',
      left(p_reason_summary, 300), jsonb_build_object('role_code', requested_role.code)
    );
  end loop;

  return jsonb_build_object('ok', true, 'code', 'ROLES_CHANGED');
end;
$$;

create or replace function public.bootstrap_super_admin(p_target_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles%rowtype;
  super_admin_role_id uuid;
begin
  perform pg_advisory_xact_lock(77134001);
  if exists (
    select 1
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
  end if;

  select * into target_profile from public.profiles where id = p_target_auth_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target_profile.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;

  select id into super_admin_role_id from public.roles where code = 'super_admin' and active;
  update public.profiles
  set account_status = 'active',
      approved_at = now(),
      status_changed_at = now(),
      status_reason = '초기 최고관리자 bootstrap',
      updated_at = now()
  where id = p_target_auth_user_id;

  insert into public.profile_roles (profile_id, role_id)
  values (p_target_auth_user_id, super_admin_role_id);

  insert into public.account_status_history (
    profile_id, previous_status, new_status, reason, changed_by
  ) values (
    p_target_auth_user_id, 'pending', 'active', '초기 최고관리자 bootstrap', null
  );

  perform public.private_append_audit(
    null, 'super_admin_bootstrapped', 'profile', p_target_auth_user_id::text, 'success',
    'DB 운영자 1회 초기 지정', jsonb_build_object('method', 'sql_editor')
  );

  return jsonb_build_object('ok', true, 'code', 'SUPER_ADMIN_BOOTSTRAPPED');
end;
$$;

create or replace function public.guard_last_active_super_admin_direct_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid;
  removes_super_admin boolean := false;
  active_super_admin_count integer;
begin
  perform pg_advisory_xact_lock(77134001);
  if tg_table_name = 'profiles' then
    target_profile_id := old.id;
    removes_super_admin := old.account_status = 'active' and new.account_status <> 'active'
      and exists (
        select 1
        from public.profile_roles assignment
        join public.roles role on role.id = assignment.role_id
        where assignment.profile_id = old.id
          and assignment.revoked_at is null
          and role.code = 'super_admin'
      );
  else
    target_profile_id := old.profile_id;
    removes_super_admin := old.revoked_at is null
      and (tg_op = 'DELETE' or new.revoked_at is not null or new.role_id <> old.role_id)
      and exists (select 1 from public.roles where id = old.role_id and code = 'super_admin');
  end if;

  if removes_super_admin then
    select count(distinct profile.id)
    into active_super_admin_count
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active';

    if active_super_admin_count <= 1 then
      raise exception using errcode = '23514', message = 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_last_active_super_admin
before update of account_status on public.profiles
for each row execute function public.guard_last_active_super_admin_direct_write();

create trigger profile_roles_guard_last_active_super_admin_update
before update of role_id, revoked_at on public.profile_roles
for each row execute function public.guard_last_active_super_admin_direct_write();

create trigger profile_roles_guard_last_active_super_admin_delete
before delete on public.profile_roles
for each row execute function public.guard_last_active_super_admin_direct_write();

alter table public.departments enable row level security;
alter table public.positions enable row level security;
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_roles enable row level security;
alter table public.account_status_history enable row level security;
alter table public.audit_logs enable row level security;

-- Supabase migrations run as postgres. Keep every SECURITY DEFINER function
-- owned by that non-login database owner so an application role cannot replace
-- the function body and inherit elevated access.
alter function public.current_profile_is_active() owner to postgres;
alter function public.current_user_has_role(text) owner to postgres;
alter function public.private_append_audit(uuid, text, text, text, text, text, jsonb) owner to postgres;
alter function public.handle_new_auth_user() owner to postgres;
alter function public.get_my_access_context() owner to postgres;
alter function public.list_pending_profiles() owner to postgres;
alter function public.approve_pending_user(uuid, uuid, uuid, text[], text) owner to postgres;
alter function public.record_pending_decision(uuid, text, text) owner to postgres;
alter function public.change_account_status(uuid, public.account_status, text) owner to postgres;
alter function public.assign_profile_organization(uuid, uuid, uuid, text) owner to postgres;
alter function public.set_profile_roles(uuid, text[], text) owner to postgres;
alter function public.bootstrap_super_admin(uuid) owner to postgres;
alter function public.guard_last_active_super_admin_direct_write() owner to postgres;

create policy departments_active_read on public.departments
for select to authenticated
using ((select public.current_profile_is_active()) and active);

create policy positions_active_read on public.positions
for select to authenticated
using ((select public.current_profile_is_active()) and active);

create policy roles_active_read on public.roles
for select to authenticated
using ((select public.current_profile_is_active()) and active);

create policy profiles_self_or_super_admin_read on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (select public.current_user_has_role('super_admin'))
);

create policy profile_roles_self_or_super_admin_read on public.profile_roles
for select to authenticated
using (
  (profile_id = (select auth.uid()) and (select public.current_profile_is_active()))
  or (select public.current_user_has_role('super_admin'))
);

create policy status_history_super_admin_read on public.account_status_history
for select to authenticated
using ((select public.current_user_has_role('super_admin')));

create policy audit_logs_super_admin_read on public.audit_logs
for select to authenticated
using ((select public.current_user_has_role('super_admin')));

revoke all on table
  public.departments,
  public.positions,
  public.roles,
  public.profiles,
  public.profile_roles,
  public.account_status_history,
  public.audit_logs
from public, anon, authenticated;

revoke all on all sequences in schema public from public, anon, authenticated;

grant select on table public.departments, public.positions, public.roles to authenticated;
grant select (id, display_name, account_status) on table public.profiles to authenticated;
grant select on table public.profile_roles to authenticated;
grant select on table public.account_status_history, public.audit_logs to authenticated;

revoke execute on function public.current_profile_is_active() from public, anon;
revoke execute on function public.current_user_has_role(text) from public, anon;
revoke execute on function public.private_append_audit(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.bootstrap_super_admin(uuid) from public, anon, authenticated;
revoke execute on function public.guard_last_active_super_admin_direct_write() from public, anon, authenticated;
revoke execute on function public.get_my_access_context() from public, anon;
revoke execute on function public.list_pending_profiles() from public, anon;
revoke execute on function public.approve_pending_user(uuid, uuid, uuid, text[], text) from public, anon;
revoke execute on function public.record_pending_decision(uuid, text, text) from public, anon;
revoke execute on function public.change_account_status(uuid, public.account_status, text) from public, anon;
revoke execute on function public.assign_profile_organization(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.set_profile_roles(uuid, text[], text) from public, anon;

grant execute on function public.current_profile_is_active() to authenticated;
grant execute on function public.current_user_has_role(text) to authenticated;
grant execute on function public.get_my_access_context() to authenticated;
grant execute on function public.list_pending_profiles() to authenticated;
grant execute on function public.approve_pending_user(uuid, uuid, uuid, text[], text) to authenticated;
grant execute on function public.record_pending_decision(uuid, text, text) to authenticated;
grant execute on function public.change_account_status(uuid, public.account_status, text) to authenticated;
grant execute on function public.assign_profile_organization(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.set_profile_roles(uuid, text[], text) to authenticated;

-- Prevent newly added functions from being callable by browser roles unless a later
-- reviewed migration grants them explicitly.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;

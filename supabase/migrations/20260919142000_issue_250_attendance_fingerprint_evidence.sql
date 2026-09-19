-- Issue #250: external fingerprint Excel as immutable attendance evidence.
-- Reuses the existing browser XLSX parser, but keeps operational attendance evidence
-- separate from payroll tables and payroll.manage authority.

begin;

insert into public.platform_capabilities(
  code, capability_kind, operations_manager_auto_grant, description
)
values (
  'attendance.evidence_import',
  'operational',
  true,
  '지문인식 등 외부 근태 근거자료 가져오기 및 직원 매핑'
)
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

insert into public.role_capability_grants(role_id, capability_code)
select r.id, 'attendance.evidence_import'
from public.roles r
where r.code = 'promotion_lead'
  and r.active
on conflict (role_id, capability_code) do nothing;

create table public.attendance_source_identity_mappings (
  id uuid primary key default gen_random_uuid(),
  source_system text not null
    check (source_system ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_employee_key text not null
    check (char_length(btrim(source_employee_key)) between 1 and 200),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active','revoked')),
  reason text not null
    check (char_length(btrim(reason)) between 2 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  revoke_reason text
    check (char_length(coalesce(revoke_reason,'')) <= 300),
  check (
    (status = 'active' and revoked_by is null and revoked_at is null)
    or
    (status = 'revoked' and revoked_by is not null and revoked_at is not null
      and char_length(btrim(coalesce(revoke_reason,''))) >= 2)
  )
);

create unique index attendance_source_identity_active_key_uq
  on public.attendance_source_identity_mappings(source_system, source_employee_key)
  where status = 'active';

create index attendance_source_identity_employee_idx
  on public.attendance_source_identity_mappings(employee_uuid, source_system, created_at desc);

create table public.attendance_external_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null
    check (source_system ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_file_name text not null
    check (char_length(btrim(source_file_name)) between 1 and 300),
  source_fingerprint text not null
    check (char_length(btrim(source_fingerprint)) between 16 and 256),
  source_sheet text
    check (char_length(coalesce(source_sheet,'')) <= 160),
  row_count integer not null default 0 check (row_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  unmatched_count integer not null default 0 check (unmatched_count >= 0),
  work_date_min date,
  work_date_max date,
  imported_by uuid not null references public.profiles(id) on delete restrict,
  imported_at timestamptz not null default now(),
  unique (source_system, source_fingerprint),
  check (
    (work_date_min is null and work_date_max is null)
    or
    (work_date_min is not null and work_date_max is not null and work_date_min <= work_date_max)
  )
);

create table public.attendance_external_evidence (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.attendance_external_import_batches(id) on delete restrict,
  source_system text not null
    check (source_system ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_key text not null
    check (char_length(btrim(source_key)) between 1 and 500),
  source_employee_key text
    check (char_length(coalesce(source_employee_key,'')) <= 200),
  source_display_name text
    check (char_length(coalesce(source_display_name,'')) <= 160),
  employee_uuid_at_import uuid references public.employees(id) on delete restrict,
  match_status text not null
    check (match_status in ('matched','unmatched','identity_missing')),
  work_date date not null,
  clock_in_raw text check (char_length(coalesce(clock_in_raw,'')) <= 80),
  clock_out_raw text check (char_length(coalesce(clock_out_raw,'')) <= 80),
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  source_sheet text check (char_length(coalesce(source_sheet,'')) <= 160),
  source_row_number integer check (source_row_number is null or source_row_number > 0),
  created_at timestamptz not null default now(),
  unique (batch_id, source_key)
);

create index attendance_external_evidence_date_employee_idx
  on public.attendance_external_evidence(work_date, employee_uuid_at_import, source_system);
create index attendance_external_evidence_batch_idx
  on public.attendance_external_evidence(batch_id, work_date);

alter table public.attendance_source_identity_mappings enable row level security;
alter table public.attendance_external_import_batches enable row level security;
alter table public.attendance_external_evidence enable row level security;

revoke all on
  public.attendance_source_identity_mappings,
  public.attendance_external_import_batches,
  public.attendance_external_evidence
from public, anon, authenticated;

create or replace function public.private_block_attendance_external_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'ATTENDANCE_EXTERNAL_EVIDENCE_APPEND_ONLY';
end;
$$;

create trigger attendance_external_evidence_append_only
before update or delete on public.attendance_external_evidence
for each row execute function public.private_block_attendance_external_evidence_mutation();

revoke all on function public.private_block_attendance_external_evidence_mutation()
from public, anon, authenticated;

create or replace function public.private_resolve_attendance_source_identity(
  p_source_system text,
  p_source_employee_key text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved uuid;
  exact_count integer := 0;
begin
  if nullif(btrim(coalesce(p_source_system, '')), '') is null
     or nullif(btrim(coalesce(p_source_employee_key, '')), '') is null then
    return null;
  end if;

  select m.employee_uuid into resolved
  from public.attendance_source_identity_mappings m
  where m.source_system = btrim(p_source_system)
    and m.source_employee_key = btrim(p_source_employee_key)
    and m.status = 'active'
  order by m.created_at desc
  limit 1;

  if resolved is not null then
    return resolved;
  end if;

  -- Safe automatic bridge only when the vendor key exactly equals one canonical
  -- Employee.employee_id. Never silently fall back to a same-name employee.
  select count(*), min(e.id::text)::uuid
  into exact_count, resolved
  from public.employees e
  where e.employee_id = btrim(p_source_employee_key)
    and public.private_employee_is_attendance_subject(e.id);

  if exact_count = 1 then
    return resolved;
  end if;
  return null;
end;
$$;

revoke all on function public.private_resolve_attendance_source_identity(text,text)
from public, anon, authenticated;

create or replace function public.save_attendance_source_identity_mapping(
  p_source_system text,
  p_source_employee_key text,
  p_employee_uuid uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  v_source_system text := btrim(coalesce(p_source_system,''));
  v_source_key text := btrim(coalesce(p_source_employee_key,''));
  v_reason_text text := btrim(coalesce(p_reason,''));
  current_mapping public.attendance_source_identity_mappings%rowtype;
  created public.attendance_source_identity_mappings%rowtype;
begin
  if actor_id is null or not public.private_actor_can('attendance.evidence_import') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if v_source_system !~ '^[a-z][a-z0-9_]{1,49}$'
     or char_length(v_source_key) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SOURCE_IDENTITY');
  end if;
  if char_length(v_reason_text) not between 2 and 300 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if p_employee_uuid is null
     or not public.private_employee_is_attendance_subject(p_employee_uuid) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ATTENDANCE_EMPLOYEE');
  end if;

  select * into current_mapping
  from public.attendance_source_identity_mappings m
  where m.source_system = v_source_system
    and m.source_employee_key = v_source_key
    and m.status = 'active'
  for update;

  if current_mapping.id is not null and current_mapping.employee_uuid = p_employee_uuid then
    return jsonb_build_object(
      'ok', true,
      'code', 'IDENTITY_MAPPING_UNCHANGED',
      'mapping_id', current_mapping.id
    );
  end if;

  if current_mapping.id is not null then
    update public.attendance_source_identity_mappings
    set status = 'revoked',
        revoked_by = actor_id,
        revoked_at = now(),
        revoke_reason = v_reason_text
    where id = current_mapping.id;
  end if;

  insert into public.attendance_source_identity_mappings(
    source_system, source_employee_key, employee_uuid, reason, created_by
  ) values (
    v_source_system, v_source_key, p_employee_uuid, v_reason_text, actor_id
  )
  returning * into created;

  perform public.private_append_audit(
    actor_id,
    'attendance_source_identity_mapped',
    'attendance_source_identity_mapping',
    created.id::text,
    'success',
    '외부 근태 직원 매핑',
    jsonb_build_object(
      'source_system', v_source_system,
      'source_employee_key', v_source_key,
      'employee_uuid', p_employee_uuid,
      'replaced_mapping_id', current_mapping.id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'IDENTITY_MAPPING_SAVED',
    'mapping_id', created.id
  );
end;
$$;

create or replace function public.import_attendance_external_evidence(
  p_source_system text,
  p_source_file_name text,
  p_source_fingerprint text,
  p_source_sheet text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  v_source_system text := btrim(coalesce(p_source_system,''));
  v_source_file text := btrim(coalesce(p_source_file_name,''));
  v_fingerprint text := btrim(coalesce(p_source_fingerprint,''));
  v_source_sheet text := nullif(btrim(coalesce(p_source_sheet,'')), '');
  existing_batch uuid;
  batch public.attendance_external_import_batches%rowtype;
  item jsonb;
  work_day date;
  source_row integer;
  employee_key text;
  display_name text;
  clock_in_text text;
  clock_out_text text;
  clock_in_value timestamptz;
  clock_out_value timestamptz;
  resolved_employee uuid;
  v_source_key text;
  matched integer := 0;
  unmatched integer := 0;
  min_day date;
  max_day date;
  row_total integer;
begin
  if actor_id is null or not public.private_actor_can('attendance.evidence_import') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if v_source_system !~ '^[a-z][a-z0-9_]{1,49}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SOURCE_SYSTEM');
  end if;
  if char_length(v_source_file) not between 1 and 300
     or char_length(v_fingerprint) not between 16 and 256 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SOURCE_FILE');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROWS');
  end if;

  row_total := jsonb_array_length(p_rows);
  if row_total < 1 or row_total > 5000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROW_COUNT');
  end if;

  select b.id into existing_batch
  from public.attendance_external_import_batches b
  where b.source_system = v_source_system
    and b.source_fingerprint = v_fingerprint
  limit 1;

  if existing_batch is not null then
    return jsonb_build_object(
      'ok', true,
      'code', 'DUPLICATE_IMPORT',
      'batch_id', existing_batch
    );
  end if;

  insert into public.attendance_external_import_batches(
    source_system, source_file_name, source_fingerprint, source_sheet,
    row_count, imported_by
  ) values (
    v_source_system, v_source_file, v_fingerprint, v_source_sheet, row_total, actor_id
  )
  returning * into batch;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    begin
      work_day := nullif(item->>'work_date','')::date;
      source_row := nullif(item->>'source_row_number','')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'INVALID_ATTENDANCE_EVIDENCE_ROW';
    end;

    employee_key := nullif(btrim(coalesce(item->>'source_employee_key','')), '');
    display_name := nullif(btrim(coalesce(item->>'source_display_name','')), '');
    clock_in_text := nullif(btrim(coalesce(item->>'clock_in','')), '');
    clock_out_text := nullif(btrim(coalesce(item->>'clock_out','')), '');

    if work_day is null
       or (source_row is not null and source_row <= 0)
       or (employee_key is null and display_name is null)
       or (clock_in_text is null and clock_out_text is null)
       or (clock_in_text is not null and clock_in_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
       or (clock_out_text is not null and clock_out_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception using errcode = '22023', message = 'INVALID_ATTENDANCE_EVIDENCE_ROW';
    end if;

    resolved_employee := public.private_resolve_attendance_source_identity(
      v_source_system,
      employee_key
    );

    clock_in_value := case when clock_in_text is null then null
      else ((work_day + clock_in_text::time) at time zone 'Asia/Seoul') end;
    clock_out_value := case when clock_out_text is null then null
      else ((work_day + clock_out_text::time) at time zone 'Asia/Seoul') end;

    v_source_key := concat_ws('|',
      v_source_system,
      coalesce(v_source_sheet, ''),
      coalesce(source_row::text, ''),
      coalesce(employee_key, display_name, ''),
      work_day::text
    );

    insert into public.attendance_external_evidence(
      batch_id, source_system, source_key, source_employee_key,
      source_display_name, employee_uuid_at_import, match_status,
      work_date, clock_in_raw, clock_out_raw, clock_in_at, clock_out_at,
      source_sheet, source_row_number
    ) values (
      batch.id, v_source_system, v_source_key, employee_key,
      display_name, resolved_employee,
      case
        when resolved_employee is not null then 'matched'
        when employee_key is null then 'identity_missing'
        else 'unmatched'
      end,
      work_day, clock_in_text, clock_out_text, clock_in_value, clock_out_value,
      v_source_sheet, source_row
    );

    if resolved_employee is null then
      unmatched := unmatched + 1;
    else
      matched := matched + 1;
    end if;
    min_day := least(coalesce(min_day, work_day), work_day);
    max_day := greatest(coalesce(max_day, work_day), work_day);
  end loop;

  update public.attendance_external_import_batches
  set matched_count = matched,
      unmatched_count = unmatched,
      work_date_min = min_day,
      work_date_max = max_day
  where id = batch.id;

  perform public.private_append_audit(
    actor_id,
    'attendance_external_evidence_imported',
    'attendance_external_import_batch',
    batch.id::text,
    'success',
    '외부 지문 근태자료 가져오기',
    jsonb_build_object(
      'source_system', v_source_system,
      'row_count', row_total,
      'matched_count', matched,
      'unmatched_count', unmatched,
      'work_date_min', min_day,
      'work_date_max', max_day
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ATTENDANCE_EVIDENCE_IMPORTED',
    'batch_id', batch.id,
    'row_count', row_total,
    'matched_count', matched,
    'unmatched_count', unmatched,
    'work_date_min', min_day,
    'work_date_max', max_day
  );
exception
  when unique_violation then
    select b.id into existing_batch
    from public.attendance_external_import_batches b
    where b.source_system = v_source_system
      and b.source_fingerprint = v_fingerprint
    limit 1;
    if existing_batch is not null then
      return jsonb_build_object(
        'ok', true,
        'code', 'DUPLICATE_IMPORT',
        'batch_id', existing_batch
      );
    end if;
    raise;
end;
$$;

create or replace function public.get_attendance_external_evidence(
  p_work_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_day date := coalesce(p_work_date, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'work_date', target_day,
    'rows', coalesce((
      with latest_batch as (
        select distinct on (b.source_system)
          b.id, b.source_system, b.source_file_name, b.source_sheet, b.imported_at
        from public.attendance_external_import_batches b
        join public.attendance_external_evidence e on e.batch_id = b.id
        where e.work_date = target_day
        order by b.source_system, b.imported_at desc, b.id desc
      )
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'batch_id', e.batch_id,
        'source_system', e.source_system,
        'source_employee_key', e.source_employee_key,
        'source_display_name', e.source_display_name,
        'employee_uuid', coalesce(
          public.private_resolve_attendance_source_identity(
            e.source_system,
            e.source_employee_key
          ),
          e.employee_uuid_at_import
        ),
        'match_status', case
          when coalesce(
            public.private_resolve_attendance_source_identity(
              e.source_system,
              e.source_employee_key
            ),
            e.employee_uuid_at_import
          ) is not null then 'matched'
          else e.match_status
        end,
        'work_date', e.work_date,
        'clock_in_at', e.clock_in_at,
        'clock_out_at', e.clock_out_at,
        'clock_in_raw', e.clock_in_raw,
        'clock_out_raw', e.clock_out_raw,
        'source_file_name', b.source_file_name,
        'source_sheet', e.source_sheet,
        'source_row_number', e.source_row_number,
        'imported_at', b.imported_at
      ) order by coalesce(e.source_display_name,e.source_employee_key,''), e.source_row_number)
      from public.attendance_external_evidence e
      join latest_batch b on b.id = e.batch_id
      where e.work_date = target_day
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_attendance_source_identity_mapping(text,text,uuid,text)
from public, anon;
revoke all on function public.import_attendance_external_evidence(text,text,text,text,jsonb)
from public, anon;
revoke all on function public.get_attendance_external_evidence(date)
from public, anon;

grant execute on function public.save_attendance_source_identity_mapping(text,text,uuid,text)
to authenticated;
grant execute on function public.import_attendance_external_evidence(text,text,text,text,jsonb)
to authenticated;
grant execute on function public.get_attendance_external_evidence(date)
to authenticated;

comment on table public.attendance_external_evidence is
  'Immutable external attendance evidence such as fingerprint-device Excel rows. It is review evidence, not payroll truth and not final attendance.';
comment on table public.attendance_source_identity_mappings is
  'Reviewed mapping from a stable external attendance source employee key to canonical Employee. Name-only silent matching is intentionally forbidden.';
comment on function public.import_attendance_external_evidence(text,text,text,text,jsonb) is
  'Capability-gated external attendance evidence import with file fingerprint duplicate protection and immutable source rows.';
comment on function public.get_attendance_external_evidence(date) is
  'Attendance-admin evidence read model. Uses the latest imported batch per source system for the selected date without mutating prior evidence.';

commit;

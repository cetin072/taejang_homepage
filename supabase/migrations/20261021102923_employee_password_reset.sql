-- Issue #500. Additive contract only; no operational accounts are changed.
begin;
insert into public.platform_capabilities(code,capability_kind,operations_manager_auto_grant,description)
values('employee.password_reset','operational',false,'Reset only eligible linked employee credentials via the server')
on conflict(code) do nothing;
insert into public.role_capability_grants(role_id,capability_code)
select id,'employee.password_reset' from public.roles where active and code in ('promotion_lead','operations_manager')
on conflict do nothing;

-- Two explicitly approved existing-account exceptions; intentionally empty.
-- Operator supplies immutable Employee/Profile IDs after identity verification.
create table public.employee_reset_exceptions(
 slot smallint primary key check(slot in (1,2)),
 employee_uuid uuid not null unique references public.employees(id),
 profile_id uuid not null unique references public.profiles(id),
 expires_at timestamptz not null,
 consumed_at timestamptz
);
create table public.employee_reset_attempts(
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.profiles(id),
 employee_uuid uuid not null,
 profile_id uuid,
 employee_number text not null,
 reason text not null check(char_length(reason) between 5 and 300),
 mode text not null check(mode in ('random','manual')),
 state text not null check(state in ('reserved','executing','success','failed','denied')),
 code text not null,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create index employee_reset_actor_time on public.employee_reset_attempts(actor_id,created_at);
create index employee_reset_target_time on public.employee_reset_attempts(employee_uuid,created_at);
create unique index employee_reset_one_open_target on public.employee_reset_attempts(employee_uuid)
 where state in ('reserved','executing');
alter table public.employee_reset_attempts enable row level security;
alter table public.employee_reset_exceptions enable row level security;
revoke all on public.employee_reset_attempts,public.employee_reset_exceptions from public,anon,authenticated;
grant select,insert,update on public.employee_reset_attempts,public.employee_reset_exceptions to service_role;

create function public.employee_password_reset_option(p_employee_uuid uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); e public.employees%rowtype; p public.profiles%rowtype;
 roles text[]; ops boolean; person_name text;
begin
 if actor is null or not public.current_profile_is_active()
    or not exists(select 1 from auth.sessions s where s.user_id=actor
       and s.id::text=auth.jwt()->>'session_id')
    or not public.private_actor_can('employee.password_reset')
    or not exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id
       where pr.profile_id=actor and pr.revoked_at is null and r.active
       and r.code in ('operations_manager','promotion_lead') and pr.scope_type='company')
 then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 ops:='operations_manager'=any(public.private_actual_role_codes());
 select * into e from public.employees where id=p_employee_uuid;
 if not found or e.archived_at is not null or e.employment_status<>'active' or e.departed_on is not null
 then return jsonb_build_object('ok',false,'code','EMPLOYEE_UNAVAILABLE'); end if;
 select full_name into person_name from public.people where id=e.person_id;
 if (select count(*) from public.employees other_e join public.people person on person.id=other_e.person_id
     where other_e.archived_at is null and
       regexp_replace(person.full_name,'[[:space:]]','','g')=regexp_replace(person_name,'[[:space:]]','','g'))<>1
 then return jsonb_build_object('ok',false,'code','AMBIGUOUS_IDENTITY'); end if;
 if (select count(*) from public.account_person_links where person_id=e.person_id and revoked_at is null)<>1
 then return jsonb_build_object('ok',false,'code','LINK_UNAVAILABLE'); end if;
 select prf.* into p from public.profiles prf join public.account_person_links l on l.profile_id=prf.id
 where l.person_id=e.person_id and l.revoked_at is null;
 if p.id=actor or p.account_status<>'active' or nullif(p.work_email,'') is null
    or (select count(*) from public.account_person_links where profile_id=p.id and revoked_at is null)<>1
 then return jsonb_build_object('ok',false,'code','PROTECTED_ACCOUNT'); end if;
 select array_agg(r.code) into roles from public.profile_roles pr join public.roles r on r.id=pr.role_id
 where pr.profile_id=p.id and pr.revoked_at is null;
 -- Inspect EVERY unrevoked role, both job positions, and every capability grant.
 if roles is null or not (roles <@ case when ops then
      array['general_worker','promotion_staff','office_staff','worker_support_staff','work_assistant','external_guide']
      else array['general_worker','promotion_staff'] end)
    or exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id
       where pr.profile_id=p.id and pr.revoked_at is null and not r.active)
    or not exists(select 1 from public.positions pos where pos.id=e.position_id and pos.active
       and pos.code in ('staff','general_worker','work_assistant','external_guide'))
    or not exists(select 1 from public.positions pos where pos.id=p.position_id and pos.active
       and pos.code in ('staff','general_worker','work_assistant','external_guide'))
    or exists(select 1 from public.profile_roles pr
       join public.role_capability_grants g on g.role_id=pr.role_id
       join public.platform_capabilities c on c.code=g.capability_code and c.active
       where pr.profile_id=p.id and pr.revoked_at is null
         and (c.capability_kind='technical' or c.code like 'account.%' or c.code like 'employee.%'
              or c.code not in ('attendance.self_record','promotion.write','promotion.edit_own','support_radar.assigned_work')))
 then return jsonb_build_object('ok',false,'code','PROTECTED_ACCOUNT'); end if;
 return jsonb_build_object('ok',true,'profile_id',p.id,'employee_number',e.employee_id,
   'email',p.work_email,'manual_allowed',ops and exists(
     select 1 from public.employee_reset_exceptions x where x.employee_uuid=e.id and x.profile_id=p.id
       and x.consumed_at is null and x.expires_at>now()));
end;
$$;
revoke all on function public.employee_password_reset_option(uuid) from public,anon,authenticated;
grant execute on function public.employee_password_reset_option(uuid) to authenticated;

create function public.reserve_employee_password_reset(
 p_employee_uuid uuid,p_employee_number text,p_profile_id uuid,p_reason text,p_mode text,p_identity_verified boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); opt jsonb; attempt uuid; result text:='RESERVED';
begin
 if actor is null or not public.current_profile_is_active() then
   return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 -- No credential field is accepted by any database RPC.
 if p_reason is null or char_length(btrim(p_reason)) not between 5 and 300
    or p_reason ~ '[0-9]{4}' or p_reason ~* '(password|token|secret|비밀번호|비밀키)'
    or p_mode is null or p_mode not in ('random','manual')
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,500));
 -- Bound storage and reauthentication attempts even when the target is forged.
 if (select count(*) from public.employee_reset_attempts where actor_id=actor and created_at>now()-interval '15 minutes')>=5
 then return jsonb_build_object('ok',false,'code','RATE_LIMITED'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee_uuid::text,501));
 opt:=public.employee_password_reset_option(p_employee_uuid);
 if not coalesce((opt->>'ok')::boolean,false) then result:=opt->>'code';
 elsif p_identity_verified is distinct from true or p_employee_number is distinct from opt->>'employee_number'
       or p_profile_id is distinct from (opt->>'profile_id')::uuid then result:='IDENTITY_MISMATCH';
 elsif p_mode='manual' and not (opt->>'manual_allowed')::boolean then result:='MANUAL_FORBIDDEN';
 elsif exists(select 1 from public.employee_reset_attempts where employee_uuid=p_employee_uuid
       and state in ('reserved','executing')) then result:='REQUEST_PENDING';
 elsif (select count(*) from public.employee_reset_attempts where employee_uuid=p_employee_uuid
       and state<>'denied' and created_at>now()-interval '1 hour')>=3
 then result:='RATE_LIMITED'; end if;
 insert into public.employee_reset_attempts(actor_id,employee_uuid,profile_id,employee_number,reason,mode,state,code)
 values(actor,p_employee_uuid,case when result='RESERVED' then p_profile_id end,
   coalesce(p_employee_number,''),btrim(p_reason),p_mode,case when result='RESERVED' then 'reserved' else 'denied' end,result)
 returning id into attempt;
 perform public.private_append_audit(actor,'employee_credential_reset_requested','employee',p_employee_uuid::text,
   case when result='RESERVED' then 'success' else 'denied' end,btrim(p_reason),
   jsonb_build_object('request_id',attempt,'result',result));
 return jsonb_build_object('ok',result='RESERVED','code',result,'request_id',attempt,'option',case when result='RESERVED' then opt end);
end;
$$;
revoke all on function public.reserve_employee_password_reset(uuid,text,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.reserve_employee_password_reset(uuid,text,uuid,text,text,boolean) to authenticated;

-- Revalidate through the original authenticated JWT immediately before the Auth mutation.
-- One-time CAS prevents concurrent/replayed execution. Unresolved requests never auto-unlock.
create function public.begin_employee_password_reset(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.employee_reset_attempts%rowtype; opt jsonb;
begin
 select * into a from public.employee_reset_attempts where id=p_request_id and actor_id=auth.uid() for update;
 if not found or a.state<>'reserved' or a.created_at<now()-interval '2 minutes'
 then return jsonb_build_object('ok',false,'code','REQUEST_UNAVAILABLE'); end if;
 opt:=public.employee_password_reset_option(a.employee_uuid);
 if not coalesce((opt->>'ok')::boolean,false)
    or opt->>'profile_id' is distinct from a.profile_id::text
    or opt->>'employee_number' is distinct from a.employee_number
    or (a.mode='manual' and not coalesce((opt->>'manual_allowed')::boolean,false))
 then return jsonb_build_object('ok',false,'code','TARGET_CHANGED'); end if;
 if a.mode='manual' then
   update public.employee_reset_exceptions set consumed_at=now()
   where employee_uuid=a.employee_uuid and profile_id=a.profile_id and consumed_at is null and expires_at>now();
   if not found then return jsonb_build_object('ok',false,'code','MANUAL_FORBIDDEN'); end if;
 end if;
 update public.employee_reset_attempts set state='executing' where id=a.id;
 return jsonb_build_object('ok',true,'profile_id',a.profile_id,'email',opt->>'email');
end;
$$;
revoke all on function public.begin_employee_password_reset(uuid) from public,anon,authenticated;
grant execute on function public.begin_employee_password_reset(uuid) to authenticated;

create function public.finish_employee_password_reset(p_request_id uuid,p_result text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.employee_reset_attempts%rowtype;
begin
 if p_result not in ('SUCCESS','REAUTH_FAILED','AUTH_UNAVAILABLE','POLICY_REJECTED','TARGET_CHANGED','UNKNOWN') or p_result is null then return false; end if;
 select * into a from public.employee_reset_attempts where id=p_request_id for update;
 if not found or a.state not in ('reserved','executing') then return false; end if;
 if p_result='SUCCESS' and a.state<>'executing' then return false; end if;
 perform public.private_append_audit(a.actor_id,'employee_credential_reset_finished','employee',a.employee_uuid::text,
   case when p_result='SUCCESS' then 'success' else 'failed' end,a.reason,
   jsonb_build_object('request_id',a.id,'result',p_result,'profile_id',a.profile_id,'mode',a.mode));
 update public.employee_reset_attempts set state=case when p_result='UNKNOWN' then 'executing' when p_result='SUCCESS' then 'success' else 'failed' end,
   code=p_result,finished_at=now() where id=a.id;
 return true;
end;
$$;
revoke all on function public.finish_employee_password_reset(uuid,text) from public,anon,authenticated;
grant execute on function public.finish_employee_password_reset(uuid,text) to service_role;
commit;

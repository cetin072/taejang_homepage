-- User-approved button/confirmation flow; no operational data mutations.
begin;
create function public.private_employee_reset_recent_auth()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
   and exists(select 1 from auth.sessions s where s.user_id=auth.uid()
     and s.id::text=auth.jwt()->>'session_id'
     and (s.not_after is null or s.not_after>now()))
   and exists(select 1 from jsonb_array_elements(
     case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end) a
     where a->>'method'='password'
       and case when jsonb_typeof(a->'timestamp')='number' then
         (a->>'timestamp')::numeric between extract(epoch from now())-600 and extract(epoch from now())
       else false end);
$$;
revoke all on function public.private_employee_reset_recent_auth() from public,anon,authenticated;

create function public.reserve_employee_password_reset_simple(p_employee_uuid uuid,p_request_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare opt jsonb; reservation jsonb;
begin
 if p_request_confirmed is distinct from true then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 opt:=public.employee_password_reset_option(p_employee_uuid);
 if not coalesce((opt->>'ok')::boolean,false) then return opt; end if;
 -- Resolve the number/Auth link on the server; reuse locks, limits and durable audit.
 reservation:=public.reserve_employee_password_reset(p_employee_uuid,opt->>'employee_number',
   (opt->>'profile_id')::uuid,'현장 로그인 지원','random',true);
 if not coalesce((reservation->>'ok')::boolean,false) then return reservation; end if;
 if not public.private_employee_reset_recent_auth() then
   perform public.finish_employee_password_reset((reservation->>'request_id')::uuid,'REAUTH_FAILED');
   return jsonb_build_object('ok',false,'code','REAUTH_REQUIRED');
 end if;
 return reservation;
end;
$$;
revoke all on function public.reserve_employee_password_reset_simple(uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_employee_password_reset_simple(uuid,boolean) to authenticated;

create or replace function public.begin_employee_password_reset(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.employee_reset_attempts%rowtype; opt jsonb;
begin
 select * into a from public.employee_reset_attempts where id=p_request_id and actor_id=auth.uid() for update;
 if not found or a.state<>'reserved' or a.created_at<now()-interval '2 minutes'
 then return jsonb_build_object('ok',false,'code','REQUEST_UNAVAILABLE'); end if;
 if not public.private_employee_reset_recent_auth() then return jsonb_build_object('ok',false,'code','REAUTH_REQUIRED'); end if;
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
commit;

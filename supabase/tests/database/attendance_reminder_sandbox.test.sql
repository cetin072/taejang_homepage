-- Isolation-only executable prototype. No production RPC or migration.
-- Snapshot is synthetic trusted SERVER input; never accept these flags from an app.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

create function pg_temp.reminder_eligible(s jsonb, kind text, lat float8, lon float8,
  accuracy float8, captured timestamptz, server_now timestamptz)
returns boolean language plpgsql stable set search_path = '' as $$
declare due_at timestamptz; start_at timestamptz; end_at timestamptz;
begin
  if auth.uid() is null or s->>'profile_id' is distinct from auth.uid()::text
    or s->>'active' is distinct from 'true' or s->>'attendance_required' is distinct from 'true'
    or s->>'opt_in' is distinct from 'true' or s->>'source_confirmed' is distinct from 'true'
    or s->>'workday' is distinct from 'true' or s->>'day_status' is distinct from 'work'
    or s->>'offsite' is distinct from 'false' or s->>'exception' is distinct from 'false'
    or s->>'location_allowed' is distinct from 'true' or s->>'office_active' is distinct from 'true'
    or kind is null or kind not in ('clock_in','clock_out') or server_now is null
    or s->>'work_date' is distinct from ((server_now at time zone 'Asia/Seoul')::date)::text
    or s->>(kind || '_exists') is distinct from 'false' then return false; end if;
  if kind='clock_out' and s->>'valid_clock_in' is distinct from 'true' then return false; end if;
  start_at := (s->>'start_at')::timestamptz; end_at := (s->>'end_at')::timestamptz;
  if start_at is null or end_at is null or end_at <= start_at
    or (start_at at time zone 'Asia/Seoul')::date <> (server_now at time zone 'Asia/Seoul')::date
    or (end_at at time zone 'Asia/Seoul')::date <> (server_now at time zone 'Asia/Seoul')::date
    then return false; end if;
  due_at := case kind when 'clock_in' then start_at else end_at end + interval '5 minutes';
  if server_now < due_at or captured is null or captured > server_now
    or server_now-captured > interval '120 seconds' or lat is null or lon is null
    or not (lat between -90 and 90) or not (lon between -180 and 180)
    or accuracy is null or not (accuracy between 0 and 80)
    or not ((s->>'office_lat')::float8 between -90 and 90)
    or not ((s->>'office_lon')::float8 between -180 and 180)
    or not ((s->>'radius_m')::float8 between 20 and 500)
    or s->>'office_lat' is null or s->>'office_lon' is null or s->>'radius_m' is null
    then return false; end if;
  return public.private_attendance_distance_m(lat,lon,(s->>'office_lat')::float8,
    (s->>'office_lon')::float8) <= (s->>'radius_m')::float8;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create temporary table reminder_receipts(profile_id uuid, work_date date, kind text,
  primary key(profile_id,work_date,kind)) on commit drop;
create function pg_temp.claim_reminder(s jsonb, kind text, at_time timestamptz)
returns boolean language plpgsql set search_path = '' as $$
declare claimed integer;
begin
  if not pg_temp.reminder_eligible(s,kind,0,0,5,at_time,at_time) then return false; end if;
  insert into pg_temp.reminder_receipts values(auth.uid(),(s->>'work_date')::date,kind)
    on conflict do nothing;
  get diagnostics claimed = row_count;
  return claimed=1;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000571',true);
create temporary table reminder_fixture as select jsonb_build_object(
  'profile_id',auth.uid(),'active',true,'attendance_required',true,'opt_in',true,
  'source_confirmed',true,'workday',true,'day_status','work','offsite',false,
  'exception',false,'location_allowed',true,'office_active',true,'office_lat',0,
  'office_lon',0,'radius_m',60,'work_date','2026-11-02','start_at','2026-11-02T09:00:00+09:00',
  'end_at','2026-11-02T18:00:00+09:00','clock_in_exists',false,'clock_out_exists',false,
  'valid_clock_in',true) as s;

select ok(pg_temp.reminder_eligible(s,'clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'start+5 boundary') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s,'clock_in',0,0,5,'2026-11-02T09:04:59+09','2026-11-02T09:04:59+09'),'before start+5') from reminder_fixture;
select ok(pg_temp.reminder_eligible(s,'clock_out',0,0,5,'2026-11-02T18:05+09','2026-11-02T18:05+09'),'end+5 boundary') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s-'source_confirmed','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'unconfirmed source closed') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"offsite":true}','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'offsite suppressed') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s-'offsite','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'unknown exclusion closed') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"workday":false}','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'nonwork day') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||jsonb_build_object('day_status',status),'clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'day status '||status) from reminder_fixture cross join (values('paid_leave'),('paid_holiday'),('unpaid_absence'),('review_required')) as x(status);
select ok(not pg_temp.reminder_eligible(s||'{"clock_in_exists":true}','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'existing record suppressed') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"exception":true}','clock_out',0,0,5,'2026-11-02T18:05+09','2026-11-02T18:05+09'),'exception suppressed') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"location_allowed":false}','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'permission denied') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s,'clock_in',null,null,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'unknown location') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s,'clock_in',1,1,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'outside office') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s,'clock_in',0,0,81,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'uncertain location') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s,'clock_in',0,0,5,'2026-11-02T09:02:59+09','2026-11-02T09:05+09'),'stale location') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"profile_id":"other"}','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'other subject') from reminder_fixture;
select ok(pg_temp.claim_reminder(s,'clock_in','2026-11-02T09:05+09'),'first daily receipt') from reminder_fixture;
select ok(not pg_temp.claim_reminder(s,'clock_in','2026-11-02T09:06+09'),'duplicate receipt suppressed') from reminder_fixture;
select ok(pg_temp.claim_reminder(s,'clock_out','2026-11-02T18:05+09'),'separate end receipt') from reminder_fixture;
select is((select count(*)::integer from pg_temp.reminder_receipts),2,'only test receipt rows');
select ok(not pg_temp.reminder_eligible(s,'clock_in',0,0,5,'2026-11-02T09:05:01+09','2026-11-02T09:05+09'),'future location rejected') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"active":false}','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'inactive subject') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"opt_in":false}','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'consent absent') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"start_at":"invalid"}','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'malformed schedule closed') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s-'start_at','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'missing schedule closed') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s,'clock_in',0,0,5,'2026-11-03T09:05+09','2026-11-03T09:05+09'),'previous work date rejected') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s||'{"valid_clock_in":false}','clock_out',0,0,5,'2026-11-02T18:05+09','2026-11-02T18:05+09'),'existing clock-in requirement preserved') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s-'office_lat','clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'unknown office rejected') from reminder_fixture;
select ok(not pg_temp.reminder_eligible(s,null,0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'unknown event rejected') from reminder_fixture;
select set_config('request.jwt.claim.sub','',true);
select ok(not pg_temp.reminder_eligible(s,'clock_in',0,0,5,'2026-11-02T09:05+09','2026-11-02T09:05+09'),'anonymous rejected') from reminder_fixture;
select * from finish();
rollback;

-- Phase C Contract v1 review-stage action guard.
-- Staging first; this prevents broader approval powers than the approved flow.
begin;

create or replace function public.guard_promotion_review_stage_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.decision = 'pending' and new.decision <> old.decision then
    if old.stage = 'lead' and new.decision in ('on_hold', 'rejected') then
      raise exception using errcode = '22023', message = 'PROMOTION_LEAD_DECISION_INVALID';
    elsif old.stage = 'operations' and new.decision = 'rejected' then
      raise exception using errcode = '22023', message = 'PROMOTION_OPERATIONS_DECISION_INVALID';
    end if;
  end if;
  return new;
end;
$$;

alter function public.guard_promotion_review_stage_decision() owner to postgres;
revoke all on function public.guard_promotion_review_stage_decision() from public, anon, authenticated;

drop trigger if exists promotion_review_stage_decision_guard on public.promotion_review_requests;
create trigger promotion_review_stage_decision_guard
before update of decision on public.promotion_review_requests
for each row execute function public.guard_promotion_review_stage_decision();

comment on function public.guard_promotion_review_stage_decision() is
  'Phase C Contract v1 guard: lead cannot hold/reject; operations cannot reject; CEO retains reject/hold authority.';

commit;

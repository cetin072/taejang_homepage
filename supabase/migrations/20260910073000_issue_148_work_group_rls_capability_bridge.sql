-- Issue #148 follow-up: RLS expressions execute as the authenticated caller.
-- Keep private_actor_can() non-executable from browser roles; use the existing
-- effective-role helpers inside RLS while capability-gated RPCs remain authoritative.

begin;

drop policy if exists work_groups_read on public.work_groups;
create policy work_groups_read on public.work_groups
for select to authenticated
using (
  (active and (select public.current_user_in_work_group(id)))
  or (
    (select public.current_user_has_role('operations_manager'))
    or (
      (select public.current_user_has_role('department_lead'))
      and (select public.current_user_department_id()) = department_id
    )
    or (
      (select public.current_user_has_role('field_lead'))
      and (select public.current_user_leads_work_group(id))
    )
  )
);

commit;

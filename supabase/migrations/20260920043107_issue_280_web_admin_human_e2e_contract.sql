-- Issue #280: align the promotion-lead navigation with the existing server-authoritative
-- capability gates. This adds no payroll capability and does not change attendance subject policy.
-- Hosted deployment remains a separate, explicitly approved operation.

begin;

insert into public.role_capability_grants(role_id, capability_code)
select role.id, capability.code
from public.roles role
join public.platform_capabilities capability
  on capability.code in ('task.manage', 'schedule.manage', 'notice.manage')
where role.code = 'promotion_lead'
  and role.active
  and capability.active
on conflict (role_id, capability_code) do nothing;

commit;

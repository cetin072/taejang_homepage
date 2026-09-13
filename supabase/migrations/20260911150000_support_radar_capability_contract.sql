-- Support Radar Phase 1 capability contract.
-- Existing RLS/RPC guards remain authoritative and unchanged in this rollout.

begin;

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description)
values
  ('support_radar.management_view', 'operational', true, '지원사업 레이더 전사 관리 조회'),
  ('support_radar.management_edit', 'operational', true, '지원사업 레이더 운영 관리 변경'),
  ('support_radar.assigned_work', 'operational', true, '배정된 지원사업 조회와 실무 진행')
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

with grants(role_code, capability_code) as (
  values
    ('ceo', 'support_radar.management_view'),
    ('department_lead', 'support_radar.assigned_work'),
    ('promotion_lead', 'support_radar.assigned_work'),
    ('promotion_staff', 'support_radar.assigned_work'),
    ('worker_support_lead', 'support_radar.assigned_work'),
    ('worker_support_staff', 'support_radar.assigned_work'),
    ('office_staff', 'support_radar.assigned_work')
)
insert into public.role_capability_grants(role_id, capability_code)
select role.id, grants.capability_code
from grants
join public.roles role on role.code = grants.role_code and role.active
join public.platform_capabilities capability on capability.code = grants.capability_code and capability.active
on conflict (role_id, capability_code) do nothing;

commit;

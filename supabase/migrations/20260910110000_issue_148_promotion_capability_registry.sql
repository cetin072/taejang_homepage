-- Issue #148 A: additive promotion capability grants.  CEO approval stays
-- isolated from the operations-manager operational superset.
begin;

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description)
values
  ('promotion.review_ceo', 'operational', false, '대표이사 상신 홍보 안건 결정'),
  ('promotion.queue_publication', 'operational', true, '승인완료 홍보 콘텐츠 발행 대기 등록')
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

insert into public.role_capability_grants(role_id, capability_code)
select role.id, grant_row.capability_code
from (values
  ('promotion_lead', 'promotion.queue_publication'),
  ('ceo', 'promotion.review_ceo')
) as grant_row(role_code, capability_code)
join public.roles role on role.code = grant_row.role_code and role.active
join public.platform_capabilities capability on capability.code = grant_row.capability_code and capability.active
on conflict (role_id, capability_code) do nothing;

commit;

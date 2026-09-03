-- Hardening: this trigger function is internal-only and must never be exposed
-- through PostgREST RPC to anonymous or signed-in browser roles.
begin;

revoke all on function public.private_enforce_published_work_guide_assignment()
  from public, anon, authenticated;

commit;

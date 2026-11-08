begin;

-- Preserve RPC-only writes regardless of environment default table privileges.
revoke all on public.monthly_client_document_company_defaults,
  public.monthly_client_document_sets from authenticated;
grant select on public.monthly_client_document_company_defaults,
  public.monthly_client_document_sets to authenticated;

commit;

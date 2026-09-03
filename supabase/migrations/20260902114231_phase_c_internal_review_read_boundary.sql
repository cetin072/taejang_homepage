-- Phase C internal review/publication queue read boundary.
-- Browser roles use guarded RPCs instead of direct table SELECT for internal
-- approver comments, IDs, and queue metadata.
begin;

revoke select on table
  public.promotion_review_requests,
  public.promotion_publication_queue
from authenticated;

comment on table public.promotion_review_requests is
  'Phase C approval history. Browser access is through guarded workspace RPCs, not direct table SELECT.';
comment on table public.promotion_publication_queue is
  'Phase C publication queue. Browser access is through guarded workspace RPCs, not direct table SELECT.';

commit;

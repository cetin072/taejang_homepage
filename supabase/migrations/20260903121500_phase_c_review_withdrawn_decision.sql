-- Phase C pilot UX: preserve submitted-review history when a staff member
-- withdraws a request or a promotion lead replaces it with a new revision.
-- Keep this as a standalone migration so the enum value is committed before use.
alter type public.promotion_review_decision add value if not exists 'withdrawn';

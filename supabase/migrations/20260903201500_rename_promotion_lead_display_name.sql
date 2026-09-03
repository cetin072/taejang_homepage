-- Display-name-only terminology update.
-- The authorization role code remains promotion_lead so existing approval/RLS
-- contracts are unchanged.
begin;

update public.roles
set name = '운영팀장',
    updated_at = now()
where code = 'promotion_lead'
  and name is distinct from '운영팀장';

commit;

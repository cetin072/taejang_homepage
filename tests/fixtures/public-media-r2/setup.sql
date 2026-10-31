-- Isolated PostgreSQL fixture, NOT the complete application migrations.
create role anon nologin;
create role authenticated nologin;
create schema private;
revoke all on schema private from public, anon, authenticated;
create table public.promotion_contents(id uuid primary key,current_revision_id uuid,lifecycle text,published_at timestamptz);
create table public.promotion_content_revisions(id uuid primary key,content_id uuid,public_media jsonb);
alter table public.promotion_contents enable row level security;
alter table public.promotion_content_revisions enable row level security;
revoke all on public.promotion_contents, public.promotion_content_revisions from public,anon,authenticated;
-- Catch accidental use of either side-effectful API.
create function public.private_publish_due_promotions() returns void language plpgsql as $$ begin raise exception 'MUTATION PATH CALLED'; end $$;
create function public.get_public_promotion_content(uuid) returns jsonb language plpgsql as $$ begin perform public.private_publish_due_promotions(); return '[]'; end $$;
insert into public.promotion_contents values
('11111111-1111-4111-8111-111111111111','21111111-1111-4111-8111-111111111111','published',now()),
('11111111-1111-4111-8111-111111111112','21111111-1111-4111-8111-111111111112','hidden',now()),
('11111111-1111-4111-8111-111111111113','21111111-1111-4111-8111-111111111113','scheduled',null),
('11111111-1111-4111-8111-111111111114','21111111-1111-4111-8111-111111111114','published',null),
('11111111-1111-4111-8111-111111111115','21111111-1111-4111-8111-111111111115','archived',now()),
('11111111-1111-4111-8111-111111111116','21111111-1111-4111-8111-111111111116','draft',null);
insert into public.promotion_content_revisions select current_revision_id,id,'[{"url":"https://fixture.supabase.co/storage/v1/object/public/promotion-media/a.jpg"}]'::jsonb from public.promotion_contents;
insert into public.promotion_content_revisions values('31111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','[{"url":"https://fixture.supabase.co/storage/v1/object/public/promotion-media/old.jpg"}]');

-- Apply once in a new Supabase project. No existing website data is modified.
begin;
create schema if not exists gratitude_private;
revoke all on schema gratitude_private from public;
grant usage on schema gratitude_private to anon, authenticated;
create table public.gratitude_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.gratitude_admins enable row level security;
revoke all on public.gratitude_admins from anon, authenticated;
create function gratitude_private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.gratitude_admins where user_id = auth.uid());
$$;
revoke all on function gratitude_private.is_admin() from public;
grant execute on function gratitude_private.is_admin() to anon, authenticated;

create table public.gratitude_posts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null check(char_length(trim(display_name)) between 1 and 50),
 body text not null default '' check(char_length(body)<=2000),
 image_path text unique, image_alt text not null default '' check(char_length(image_alt)<=200),
 created_at timestamptz not null default now(),
 check(char_length(trim(body))>0 or image_path is not null),
 check(image_path is null or (image_path like user_id::text || '/%' and image_path ~ '^[a-f0-9-]+/[a-f0-9-]+\.(jpg|png|webp)$'))
);
create index gratitude_posts_date on public.gratitude_posts(created_at desc,id desc);
create table public.gratitude_comments (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references public.gratitude_posts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null check(char_length(trim(display_name)) between 1 and 50),
 body text not null check(char_length(trim(body)) between 1 and 1000), created_at timestamptz not null default now()
);
create index gratitude_comments_post on public.gratitude_comments(post_id,created_at desc);
create table public.gratitude_reports (
 id uuid primary key default gen_random_uuid(), reporter uuid not null references auth.users(id) on delete cascade,
 post_id uuid not null references public.gratitude_posts(id) on delete cascade,
 comment_id uuid references public.gratitude_comments(id) on delete cascade,
 reason text not null check(char_length(trim(reason)) between 1 and 500), created_at timestamptz not null default now()
);
alter table public.gratitude_posts enable row level security;
alter table public.gratitude_comments enable row level security;
alter table public.gratitude_reports enable row level security;
revoke all on public.gratitude_posts,public.gratitude_comments,public.gratitude_reports from anon, authenticated;
grant select on public.gratitude_posts,public.gratitude_comments to anon,authenticated;
grant insert,delete on public.gratitude_posts,public.gratitude_comments to authenticated;
grant insert,select,delete on public.gratitude_reports to authenticated;
create policy "Read gratitude" on public.gratitude_posts for select to anon,authenticated using(true);
create policy "Post as yourself" on public.gratitude_posts for insert to authenticated with check(user_id=auth.uid());
create policy "Delete own or moderate" on public.gratitude_posts for delete to authenticated using(user_id=auth.uid() or gratitude_private.is_admin());
create policy "Read comments" on public.gratitude_comments for select to anon,authenticated using(true);
create policy "Comment as yourself" on public.gratitude_comments for insert to authenticated with check(user_id=auth.uid());
create policy "Delete own comment or moderate" on public.gratitude_comments for delete to authenticated using(user_id=auth.uid() or gratitude_private.is_admin());
create policy "Submit reports" on public.gratitude_reports for insert to authenticated with check(reporter=auth.uid() and (comment_id is null or exists(select 1 from public.gratitude_comments c where c.id=comment_id and c.post_id=gratitude_reports.post_id)));
create policy "Moderators read reports" on public.gratitude_reports for select to authenticated using(gratitude_private.is_admin());
create policy "Moderators resolve reports" on public.gratitude_reports for delete to authenticated using(gratitude_private.is_admin());

-- Server-controlled timestamps and per-account burst limits, including direct API calls.
create function gratitude_private.limit_writes() returns trigger language plpgsql security definer set search_path = '' as $$
declare recent_count integer;
begin
 if auth.uid() is null then raise exception 'Sign in to participate.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 new.created_at := now();
 if tg_table_name='gratitude_posts' then
   select count(*) into recent_count from public.gratitude_posts where user_id=auth.uid() and created_at>now()-interval '1 hour';
   if recent_count>=10 then raise exception 'Please pause before sharing more posts.'; end if;
 elsif tg_table_name='gratitude_comments' then
   select count(*) into recent_count from public.gratitude_comments where user_id=auth.uid() and created_at>now()-interval '1 hour';
   if recent_count>=30 then raise exception 'Please pause before adding more comments.'; end if;
 else
   select count(*) into recent_count from public.gratitude_reports where reporter=auth.uid() and created_at>now()-interval '1 hour';
   if recent_count>=20 then raise exception 'Please pause before sending more reports.'; end if;
 end if;
 return new;
end;
$$;
revoke all on function gratitude_private.limit_writes() from public;
create trigger gratitude_post_limit before insert on public.gratitude_posts for each row execute function gratitude_private.limit_writes();
create trigger gratitude_comment_limit before insert on public.gratitude_comments for each row execute function gratitude_private.limit_writes();
create trigger gratitude_report_limit before insert on public.gratitude_reports for each row execute function gratitude_private.limit_writes();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('gratitude-photos','gratitude-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy "Upload own gratitude photo" on storage.objects for insert to authenticated with check(bucket_id='gratitude-photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Read posted gratitude photos" on storage.objects for select to anon,authenticated using(bucket_id='gratitude-photos' and (exists(select 1 from public.gratitude_posts p where p.image_path=name) or (storage.foldername(name))[1]=auth.uid()::text or gratitude_private.is_admin()));
create policy "Delete own gratitude photos or moderate" on storage.objects for delete to authenticated using(bucket_id='gratitude-photos' and ((storage.foldername(name))[1]=auth.uid()::text or gratitude_private.is_admin()));
create function public.gratitude_is_admin() returns boolean language sql stable security invoker set search_path = '' as $$ select gratitude_private.is_admin(); $$;
revoke all on function public.gratitude_is_admin() from public;
grant execute on function public.gratitude_is_admin() to anon, authenticated;
create index gratitude_posts_user_date on public.gratitude_posts(user_id,created_at);
create index gratitude_comments_user_date on public.gratitude_comments(user_id,created_at);
create index gratitude_reports_reporter_date on public.gratitude_reports(reporter,created_at);
create index gratitude_reports_post on public.gratitude_reports(post_id);
create index gratitude_reports_comment on public.gratitude_reports(comment_id);
commit;

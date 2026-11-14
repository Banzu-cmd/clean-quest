-- =====================================================================
-- 追加分 v0.2: 「その場で捨てた」1枚報告(F-11) と SNS機能(F-12)
-- すでに schema.sql を実行済みのプロジェクトで、SQL Editor に貼って1回だけ実行する。
-- (新しいプロジェクトでは schema.sql → この順で実行する)
-- ※ settings の値は src/config.ts と同じにしておくこと。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 「その場で捨てた」1枚報告: collected 報告の one_shot フラグ
--    (type は 'collected' のまま。ランキングや週間クエストにもそのまま数えられる)
-- ---------------------------------------------------------------------
alter table public.reports add column if not exists one_shot boolean not null default false;

insert into public.settings (key, value) values
  ('points_oneshot', '40'), ('xp_oneshot', '40'), ('coins_oneshot', '20'),
  ('post_daily_cap', '5'), ('comment_daily_cap', '30'),
  ('min_seconds_between_posts', '20'),
  ('content_auto_hide_flag_count', '3'),
  ('event_max_days_ahead', '90')
on conflict (key) do nothing;

create or replace function public.reports_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_profile  public.profiles%rowtype;
  v_parent   public.reports%rowtype;
  v_allowed  text[] := array['プラスチック','漁具・ロープ','ペットボトル・缶','吸い殻','流木・自然物','大型ごみ','危険物','その他'];
  v_today    timestamptz;
  v_count    int;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_profile from public.profiles where id = new.user_id;
  if not found or v_profile.is_suspended then raise exception 'SUSPENDED'; end if;
  if v_profile.terms_accepted_at is null then raise exception 'TERMS_REQUIRED'; end if;

  new.status := 'pending';
  new.hidden := false;
  new.is_collected := false;
  new.reject_reason := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.risk_flags := '{}';
  new.created_at := now();

  if new.one_shot and new.type <> 'collected' then raise exception 'INVALID_TYPE'; end if;

  if exists (select 1 from unnest(new.trash_tags) t where t <> all (v_allowed)) then
    raise exception 'INVALID_TAG';
  end if;

  v_today := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  select count(*) into v_count from public.reports
   where user_id = new.user_id and created_at >= v_today;
  if v_count >= public.setting_num('daily_report_cap', 5) then raise exception 'DAILY_CAP'; end if;

  if exists (select 1 from public.reports
              where user_id = new.user_id
                and created_at > now() - make_interval(secs => public.setting_num('min_seconds_between_reports', 10)::int)) then
    raise exception 'RATE_LIMIT';
  end if;

  if new.type = 'found' then
    if coalesce(array_length(new.trash_tags, 1), 0) = 0 then raise exception 'TAG_REQUIRED'; end if;
    new.parent_report_id := null;
    new.disposed_confirmed := false;
  else
    if not new.disposed_confirmed then raise exception 'DISPOSAL_CONFIRM_REQUIRED'; end if;
    if '危険物' = any (new.trash_tags) then raise exception 'HAZARD_NOT_COLLECTIBLE'; end if;
    if new.one_shot then
      -- 1枚報告は、種類タグが必須で、発見報告には紐づけない
      if coalesce(array_length(new.trash_tags, 1), 0) = 0 then raise exception 'TAG_REQUIRED'; end if;
      new.parent_report_id := null;
    end if;
    if new.parent_report_id is not null then
      select * into v_parent from public.reports where id = new.parent_report_id;
      if not found or v_parent.type <> 'found' or v_parent.status <> 'approved' or v_parent.hidden then
        raise exception 'INVALID_PARENT';
      end if;
      if '危険物' = any (v_parent.trash_tags) then raise exception 'HAZARD_NOT_COLLECTIBLE'; end if;
      if v_parent.is_collected then raise exception 'ALREADY_COLLECTED'; end if;
      if public.haversine_m(v_parent.lat, v_parent.lng, new.lat, new.lng) > public.setting_num('collect_link_m', 50) then
        raise exception 'PARENT_TOO_FAR';
      end if;
    end if;
  end if;

  if exists (select 1 from public.reports r where r.photo_hash = new.photo_hash) then
    new.risk_flags := array_append(new.risk_flags, 'duplicate_photo');
  end if;
  if new.accuracy_m is not null and new.accuracy_m > public.setting_num('accuracy_warn_m', 100) then
    new.risk_flags := array_append(new.risk_flags, 'low_accuracy');
  end if;

  if exists (select 1 from public.reports r
              where r.user_id = new.user_id and r.type = new.type and r.status <> 'rejected'
                and r.created_at > now() - make_interval(hours => public.setting_num('near_duplicate_hours', 24)::int)
                and public.haversine_m(r.lat, r.lng, new.lat, new.lng) <= public.setting_num('near_duplicate_m', 20)) then
    new.status := 'rejected';
    new.reject_reason := '同じ場所で短時間に同種の報告があるため、自動的に対象外になりました';
    new.reviewed_at := now();
  end if;

  return new;
end $$;

create or replace function public.review_report(p_report_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
  v_points int; v_xp int; v_coins int; v_label text;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  select * into r from public.reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;

  if not p_approve then
    if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
    update public.reports
       set status = 'rejected', reject_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
     where id = r.id;
    return jsonb_build_object('status', 'rejected');
  end if;

  if r.one_shot then
    v_points := public.setting_num('points_oneshot', 40)::int;
    v_xp     := public.setting_num('xp_oneshot', 40)::int;
    v_coins  := public.setting_num('coins_oneshot', 20)::int;
    v_label  := 'その場で捨てた報告が承認されました';
  elsif r.type = 'found' then
    v_points := public.setting_num('points_found', 10)::int;
    v_xp     := public.setting_num('xp_found', 10)::int;
    v_coins  := public.setting_num('coins_found', 5)::int;
    v_label  := 'ごみ発見の報告が承認されました';
  else
    v_points := public.setting_num('points_collected', 30)::int;
    v_xp     := public.setting_num('xp_collected', 30)::int;
    v_coins  := public.setting_num('coins_collected', 15)::int;
    v_label  := 'ごみ回収の報告が承認されました';
  end if;

  update public.reports
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
   where id = r.id;

  if r.type = 'collected' and r.parent_report_id is not null then
    update public.reports set is_collected = true where id = r.parent_report_id;
  end if;

  insert into public.point_ledger (user_id, report_id, delta, reason) values (r.user_id, r.id, v_points, v_label);

  update public.user_progress
     set xp = xp + v_xp,
         coins = coins + v_coins,
         level = public.level_for_xp(xp + v_xp),
         updated_at = now()
   where user_id = r.user_id;

  perform public.award_badges(r.user_id);
  return jsonb_build_object('status', 'approved', 'points', v_points, 'xp', v_xp, 'coins', v_coins);
end $$;

create or replace function public.admin_revoke_report(p_report_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
  v_points int; v_xp int; v_coins int;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into r from public.reports where id = p_report_id for update;
  if not found or r.status <> 'approved' then raise exception 'NOT_APPROVED'; end if;

  select delta into v_points from public.point_ledger
   where report_id = r.id and delta > 0 order by created_at limit 1;
  v_points := coalesce(v_points, 0);
  if r.one_shot then
    v_xp := public.setting_num('xp_oneshot', 40)::int;    v_coins := public.setting_num('coins_oneshot', 20)::int;
  elsif r.type = 'found' then
    v_xp := public.setting_num('xp_found', 10)::int;      v_coins := public.setting_num('coins_found', 5)::int;
  else
    v_xp := public.setting_num('xp_collected', 30)::int;  v_coins := public.setting_num('coins_collected', 15)::int;
  end if;

  update public.reports
     set status = 'rejected', reject_reason = '承認取り消し: ' || p_reason,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = r.id;

  if r.type = 'collected' and r.parent_report_id is not null then
    update public.reports set is_collected = false where id = r.parent_report_id;
  end if;

  if v_points > 0 then
    insert into public.point_ledger (user_id, report_id, delta, reason)
    values (r.user_id, r.id, -v_points, '承認が取り消されました');
  end if;
  update public.user_progress
     set xp = greatest(xp - v_xp, 0),
         coins = greatest(coins - v_coins, 0),
         level = public.level_for_xp(greatest(xp - v_xp, 0)),
         updated_at = now()
   where user_id = r.user_id;
end $$;

-- ---------------------------------------------------------------------
-- 1b. 修正: SQL Editor(管理者の手動操作)から role を変更できるようにする
--     アプリ経由(anon / authenticated)の変更だけを、管理者以外は禁止する
-- ---------------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.is_suspended is distinct from old.is_suspended)
     and current_user in ('anon', 'authenticated')
     and not public.is_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. SNS: 募集(event)と発信(alert)、参加表明、いいね、コメント、通報
--    すべて RLS で直接アクセスを禁止し、関数(RPC)経由でのみ読み書きする
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('event', 'alert')),
  title      text not null check (char_length(title) between 1 and 60),
  body       text not null default '' check (char_length(body) <= 500),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  place_name text check (char_length(place_name) <= 60),
  starts_at  timestamptz,
  capacity   int check (capacity is null or capacity between 2 and 200),
  photo_path text,
  canceled   boolean not null default false,
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  check (kind <> 'event' or starts_at is not null),
  check (kind <> 'alert' or photo_path is not null)
);
create index if not exists posts_kind_idx  on public.posts (kind, created_at desc);
create index if not exists posts_start_idx on public.posts (starts_at);

create table if not exists public.post_participants (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 300),
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

create table if not exists public.content_flags (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   uuid not null,
  reason      text not null default '',
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

alter table public.posts             enable row level security;
alter table public.post_participants enable row level security;
alter table public.post_likes        enable row level security;
alter table public.post_comments     enable row level security;
alter table public.content_flags     enable row level security;
-- ポリシーは作らない = 直接の読み書きは全面禁止。下の関数だけが入口。

-- 利用者の状態チェック(内部関数)
create or replace function public.social_guard()
returns void language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  select * into p from public.profiles where id = auth.uid();
  if not found or p.is_suspended then raise exception 'SUSPENDED'; end if;
  if p.terms_accepted_at is null then raise exception 'TERMS_REQUIRED'; end if;
end $$;

create or replace function public.create_post(
  p_kind text, p_title text, p_body text, p_lat double precision, p_lng double precision,
  p_place text, p_starts_at timestamptz, p_capacity int, p_photo_path text, p_safety_ack boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_today timestamptz; v_count int;
begin
  perform public.social_guard();
  if not coalesce(p_safety_ack, false) then raise exception 'SAFETY_ACK_REQUIRED'; end if;
  if p_kind not in ('event', 'alert') then raise exception 'INVALID_KIND'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'TITLE_REQUIRED'; end if;

  if p_kind = 'event' then
    if p_starts_at is null or p_starts_at <= now() then raise exception 'EVENT_IN_PAST'; end if;
    if p_starts_at > now() + make_interval(days => public.setting_num('event_max_days_ahead', 90)::int) then
      raise exception 'EVENT_TOO_FAR';
    end if;
  else
    p_starts_at := null; p_capacity := null;
    if p_photo_path is null then raise exception 'PHOTO_REQUIRED'; end if;
  end if;
  if p_photo_path is not null and left(p_photo_path, length(auth.uid()::text) + 1) <> auth.uid()::text || '/' then
    raise exception 'INVALID_PHOTO';
  end if;

  v_today := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  select count(*) into v_count from public.posts where user_id = auth.uid() and created_at >= v_today;
  if v_count >= public.setting_num('post_daily_cap', 5) then raise exception 'POST_DAILY_CAP'; end if;
  if exists (select 1 from public.posts where user_id = auth.uid()
              and created_at > now() - make_interval(secs => public.setting_num('min_seconds_between_posts', 20)::int)) then
    raise exception 'RATE_LIMIT';
  end if;

  insert into public.posts (user_id, kind, title, body, lat, lng, place_name, starts_at, capacity, photo_path)
  values (auth.uid(), p_kind, trim(p_title), coalesce(p_body, ''), p_lat, p_lng,
          nullif(trim(coalesce(p_place, '')), ''), p_starts_at, p_capacity, p_photo_path)
  returning id into v_id;

  if p_kind = 'event' then
    insert into public.post_participants (post_id, user_id) values (v_id, auth.uid());  -- 主催者は最初から参加
  end if;
  return v_id;
end $$;

create or replace function public.join_event(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.posts%rowtype; v_n int;
begin
  perform public.social_guard();
  select * into p from public.posts where id = p_post for update;
  if not found or p.kind <> 'event' or p.hidden then raise exception 'NOT_FOUND'; end if;
  if p.canceled or p.starts_at <= now() then raise exception 'EVENT_ENDED'; end if;
  if exists (select 1 from public.post_participants where post_id = p_post and user_id = auth.uid()) then return; end if;
  select count(*) into v_n from public.post_participants where post_id = p_post;
  if p.capacity is not null and v_n >= p.capacity then raise exception 'EVENT_FULL'; end if;
  insert into public.post_participants (post_id, user_id) values (p_post, auth.uid());
end $$;

create or replace function public.leave_event(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  perform public.social_guard();
  select user_id into v_owner from public.posts where id = p_post;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_owner = auth.uid() then raise exception 'ORGANIZER_CANNOT_LEAVE'; end if;
  delete from public.post_participants where post_id = p_post and user_id = auth.uid();
end $$;

create or replace function public.toggle_like(p_post uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.social_guard();
  if not exists (select 1 from public.posts where id = p_post and not hidden) then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.post_likes where post_id = p_post and user_id = auth.uid()) then
    delete from public.post_likes where post_id = p_post and user_id = auth.uid();
    return false;
  end if;
  insert into public.post_likes (post_id, user_id) values (p_post, auth.uid());
  return true;
end $$;

create or replace function public.add_comment(p_post uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_today timestamptz; v_count int; v_body text := trim(coalesce(p_body, ''));
begin
  perform public.social_guard();
  if char_length(v_body) < 1 or char_length(v_body) > 300 then raise exception 'COMMENT_INVALID'; end if;
  if not exists (select 1 from public.posts where id = p_post and not hidden) then raise exception 'NOT_FOUND'; end if;
  v_today := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  select count(*) into v_count from public.post_comments where user_id = auth.uid() and created_at >= v_today;
  if v_count >= public.setting_num('comment_daily_cap', 30) then raise exception 'COMMENT_DAILY_CAP'; end if;
  if exists (select 1 from public.post_comments where user_id = auth.uid() and created_at > now() - interval '3 seconds') then
    raise exception 'RATE_LIMIT';
  end if;
  insert into public.post_comments (post_id, user_id, body) values (p_post, auth.uid(), v_body) returning id into v_id;
  return v_id;
end $$;

-- 自分の投稿を取り下げる。募集は「中止」にして参加者に分かるようにし、発信は削除する
create or replace function public.remove_my_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.posts%rowtype;
begin
  perform public.social_guard();
  select * into p from public.posts where id = p_post and user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.kind = 'event' then update public.posts set canceled = true where id = p.id;
  else delete from public.posts where id = p.id;
  end if;
end $$;

create or replace function public.delete_my_comment(p_comment uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  delete from public.post_comments where id = p_comment and user_id = auth.uid();
end $$;

-- 一覧(募集は開催が近い順、発信は新しい順)。ブロックした相手と非表示の投稿は除く
create or replace function public.list_posts(p_kind text default null, p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  select coalesce(jsonb_agg(t.obj order by t.sortkey), '[]'::jsonb) into v from (
    select
      jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'author_id', p.user_id, 'author_name', pr.display_name,
        'title', p.title, 'body', p.body, 'lat', p.lat, 'lng', p.lng, 'place_name', p.place_name,
        'starts_at', p.starts_at, 'capacity', p.capacity, 'photo_path', p.photo_path,
        'canceled', p.canceled, 'created_at', p.created_at,
        'like_count', (select count(*) from public.post_likes l where l.post_id = p.id),
        'comment_count', (select count(*) from public.post_comments c where c.post_id = p.id and not c.hidden),
        'participant_count', (select count(*) from public.post_participants pp where pp.post_id = p.id),
        'liked', exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid()),
        'joined', exists (select 1 from public.post_participants pp where pp.post_id = p.id and pp.user_id = auth.uid()),
        'is_mine', p.user_id = auth.uid()
      ) as obj,
      case when p.kind = 'event' then extract(epoch from p.starts_at)
           else -extract(epoch from p.created_at) end as sortkey
    from public.posts p
    join public.profiles pr on pr.id = p.user_id
    where not p.hidden
      and (p_id is null or p.id = p_id)
      and (p_kind is null or p.kind = p_kind)
      and not exists (select 1 from public.user_blocks b where b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
      and (p_id is not null or p.kind <> 'event' or p.starts_at >= now() - interval '1 day')
    order by sortkey
    limit 100
  ) t;
  return v;
end $$;

create or replace function public.list_comments(p_post uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  select coalesce(jsonb_agg(t.obj order by t.created_at), '[]'::jsonb) into v from (
    select
      jsonb_build_object('id', c.id, 'post_id', c.post_id, 'author_id', c.user_id, 'author_name', pr.display_name,
                         'body', c.body, 'created_at', c.created_at, 'is_mine', c.user_id = auth.uid()) as obj,
      c.created_at
    from public.post_comments c
    join public.profiles pr on pr.id = c.user_id
    where c.post_id = p_post and not c.hidden
      and not exists (select 1 from public.user_blocks b where b.blocker_id = auth.uid() and b.blocked_id = c.user_id)
    order by c.created_at
    limit 200
  ) t;
  return v;
end $$;

-- 通報。別々の3人(設定値)から通報されると自動的に非表示にする
create or replace function public.flag_content(p_type text, p_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_count int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  if p_type = 'post' then select user_id into v_owner from public.posts where id = p_id;
  elsif p_type = 'comment' then select user_id into v_owner from public.post_comments where id = p_id;
  else raise exception 'INVALID_KIND';
  end if;
  if v_owner is null then raise exception 'NOT_FOUND'; end if;
  if v_owner = auth.uid() then raise exception 'OWN_REPORT'; end if;
  insert into public.content_flags (reporter_id, target_type, target_id, reason)
  values (auth.uid(), p_type, p_id, left(coalesce(p_reason, ''), 200))
  on conflict do nothing;
  select count(distinct reporter_id) into v_count from public.content_flags
   where target_type = p_type and target_id = p_id and status = 'open';
  if v_count >= public.setting_num('content_auto_hide_flag_count', 3) then
    if p_type = 'post' then update public.posts set hidden = true where id = p_id;
    else update public.post_comments set hidden = true where id = p_id;
    end if;
  end if;
end $$;

-- 管理者: 未対応の通報(投稿・コメント)
create or replace function public.admin_content_flags()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  select coalesce(jsonb_agg(t.obj order by t.created_at), '[]'::jsonb) into v from (
    select
      jsonb_build_object(
        'id', f.id, 'target_type', f.target_type, 'target_id', f.target_id, 'reason', f.reason, 'created_at', f.created_at,
        'hidden', coalesce(p.hidden, c.hidden),
        'author_name', coalesce(pp.display_name, cp.display_name),
        'title', p.title, 'kind', p.kind,
        'body', coalesce(p.body, c.body),
        'photo_path', p.photo_path
      ) as obj, f.created_at
    from public.content_flags f
    left join public.posts p on f.target_type = 'post' and p.id = f.target_id
    left join public.profiles pp on pp.id = p.user_id
    left join public.post_comments c on f.target_type = 'comment' and c.id = f.target_id
    left join public.profiles cp on cp.id = c.user_id
    where f.status = 'open'
    order by f.created_at
    limit 100
  ) t;
  return v;
end $$;

create or replace function public.admin_resolve_content_flag(p_flag bigint, p_hide boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare f public.content_flags%rowtype;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  update public.content_flags set status = 'resolved' where id = p_flag returning * into f;
  if p_hide and f.id is not null then
    if f.target_type = 'post' then update public.posts set hidden = true where id = f.target_id;
    else update public.post_comments set hidden = true where id = f.target_id;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. 関数の実行権限
-- ---------------------------------------------------------------------
revoke execute on function public.social_guard() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'create_post(text,text,text,double precision,double precision,text,timestamptz,int,text,boolean)',
    'join_event(uuid)', 'leave_event(uuid)', 'toggle_like(uuid)', 'add_comment(uuid,text)',
    'remove_my_post(uuid)', 'delete_my_comment(uuid)', 'list_posts(text,uuid)', 'list_comments(uuid)',
    'flag_content(text,uuid,text)', 'admin_content_flags()', 'admin_resolve_content_flag(bigint,boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

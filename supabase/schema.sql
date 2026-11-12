-- =====================================================================
-- クリーンクエスト(仮称) DBスキーマ v0.1
-- Supabase の「SQL Editor」に貼り付け、新しいプロジェクトで1回だけ実行する。
-- 要件定義書の 6〜8章 / F-01〜F-10 に対応。
-- ※ settings の値は src/config.ts の RULES / POINTS / XP / COINS と同じ値にしておくこと。
-- =====================================================================

create extension if not exists pgcrypto;

create type public.report_type   as enum ('found', 'collected');
create type public.report_status as enum ('pending', 'approved', 'rejected');
create type public.user_role     as enum ('user', 'admin');

-- ---------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text not null check (char_length(display_name) between 1 and 20),
  role              public.user_role not null default 'user',
  is_suspended      boolean not null default false,
  show_in_ranking   boolean not null default true,
  terms_accepted_at timestamptz,
  created_at        timestamptz not null default now()
);

create table public.settings (
  key   text primary key,
  value jsonb not null
);

create table public.reports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  type               public.report_type not null,
  status             public.report_status not null default 'pending',
  lat                double precision not null check (lat between -90 and 90),
  lng                double precision not null check (lng between -180 and 180),
  accuracy_m         double precision,
  photo_path         text not null,
  photo_hash         text not null,
  trash_tags         text[] not null default '{}',
  note               text check (char_length(note) <= 200),
  parent_report_id   uuid references public.reports (id) on delete set null,
  disposed_confirmed boolean not null default false,
  is_collected       boolean not null default false,   -- found が回収済みになったか
  hidden             boolean not null default false,   -- 通報・管理者により非表示
  risk_flags         text[] not null default '{}',     -- duplicate_photo / low_accuracy
  reject_reason      text,
  reviewed_by        uuid references public.profiles (id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index reports_status_idx   on public.reports (status, type);
create index reports_user_idx     on public.reports (user_id, created_at desc);
create index reports_hash_idx     on public.reports (photo_hash);
create index reports_geo_idx      on public.reports (lat, lng);

create table public.point_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  report_id  uuid references public.reports (id) on delete set null,
  delta      int not null,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index point_ledger_user_idx on public.point_ledger (user_id, created_at desc);

create table public.user_progress (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  xp         int not null default 0 check (xp >= 0),
  level      int not null default 1,
  coins      int not null default 0 check (coins >= 0),
  updated_at timestamptz not null default now()
);

create table public.badges (
  key         text primary key,
  name        text not null,
  description text not null,
  emoji       text not null,
  sort        int not null default 0
);
create table public.user_badges (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  badge_key  text not null references public.badges (key),
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_key)
);

create table public.items (
  key   text primary key,
  name  text not null,
  emoji text not null,
  price int  not null check (price >= 0),
  sort  int  not null default 0
);
create table public.user_items (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  item_key  text not null references public.items (key),
  slot      int  not null check (slot between 0 and 11),
  placed_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create table public.quests (
  key          text primary key,
  title        text not null,
  metric       text not null check (metric in ('found', 'collected', 'total')),
  target       int  not null check (target > 0),
  reward_coins int  not null default 0,
  sort         int  not null default 0
);
create table public.quest_claims (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  quest_key  text not null references public.quests (key),
  week_start date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, quest_key, week_start)
);

create table public.report_flags (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  report_id   uuid not null references public.reports (id) on delete cascade,
  reason      text not null default '',
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  unique (reporter_id, report_id)
);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.events (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  client_id  text not null,
  name       text not null check (name in ('visit', 'open_report', 'open_collect')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ヘルパー関数
-- ---------------------------------------------------------------------
create or replace function public.setting_num(k text, d numeric)
returns numeric language sql stable as $$
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = k), d);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.haversine_m(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- xpForLevel(l) = 25 * l * (l - 1) の逆算 (src/config.ts の levelForXp と同じ)
create or replace function public.level_for_xp(p_xp int)
returns int language sql immutable as $$
  select floor((1 + sqrt(1 + 4 * (p_xp / 25.0))) / 2)::int;
$$;

create or replace function public.week_start_jst()
returns date language sql stable as $$
  select date_trunc('week', now() at time zone 'Asia/Tokyo')::date;
$$;

-- ---------------------------------------------------------------------
-- 新規ユーザー作成時にプロフィールと進捗を作る
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'ユーザー'), 20));
  insert into public.user_progress (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 一般ユーザーが role / is_suspended を書き換えられないようにする
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.is_suspended is distinct from old.is_suspended)
     and not public.is_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger profiles_guard_trg
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------
-- 報告の投稿時チェック(不正対策・F-02/F-04・8章)
-- ---------------------------------------------------------------------
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

  -- クライアントから指定させない項目を強制する
  new.status := 'pending';
  new.hidden := false;
  new.is_collected := false;
  new.reject_reason := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.risk_flags := '{}';
  new.created_at := now();

  if exists (select 1 from unnest(new.trash_tags) t where t <> all (v_allowed)) then
    raise exception 'INVALID_TAG';
  end if;

  -- 1日の上限(日本時間の日付で数える。自動で対象外になった報告も数える)
  v_today := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  select count(*) into v_count from public.reports
   where user_id = new.user_id and created_at >= v_today;
  if v_count >= public.setting_num('daily_report_cap', 5) then raise exception 'DAILY_CAP'; end if;

  -- 連続投稿の制限
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

  -- リスクフラグ(管理者の画面に表示する)
  if exists (select 1 from public.reports r where r.photo_hash = new.photo_hash) then
    new.risk_flags := array_append(new.risk_flags, 'duplicate_photo');
  end if;
  if new.accuracy_m is not null and new.accuracy_m > public.setting_num('accuracy_warn_m', 100) then
    new.risk_flags := array_append(new.risk_flags, 'low_accuracy');
  end if;

  -- 同一ユーザー・同種・近く・期間内の重複は自動的に対象外にする
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

create trigger reports_before_insert_trg
  before insert on public.reports
  for each row execute function public.reports_before_insert();

-- ---------------------------------------------------------------------
-- バッジ付与(内部関数)
-- ---------------------------------------------------------------------
create or replace function public.award_badges(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_found int; v_col int; v_total int; v_rej int; v_spots int;
begin
  select count(*) filter (where type = 'found' and status = 'approved'),
         count(*) filter (where type = 'collected' and status = 'approved'),
         count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'rejected')
    into v_found, v_col, v_total, v_rej
    from public.reports where user_id = p_user;

  select count(*) into v_spots from (
    select distinct round(lat::numeric, 3), round(lng::numeric, 3)
      from public.reports where user_id = p_user and type = 'found' and status = 'approved') s;

  if v_found >= 1 then insert into public.user_badges (user_id, badge_key) values (p_user, 'first_found') on conflict do nothing; end if;
  if v_col   >= 1 then insert into public.user_badges (user_id, badge_key) values (p_user, 'first_collected') on conflict do nothing; end if;
  if v_spots >= 3 then insert into public.user_badges (user_id, badge_key) values (p_user, 'explorer') on conflict do nothing; end if;
  if v_total >= 10 and v_rej = 0 then insert into public.user_badges (user_id, badge_key) values (p_user, 'careful') on conflict do nothing; end if;
end $$;

-- ---------------------------------------------------------------------
-- 承認・却下・取り消し (管理者)
-- ---------------------------------------------------------------------
create or replace function public.review_report(p_report_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
  v_points int; v_xp int; v_coins int;
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

  if r.type = 'found' then
    v_points := public.setting_num('points_found', 10)::int;
    v_xp     := public.setting_num('xp_found', 10)::int;
    v_coins  := public.setting_num('coins_found', 5)::int;
  else
    v_points := public.setting_num('points_collected', 30)::int;
    v_xp     := public.setting_num('xp_collected', 30)::int;
    v_coins  := public.setting_num('coins_collected', 15)::int;
  end if;

  update public.reports
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
   where id = r.id;

  if r.type = 'collected' and r.parent_report_id is not null then
    update public.reports set is_collected = true where id = r.parent_report_id;
  end if;

  insert into public.point_ledger (user_id, report_id, delta, reason)
  values (r.user_id, r.id, v_points,
          case r.type when 'found' then 'ごみ発見の報告が承認されました' else 'ごみ回収の報告が承認されました' end);

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
  if r.type = 'found' then
    v_xp := public.setting_num('xp_found', 10)::int;   v_coins := public.setting_num('coins_found', 5)::int;
  else
    v_xp := public.setting_num('xp_collected', 30)::int; v_coins := public.setting_num('coins_collected', 15)::int;
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

create or replace function public.admin_set_hidden(p_report_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  update public.reports set hidden = p_hidden where id = p_report_id;
end $$;

create or replace function public.admin_resolve_flag(p_flag_id bigint, p_hide boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_report uuid;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  update public.report_flags set status = 'resolved' where id = p_flag_id returning report_id into v_report;
  if p_hide and v_report is not null then
    update public.reports set hidden = true where id = v_report;
  end if;
end $$;

create or replace function public.admin_suspend_user(p_user uuid, p_suspend boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  update public.profiles set is_suspended = p_suspend where id = p_user and role <> 'admin';
end $$;

create or replace function public.admin_adjust_points(p_user uuid, p_delta int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  insert into public.point_ledger (user_id, delta, reason) values (p_user, p_delta, '運営による調整: ' || p_reason);
end $$;

create or replace function public.admin_metrics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  return jsonb_build_object(
    'visits',        (select count(distinct client_id) from public.events where name = 'visit'),
    'signups',       (select count(*) from public.profiles where role = 'user'),
    'first_report',  (select count(distinct user_id) from public.reports),
    'repeat_users',  (select count(*) from (select user_id from public.reports group by user_id having count(*) >= 2) s),
    'retained_7d',   (select count(distinct r.user_id) from public.reports r
                        join public.profiles p on p.id = r.user_id
                       where r.created_at >= p.created_at + interval '7 days'),
    'weekly_active', (select count(distinct user_id) from public.reports where created_at > now() - interval '7 days'),
    'reports_total', (select count(*) from public.reports),
    'pending',       (select count(*) from public.reports where status = 'pending'),
    'approved',      (select count(*) from public.reports where status = 'approved'),
    'rejected',      (select count(*) from public.reports where status = 'rejected'),
    'avg_review_hours', (select round((avg(extract(epoch from (reviewed_at - created_at))) / 3600)::numeric, 1)
                           from public.reports where reviewed_by is not null),
    'open_flags',    (select count(*) from public.report_flags where status = 'open')
  );
end $$;

-- ---------------------------------------------------------------------
-- 一般ユーザー向け RPC
-- ---------------------------------------------------------------------
create or replace function public.accept_terms()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  update public.profiles set terms_accepted_at = coalesce(terms_accepted_at, now()) where id = auth.uid();
end $$;

create or replace function public.my_points()
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from public.point_ledger where user_id = auth.uid();
$$;

create or replace function public.flag_report(p_report_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_count int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  select user_id into v_owner from public.reports where id = p_report_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_owner = auth.uid() then raise exception 'OWN_REPORT'; end if;
  insert into public.report_flags (reporter_id, report_id, reason)
  values (auth.uid(), p_report_id, left(coalesce(p_reason, ''), 200))
  on conflict do nothing;
  select count(distinct reporter_id) into v_count from public.report_flags
   where report_id = p_report_id and status = 'open';
  if v_count >= public.setting_num('auto_hide_flag_count', 3) then
    update public.reports set hidden = true where id = p_report_id;
  end if;
end $$;

create or replace function public.block_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_user = auth.uid() then raise exception 'NOT_AUTHORIZED'; end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing;
end $$;

create or replace function public.unblock_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_user;
end $$;

create or replace function public.my_blocks()
returns table (user_id uuid, display_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.blocked_id, p.display_name, b.created_at
    from public.user_blocks b join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid() order by b.created_at desc;
$$;

create or replace function public.my_weekly_quests()
returns table (key text, title text, metric text, target int, reward_coins int, progress int, claimed boolean)
language sql stable security definer set search_path = public as $$
  with w as (
    select public.week_start_jst() as ws,
           (public.week_start_jst())::timestamp at time zone 'Asia/Tokyo' as since
  ), agg as (
    select (count(*) filter (where r.type = 'found'))::int     as f,
           (count(*) filter (where r.type = 'collected'))::int as c,
           count(*)::int                                       as t
      from public.reports r, w
     where r.user_id = auth.uid() and r.status = 'approved' and r.created_at >= w.since
  )
  select q.key, q.title, q.metric, q.target, q.reward_coins,
         least(case q.metric when 'found' then agg.f when 'collected' then agg.c else agg.t end, q.target),
         exists (select 1 from public.quest_claims qc, w
                  where qc.user_id = auth.uid() and qc.quest_key = q.key and qc.week_start = w.ws)
    from public.quests q, agg
   order by q.sort;
$$;

create or replace function public.claim_quest(p_key text)
returns int language plpgsql security definer set search_path = public as $$
declare v_row record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  select * into v_row from public.my_weekly_quests() q where q.key = p_key;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.claimed then raise exception 'ALREADY_CLAIMED'; end if;
  if v_row.progress < v_row.target then raise exception 'NOT_COMPLETED'; end if;
  insert into public.quest_claims (user_id, quest_key, week_start) values (auth.uid(), p_key, public.week_start_jst());
  update public.user_progress set coins = coins + v_row.reward_coins, updated_at = now() where user_id = auth.uid();
  return v_row.reward_coins;
end $$;

create or replace function public.buy_item(p_item_key text, p_slot int)
returns void language plpgsql security definer set search_path = public as $$
declare v_price int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  if p_slot < 0 or p_slot > 11 then raise exception 'INVALID_SLOT'; end if;
  select price into v_price from public.items where key = p_item_key;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.user_items where user_id = auth.uid() and slot = p_slot) then
    raise exception 'SLOT_TAKEN';
  end if;
  update public.user_progress set coins = coins - v_price, updated_at = now()
   where user_id = auth.uid() and coins >= v_price;
  if not found then raise exception 'NOT_ENOUGH_COINS'; end if;
  insert into public.user_items (user_id, item_key, slot) values (auth.uid(), p_item_key, p_slot);
end $$;

-- ランキング(F-08): 承認された回収報告の件数。参加者が一定数に達するまでは非表示
create or replace function public.ranking_base(p_since timestamptz)
returns table (user_id uuid, name text, cnt int, rnk int)
language sql stable security definer set search_path = public as $$
  with c as (
    select r.user_id, count(*)::int as cnt
      from public.reports r
     where r.type = 'collected' and r.status = 'approved' and r.created_at >= p_since
     group by r.user_id)
  select c.user_id, p.display_name, c.cnt, (rank() over (order by c.cnt desc))::int
    from c join public.profiles p on p.id = c.user_id
   where p.show_in_ranking and not p.is_suspended;
$$;

create or replace function public.get_ranking(p_period text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_users int; v_min int; v_since timestamptz; v_rows jsonb; v_me jsonb; v_opted_out boolean;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  select count(*) into v_users from public.profiles where role = 'user';
  v_min := public.setting_num('ranking_min_users', 30)::int;
  if v_users < v_min then
    return jsonb_build_object('enabled', false, 'users', v_users, 'min_users', v_min,
                              'rows', '[]'::jsonb, 'me', null, 'opted_out', false);
  end if;

  if p_period = 'week' then
    v_since := (public.week_start_jst())::timestamp at time zone 'Asia/Tokyo';
  else
    v_since := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('rank', rnk, 'name', name, 'count', cnt, 'is_me', user_id = auth.uid())
                            order by rnk, name), '[]'::jsonb)
    into v_rows
    from (select * from public.ranking_base(v_since) order by rnk, name limit 10) t;

  select jsonb_build_object('rank', rnk, 'count', cnt) into v_me
    from public.ranking_base(v_since) where user_id = auth.uid();

  select not show_in_ranking into v_opted_out from public.profiles where id = auth.uid();

  return jsonb_build_object('enabled', true, 'users', v_users, 'min_users', v_min,
                            'rows', v_rows, 'me', v_me, 'opted_out', coalesce(v_opted_out, false));
end $$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED'; end if;
  delete from auth.users where id = auth.uid();   -- profiles 以下は on delete cascade で削除される
end $$;

-- ---------------------------------------------------------------------
-- 関数の実行権限(内部関数は外から呼べないようにする)
-- ---------------------------------------------------------------------
revoke execute on function public.award_badges(uuid)              from public, anon, authenticated;
revoke execute on function public.ranking_base(timestamptz)       from public, anon, authenticated;
revoke execute on function public.reports_before_insert()         from public, anon, authenticated;
revoke execute on function public.handle_new_user()               from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'review_report(uuid,boolean,text)', 'admin_revoke_report(uuid,text)', 'admin_set_hidden(uuid,boolean)',
    'admin_resolve_flag(bigint,boolean)', 'admin_suspend_user(uuid,boolean)', 'admin_adjust_points(uuid,int,text)',
    'admin_metrics()', 'accept_terms()', 'my_points()', 'flag_report(uuid,text)', 'block_user(uuid)',
    'unblock_user(uuid)', 'my_blocks()', 'my_weekly_quests()', 'claim_quest(text)', 'buy_item(text,int)',
    'get_ranking(text)', 'delete_my_account()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.settings      enable row level security;
alter table public.reports       enable row level security;
alter table public.point_ledger  enable row level security;
alter table public.user_progress enable row level security;
alter table public.badges        enable row level security;
alter table public.user_badges   enable row level security;
alter table public.items         enable row level security;
alter table public.user_items    enable row level security;
alter table public.quests        enable row level security;
alter table public.quest_claims  enable row level security;
alter table public.report_flags  enable row level security;
alter table public.user_blocks   enable row level security;
alter table public.events        enable row level security;

-- profiles: 自分と管理者だけ読める。更新は自分の行のみ(role等はトリガーで保護)
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- マスターデータは誰でも読める
create policy settings_select on public.settings for select using (true);
create policy badges_select   on public.badges   for select using (true);
create policy items_select    on public.items    for select using (true);
create policy quests_select   on public.quests   for select using (true);

-- reports: 自分の報告・管理者・「承認済みで非表示でない発見報告(ブロックした相手を除く)」
create policy reports_select on public.reports for select using (
  user_id = auth.uid()
  or public.is_admin()
  or (status = 'approved' and hidden = false and type = 'found'
      and not exists (select 1 from public.user_blocks b
                       where b.blocker_id = auth.uid() and b.blocked_id = reports.user_id))
);
create policy reports_insert on public.reports for insert with check (user_id = auth.uid());
-- 更新・削除のポリシーは作らない(承認などは RPC 経由のみ)

create policy ledger_select   on public.point_ledger  for select using (user_id = auth.uid() or public.is_admin());
create policy progress_select on public.user_progress for select using (user_id = auth.uid() or public.is_admin());
create policy ubadges_select  on public.user_badges   for select using (user_id = auth.uid() or public.is_admin());
create policy uitems_select   on public.user_items    for select using (user_id = auth.uid() or public.is_admin());
create policy claims_select   on public.quest_claims  for select using (user_id = auth.uid() or public.is_admin());
create policy flags_select    on public.report_flags  for select using (public.is_admin());
create policy blocks_select   on public.user_blocks   for select using (blocker_id = auth.uid());

create policy events_insert on public.events for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
create policy events_select on public.events for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- 写真ストレージ (公開バケット。パスは推測できないUUID。EXIFはアプリ側で削除済み)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('report-photos', 'report-photos', true)
on conflict (id) do nothing;

create policy "report photos: read" on storage.objects for select
  using (bucket_id = 'report-photos');
create policy "report photos: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "report photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 初期データ
-- ---------------------------------------------------------------------
insert into public.settings (key, value) values
  ('points_found', '10'), ('points_collected', '30'),
  ('xp_found', '10'),     ('xp_collected', '30'),
  ('coins_found', '5'),   ('coins_collected', '15'),
  ('daily_report_cap', '5'),
  ('near_duplicate_m', '20'), ('near_duplicate_hours', '24'),
  ('collect_link_m', '50'),   ('accuracy_warn_m', '100'),
  ('min_seconds_between_reports', '10'),
  ('ranking_min_users', '30'),
  ('auto_hide_flag_count', '3');

insert into public.badges (key, name, description, emoji, sort) values
  ('first_found',     'はじめの一歩', '初めてごみを報告して承認された', '🔍', 1),
  ('first_collected', '拾い手',       '初めてごみを回収して承認された', '🧤', 2),
  ('explorer',        '探検家',       '3か所以上でごみを報告した',     '🧭', 3),
  ('careful',         'ていねい',     '却下なしで10件承認された',      '✨', 4);

insert into public.items (key, name, emoji, price, sort) values
  ('tree',     '木',       '🌳', 10, 1),
  ('flower',   '花',       '🌸', 15, 2),
  ('bench',    'ベンチ',   '🪑', 20, 3),
  ('lamp',     '街灯',     '💡', 25, 4),
  ('bird',     '小鳥',     '🐦', 30, 5),
  ('dog',      '犬',       '🐕', 40, 6),
  ('fountain', '噴水',     '⛲', 60, 7),
  ('cafe',     'カフェ',   '☕', 80, 8);

insert into public.quests (key, title, metric, target, reward_coins, sort) values
  ('q_found_2',   '今週2件、ごみを報告しよう',       'found',     2, 10, 1),
  ('q_collect_1', '今週1件、ごみを回収しよう',       'collected', 1, 20, 2),
  ('q_total_5',   '今週あわせて5件、報告か回収をしよう', 'total',  5, 30, 3);

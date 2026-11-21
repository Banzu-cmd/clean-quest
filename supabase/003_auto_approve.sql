-- =====================================================================
-- 追加分 v0.3: 報告の自動承認(信頼できるユーザー)と、抜き取り確認
-- 002_oneshot_social.sql を実行済みのプロジェクトで、SQL Editor に貼って1回だけ実行する。
-- (新しいプロジェクトでは schema.sql → 002 → この順で実行する)
--
-- 仕組み
--  B. 信頼できるユーザーの報告は、投稿の直後に自動で承認する
--     信頼できる = 運営が手動で承認した報告が trust_min_approved 件以上 かつ
--                 直近 trust_lookback_days 日に、運営による却下・承認取り消しがない
--     ただし、リスクフラグ(同じ写真・位置の誤差が大きい)が付いた報告は、自動承認せず審査待ちにする
--  A. 自動承認した報告のうち、
--       ・そのユーザーの最初の自動承認
--       ・audit_rate の割合で無作為に選んだもの
--     を「抜き取り確認」の対象にする。運営が後から確認し、問題があれば承認を取り消す
--     (取り消すと、そのユーザーは信頼できる状態から外れ、また手動審査に戻る)
-- ※ 抜き取りの対象かどうかは本人に見えない(RLS で運営専用の表にしている)
-- =====================================================================

insert into public.settings (key, value) values
  ('auto_approve_enabled', '1'),   -- 0 にすると自動承認を止める(全件を手動審査に戻す)
  ('trust_min_approved',   '3'),   -- 信頼できると見なすのに必要な、手動承認の件数
  ('trust_lookback_days',  '30'),  -- この日数の間に、運営による却下・取り消しがないこと
  ('audit_rate',           '0.2')  -- 自動承認のうち、抜き取り確認にする割合(0〜1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 抜き取り確認の対象(運営専用。RLS を有効にして、ポリシーは作らない)
-- ---------------------------------------------------------------------
create table if not exists public.report_audits (
  report_id  uuid primary key references public.reports (id) on delete cascade,
  result     text check (result in ('ok', 'ng')),
  audited_by uuid references public.profiles (id),
  audited_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.report_audits enable row level security;

-- ---------------------------------------------------------------------
-- 承認の本体(手動承認と自動承認で共通)。クライアントからは呼べない
-- p_reviewer が null のとき、自動承認として記録する(reviewed_by が null)
-- ---------------------------------------------------------------------
create or replace function public._approve_report(p_report_id uuid, p_reviewer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
  v_points int; v_xp int; v_coins int; v_label text;
begin
  select * into r from public.reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;

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
     set status = 'approved', reviewed_by = p_reviewer, reviewed_at = now()
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

-- 手動の審査(却下はここ、承認は共通の本体を呼ぶ)
create or replace function public.review_report(p_report_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
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

  return public._approve_report(r.id, auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- 信頼できるユーザーか
-- ---------------------------------------------------------------------
create or replace function public.is_trusted_reporter(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.reports
      where user_id = p_user and status = 'approved' and reviewed_by is not null)
      >= public.setting_num('trust_min_approved', 3)
    and not exists (
      select 1 from public.reports
       where user_id = p_user and status = 'rejected' and reviewed_by is not null
         and reviewed_at > now() - make_interval(days => public.setting_num('trust_lookback_days', 30)::int));
$$;

-- ---------------------------------------------------------------------
-- 投稿の直後に、条件を満たす報告を自動承認する
-- (BEFORE INSERT のチェックを通ったあとの行が対象。自動で対象外になった行は pending ではないので何もしない)
-- ---------------------------------------------------------------------
create or replace function public.reports_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_first boolean;
begin
  if new.status <> 'pending' then return new; end if;
  if public.setting_num('auto_approve_enabled', 1) < 1 then return new; end if;
  if coalesce(array_length(new.risk_flags, 1), 0) > 0 then return new; end if;
  if not public.is_trusted_reporter(new.user_id) then return new; end if;

  -- 最初の自動承認かどうかは、承認する前に調べる
  v_first := not exists (select 1 from public.reports r
                          where r.user_id = new.user_id and r.id <> new.id
                            and r.status = 'approved' and r.reviewed_by is null);

  perform public._approve_report(new.id, null);

  if v_first or random() < public.setting_num('audit_rate', 0.2) then
    insert into public.report_audits (report_id) values (new.id);
  end if;
  return new;
end $$;

drop trigger if exists reports_after_insert_trg on public.reports;
create trigger reports_after_insert_trg
  after insert on public.reports
  for each row execute function public.reports_after_insert();

-- ---------------------------------------------------------------------
-- 運営: 抜き取り確認
-- ---------------------------------------------------------------------
create or replace function public.admin_audit_ids()
returns uuid[] language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  return coalesce((select array_agg(a.report_id order by a.created_at)
                     from public.report_audits a where a.result is null), '{}');
end $$;

create or replace function public.admin_audit_report(p_report_id uuid, p_ok boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.report_audits%rowtype;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  select * into a from public.report_audits where report_id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.result is not null then raise exception 'ALREADY_REVIEWED'; end if;

  if not p_ok then
    if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
    -- 承認を取り消す(ポイントも戻る)。この取り消しで、そのユーザーは信頼できる状態から外れる
    perform public.admin_revoke_report(p_report_id, p_reason);
  end if;

  update public.report_audits
     set result = case when p_ok then 'ok' else 'ng' end, audited_by = auth.uid(), audited_at = now()
   where report_id = p_report_id;
end $$;

-- 指標に、自動承認と抜き取りの数を追加する
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
    'open_flags',    (select count(*) from public.report_flags where status = 'open'),
    'auto_approved', (select count(*) from public.reports
                       where status = 'approved' and reviewed_by is null and reviewed_at is not null)
                     + (select count(*) from public.report_audits where result = 'ng'),
    'audit_pending', (select count(*) from public.report_audits where result is null),
    'audit_ng',      (select count(*) from public.report_audits where result = 'ng')
  );
end $$;

-- ---------------------------------------------------------------------
-- 実行権限: 内部関数はクライアントから呼べない。運営用の RPC はログイン済みのみ
-- ---------------------------------------------------------------------
revoke execute on function public._approve_report(uuid, uuid)  from public, anon, authenticated;
revoke execute on function public.is_trusted_reporter(uuid)    from public, anon, authenticated;
revoke execute on function public.reports_after_insert()       from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'review_report(uuid,boolean,text)', 'admin_audit_ids()', 'admin_audit_report(uuid,boolean,text)', 'admin_metrics()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

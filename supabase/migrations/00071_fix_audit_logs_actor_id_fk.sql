-- audit_logs.actor_id の FK を外し、ユーザー削除が WORM 保護に阻まれない設計にする。
--
-- 背景:
--   - 00039 で audit_logs に WORM トリガー (UPDATE/DELETE を無条件 RAISE) を設定。
--   - audit_logs.actor_id は auth.users / user_profiles を ON DELETE SET NULL で参照
--     (00027 / 00035)。
--   - ユーザー削除時、FK の SET NULL が audit_logs を UPDATE しようとして WORM
--     トリガーに弾かれ、audit_logs に1行でも actor 行があるユーザーは
--     "Database error deleting user" で削除できなかった (活動した全ユーザーが該当)。
--   - さらに 00048 の hash chain は actor_id を含むため、actor_id を後から NULL 化
--     するとチェーン整合が壊れる。よって「SET NULL する」設計自体が不適切。
--
-- 方針:
--   audit_logs は append-only の監査記録であり、actor_id は「その時点で誰が操作したか」
--   という履歴上の事実。ユーザーが後に削除されても値を保持すべき。
--   そこで actor_id の FK 制約を撤去する (列・index・hash chain はそのまま維持)。
--   これによりユーザー削除は audit_logs に一切触れなくなり、WORM と両立する。
--
-- actor_id に張られている FK の名前は環境により異なる (00027 由来 / 00035 由来) ため、
-- 名前に依存せず actor_id を参照する FK を動的に全て drop する。
do $$
declare
  c text;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where con.contype = 'f'
      and n.nspname = 'public'
      and rel.relname = 'audit_logs'
      and exists (
        select 1
        from unnest(con.conkey) as k(attnum)
        join pg_attribute a
          on a.attrelid = con.conrelid and a.attnum = k.attnum
        where a.attname = 'actor_id'
      )
  loop
    execute format('alter table public.audit_logs drop constraint %I', c);
    raise notice 'dropped FK on audit_logs.actor_id: %', c;
  end loop;
end $$;

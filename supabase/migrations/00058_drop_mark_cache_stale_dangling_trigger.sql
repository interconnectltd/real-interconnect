-- 00058: 00040 で drop された matching_scores_v3 を参照する dangling trigger を削除
--
-- 症状:
--   user_profiles UPDATE のたびに 42P01:
--     relation "public.matching_scores_v3" does not exist
--   が発生し、 onboarding_step 昇格 / プロフィール更新 / AI プロフィール反映が
--   全て失敗する。 60e86ce の「AIプロフィール永続的に空だった真因」も部分的に
--   この trigger に起因している可能性が高い。
--
-- 原因:
--   - 00001 が `trg_profile_stale_scores` trigger と `mark_cache_stale()` 関数を
--     作成 (matching_scores_v2 invalidate 用)。
--   - 00002 が `mark_cache_stale()` を v3 参照に書き換え (CREATE OR REPLACE)。
--   - 00040 が `matching_scores_v3` を CASCADE DROP したが、 plpgsql 関数本体は
--     遅延束縛で参照されないため CASCADE で連鎖削除されず、 trigger ごと残った。
--
-- 修正方針:
--   - matching_scores_v3 後継のキャッシュ無効化機構が未確立なため、 trigger と
--     関数を **完全に DROP** する。 後で v4 cache が決まった段階で別途追加する。
--   - これは破壊的変更ではない: そもそも参照先が無く、 これ以上機能していなかった。

DROP TRIGGER IF EXISTS trg_profile_stale_scores ON public.user_profiles;
DROP FUNCTION IF EXISTS public.mark_cache_stale();

NOTIFY pgrst, 'reload schema';

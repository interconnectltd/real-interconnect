-- 00060: P0-2 fix — close FOR ALL USING(true) leaks on 4 scoring/AI tables
--
-- 真因:
--   00005_scoring_v2.sql で導入された 4 つの `service_*` policy が
--     `FOR ALL USING (true)` を `TO` 句なしで宣言したため、anon を含む
--     すべての role に SELECT/INSERT/UPDATE/DELETE を許してしまっていた。
--   検証 (適用前): curl GET .../rest/v1/user_conversation_vectors?... (anon key)
--   → HTTP 200, 全ユーザーの embedding を取得可能。同様に correction_log /
--     scoring_config も anon read 可。feedback_log は table 空のため見えなかった
--     が policy 自体は leaky。
--
-- 修正:
--   既存 service_* policy を DROP → `TO service_role` を明示して再作成。
--   owner policies (users_own_vectors / own_corrections / own_feedback /
--   authenticated_read_config) は無変更。

DROP POLICY IF EXISTS "service_vectors" ON public.user_conversation_vectors;
CREATE POLICY "service_vectors"
  ON public.user_conversation_vectors
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_corrections" ON public.correction_log;
CREATE POLICY "service_corrections"
  ON public.correction_log
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_feedback" ON public.feedback_log;
CREATE POLICY "service_feedback"
  ON public.feedback_log
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_config" ON public.scoring_config;
CREATE POLICY "service_config"
  ON public.scoring_config
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

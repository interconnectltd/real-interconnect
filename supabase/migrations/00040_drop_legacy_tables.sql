-- 00040: 旧スキーマ・dead テーブルの一括 DROP
--
-- 経緯:
--   - 00001/00002 で matching_scores_v2/v3, match_requests/connections 等の旧マッチング系テーブルが定義されたが、
--     v4 移行 (matching_scores_v4) 後は src 内で参照ゼロ
--   - 00004 で communities/manual_recommendations/user_signals 等の Stripe / 探索系テーブルが定義されたが、
--     コード参照ゼロ (Stripe 連携・通知 step sequence など未実装機能)
--   - これらが残っていると ETL/監査/型生成のノイズ・FK 連鎖の事故源
--
-- 安全策:
--   - 全 DROP は CASCADE で実行 (FK 連鎖も同時削除)
--   - 万一参照が残っていれば PostgreSQL が依存を報告するので明示的に CASCADE 指定
--   - 削除対象は src 内 grep で参照ゼロを確認済 (technical-debt audit Round 1)

DROP TABLE IF EXISTS public.matching_scores_v3 CASCADE;
DROP TABLE IF EXISTS public.matching_scores_v2 CASCADE;
DROP TABLE IF EXISTS public.match_connections CASCADE;
DROP TABLE IF EXISTS public.match_requests CASCADE;
DROP TABLE IF EXISTS public.match_feedback CASCADE;
DROP TABLE IF EXISTS public.manual_recommendations CASCADE;
DROP TABLE IF EXISTS public.user_signals CASCADE;
DROP TABLE IF EXISTS public.signal_aggregates CASCADE;
DROP TABLE IF EXISTS public.matrix_versions CASCADE;
DROP TABLE IF EXISTS public.ab_tests CASCADE;
DROP TABLE IF EXISTS public.ab_test_assignments CASCADE;
DROP TABLE IF EXISTS public.communities CASCADE;
DROP TABLE IF EXISTS public.email_digest_log CASCADE;
DROP TABLE IF EXISTS public.intervention_log CASCADE;
DROP TABLE IF EXISTS public.step_sequences CASCADE;
DROP TABLE IF EXISTS public.step_delivery_log CASCADE;
DROP TABLE IF EXISTS public.goal_change_events CASCADE;
DROP TABLE IF EXISTS public.transcript_sources CASCADE;
DROP TABLE IF EXISTS public.transcript_raw CASCADE;
DROP TABLE IF EXISTS public.normalized_transcripts CASCADE;
DROP TABLE IF EXISTS public.group_matches CASCADE;
DROP TABLE IF EXISTS public.group_match_members CASCADE;
-- meeting_participants_v2 の DROP は撤回 (00044 で復活)。
-- 監査結果: src 内 7 ファイル 13 箇所で参照中で、本コメント執筆時は誤っていた。
-- 旧 DROP 行: DROP TABLE IF EXISTS public.meeting_participants_v2 CASCADE;

NOTIFY pgrst, 'reload schema';

-- Migration: matching_scores_v4 self-pair physical guard
-- Audit: Persona W1 (self-exclusion auditor)
--
-- 背景:
--   /matching の「あなたにおすすめ」に自分自身が混入したという報告。
--   compute-v2 route では `.neq("id", user.id)` で論理除外していたが、
--   1) 他経路 (worker / 手動 insert / 将来の追加 endpoint) からの混入を防げない
--   2) UNIQUE(viewer_id, target_id) しか constraint がない
--   ため、DB レベルで self pair を禁止する CHECK 制約を追加。
--
-- 既存 row の確認 (本番):
--   SELECT COUNT(*) FROM matching_scores_v4 WHERE viewer_id = target_id; -- 0 件
--   → クリーンアップ DELETE は冪等のため残す。
--
-- ────────────────────────────────────────

-- 1) 万一の self-pair 行を削除 (safety: 0 件想定)
DELETE FROM public.matching_scores_v4 WHERE viewer_id = target_id;

-- 2) CHECK 制約を追加 (NOT VALID → VALIDATE で大規模 table でもロック短縮)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.matching_scores_v4'::regclass
      AND conname  = 'matching_scores_v4_no_self_pair'
  ) THEN
    ALTER TABLE public.matching_scores_v4
      ADD CONSTRAINT matching_scores_v4_no_self_pair
      CHECK (viewer_id <> target_id) NOT VALID;

    ALTER TABLE public.matching_scores_v4
      VALIDATE CONSTRAINT matching_scores_v4_no_self_pair;
  END IF;
END $$;

COMMENT ON CONSTRAINT matching_scores_v4_no_self_pair
  ON public.matching_scores_v4 IS
  'self pair (viewer_id = target_id) を物理禁止。compute-v2 の neq("id", user.id) と二重防御。';

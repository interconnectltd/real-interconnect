-- 00024_judge_direction.sql
--
-- P1 Bug 3 修正: judge_pair_cache の forward (viewer.need × target.offer) と
-- reverse (target.need × viewer.offer) の書込が unique key 衝突する問題。
--
-- 旧 unique: (viewer_id, target_id, need_idx, offer_idx)
-- 新 unique: (viewer_id, target_id, direction, need_idx, offer_idx)
-- direction='fwd' / 'rev' の 2 値で論理的に行を分離。

ALTER TABLE public.judge_pair_cache
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'fwd'
  CHECK (direction IN ('fwd', 'rev'));

-- 既存 unique constraint を破棄して direction 込みの新版に置換
ALTER TABLE public.judge_pair_cache
  DROP CONSTRAINT IF EXISTS judge_pair_cache_viewer_id_target_id_need_idx_offer_idx_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.judge_pair_cache'::regclass
       AND conname  = 'judge_pair_cache_unique_pair_dir_idx'
  ) THEN
    ALTER TABLE public.judge_pair_cache
      ADD CONSTRAINT judge_pair_cache_unique_pair_dir_idx
      UNIQUE (viewer_id, target_id, direction, need_idx, offer_idx);
  END IF;
END $$;

COMMENT ON COLUMN public.judge_pair_cache.direction IS
  'fwd = viewer.need × target.offer / rev = target.need × viewer.offer。
   forward と reverse で同じ (need_idx, offer_idx) を別行として保持するため。';

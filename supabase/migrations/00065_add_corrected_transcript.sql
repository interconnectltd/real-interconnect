-- 00065_add_corrected_transcript.sql
--
-- meeting_transcripts に 3-way speaker correction の結果を保管する 4 列を追加。
--
-- 背景:
--   tldv の話者ラベル誤判定が約 28% (実測) あり、下流の Claude Opus 4.6 による
--   transcript_insights 抽出を汚染していた (例: 田島の発言が sara の key_statements
--   に混入)。 mp4 を sara が手動 DL → CLI で 3-way 補正 (tldv + Gemini vision +
--   Gemini audio voice fingerprint) → 本テーブルに書き戻し、 という流れで運用する。
--
-- 設計判断:
--   - corrected_full_text は full_text と同形式 ([speaker]: text 改行 join) で
--     analyze.ts が `corrected_full_text ?? full_text` で透過的に切り替えられる。
--     これにより未補正 meeting も既存挙動のまま動く (後方互換)。
--   - 全列 NULL 許容。 DEFAULT も付けない。既存 row が NULL のままで意味が通る
--     (= 未補正) ため。 NOT NULL にすると過去 80 本のバックフィルが強制される。
--   - correction_confidence は 0.0-1.0。 監視用 (低信頼の補正を後で人間レビュー)。
--     CHECK 制約は付けない (本プロジェクト全般で FLOAT range は trust ベース)。
--   - correction_meta は JSONB。 verdict 内訳 (all-agree / tldv-wrong など)、
--     使った参照声 ID、補正セグメント数等を入れる。スキーマレスで運用観測を最大化。
--   - correction_run_at は「いつ補正したか」。 PoC ロジック改善後に再補正が必要な
--     row を特定するため (`WHERE correction_run_at < '2026-06-01'` 等)。
--
-- RLS 影響:
--   meeting_transcripts の既存 RLS (00056 等) は列限定なし。新列も同じポリシーで
--   読み書き可能。 service_role (worker / CLI) のみ書く想定。再宣言不要。

-- 1) 4 列追加 (再実行安全)
ALTER TABLE public.meeting_transcripts
  ADD COLUMN IF NOT EXISTS corrected_full_text   TEXT,
  ADD COLUMN IF NOT EXISTS correction_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS correction_meta       JSONB,
  ADD COLUMN IF NOT EXISTS correction_run_at     TIMESTAMPTZ;

-- 2) 「最近補正された transcript」「未補正 row」探索用 index
--    partial index で correction_run_at IS NOT NULL のみ保持 (= 補正済みのみ)
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_correction_run_at
  ON public.meeting_transcripts (correction_run_at DESC)
  WHERE correction_run_at IS NOT NULL;

-- 3) コメント (運用ドキュメント代わり)
COMMENT ON COLUMN public.meeting_transcripts.corrected_full_text IS
  '3-way speaker correction 後の full_text。 未補正なら NULL。'
  ' analyze.ts は `corrected_full_text ?? full_text` で読む (00065)。';

COMMENT ON COLUMN public.meeting_transcripts.correction_confidence IS
  '補正全体の信頼度 0.0-1.0。 セグメント単位 verdict の集約値。低信頼は人間レビュー対象 (00065)。';

COMMENT ON COLUMN public.meeting_transcripts.correction_meta IS
  'verdict 内訳 / 使った参照声 / 補正セグメント数 等の運用観測用 JSON (00065)。';

COMMENT ON COLUMN public.meeting_transcripts.correction_run_at IS
  '3-way 補正を実行した時刻。 NULL = 未補正。 ロジック改善後の再補正対象を特定するのに使用 (00065)。';

-- 4) PostgREST schema cache 再読込
--    00062 と同様、apply 直後の "column not found" を避けるため末尾で NOTIFY。
NOTIFY pgrst, 'reload schema';

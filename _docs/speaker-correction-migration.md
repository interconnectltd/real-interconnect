# Speaker Correction — マイグレーション適用手順 (sara 向け)

3-way speaker correction (`scripts/correct-speakers.ts` の `--write-db` モード) を
本番で使う前に、マイグレーション `00065_add_corrected_transcript.sql` を **本番 DB に
適用する必要があります**。

## 何を追加するか

`meeting_transcripts` テーブルに以下の 4 列を追加します:

| 列 | 型 | 用途 |
|---|---|---|
| `corrected_full_text` | TEXT | 補正済み transcript (analyze.ts はこれを優先して読む) |
| `correction_confidence` | DOUBLE PRECISION | 補正全体の信頼度 (0.0-1.0) |
| `correction_meta` | JSONB | verdict 内訳・実行者・モデル情報等 (PII なし) |
| `correction_run_at` | TIMESTAMPTZ | 補正実行時刻 (NULL = 未補正) |

加えて partial index `idx_meeting_transcripts_correction_run_at` を追加します。

すべての列は **NULL 許容** で、既存 row は NULL のまま (= 未補正扱い) で安全に動きます。
`analyze.ts` は `corrected_full_text ?? full_text` で透過的に切り替わるため、
**マイグレ適用と同時に既存挙動が壊れることはありません**。

---

## 適用前の確認

### 1. `.env.local` が本番に向いていることを確認

```bash
grep -E "NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY" .env.local
```

URL が本番プロジェクトのものか確認 (UAT 等と取り違えないように)。

### 2. 他のペンディング マイグレーションがあるか確認

`supabase/migrations/` 配下で、`00065` より前で本番未適用のものがあるか確認:

```bash
# Supabase ダッシュボードで現在の DB schema を確認、または:
psql "$DATABASE_URL" -c "SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10;"
```

私 (sara) の他作業 (`00063_agency_referrals.sql`, `00064_stripe_subscriptions.sql`) も
本番未適用なら、3 つ全部一気に適用されます。

---

## 適用手順

### 案 A: `supabase db push` で全ペンディングを一括適用 (推奨)

```bash
supabase db push
```

`00063 → 00064 → 00065` の順で本番に流れます。

⚠️ **これは sara の他のマイグレも巻き込みます**。00063 (代理店) と 00064 (Stripe) が
本番リリース可能な状態か事前に確認してください。

### 案 B: 00065 だけを psql で直接適用 (安全側、トランザクション付き)

00063/00064 をまだ本番に出したくない場合:

```bash
psql "$DATABASE_URL" <<'EOF'
BEGIN;

ALTER TABLE public.meeting_transcripts
  ADD COLUMN IF NOT EXISTS corrected_full_text   TEXT,
  ADD COLUMN IF NOT EXISTS correction_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS correction_meta       JSONB,
  ADD COLUMN IF NOT EXISTS correction_run_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_correction_run_at
  ON public.meeting_transcripts (correction_run_at DESC)
  WHERE correction_run_at IS NOT NULL;

COMMENT ON COLUMN public.meeting_transcripts.corrected_full_text IS
  '3-way speaker correction 後の full_text。 未補正なら NULL。'
  ' analyze.ts は `corrected_full_text ?? full_text` で読む (00065)。';
COMMENT ON COLUMN public.meeting_transcripts.correction_confidence IS
  '補正全体の信頼度 0.0-1.0。 セグメント単位 verdict の集約値。低信頼は人間レビュー対象 (00065)。';
COMMENT ON COLUMN public.meeting_transcripts.correction_meta IS
  'verdict 内訳 / 使った参照声 / 補正セグメント数 等の運用観測用 JSON (00065)。';
COMMENT ON COLUMN public.meeting_transcripts.correction_run_at IS
  '3-way 補正を実行した時刻。 NULL = 未補正。 ロジック改善後の再補正対象を特定するのに使用 (00065)。';

NOTIFY pgrst, 'reload schema';

COMMIT;
EOF
```

トランザクション内なので、途中で失敗したら全部 rollback されます。

---

## 適用後の検証

### 1. CLI から疎通確認 (--reset --dry-run でテスト)

```bash
# 任意の meeting_id で --reset --dry-run を実行。
# マイグレ適用後はエラーが消える (DB に到達するが、dry-run なので書き込まない)
pnpm correct-speakers -- --video /tmp/x.mp4 --reset --meeting-id 00000000-0000-0000-0000-000000000000 --dry-run
```

### 2. analyze.ts が壊れていないか確認

worker を再起動 (新しいスキーマを読ませる):

```bash
pnpm worker
```

最初の analyze ジョブがエラーなく完走することを確認。`transcript.corrected_full_text` は
当面 NULL のままで、`?? full_text` で fallback されます。

---

## ロールバック手順 (緊急時)

万が一マイグレで問題が起きたら:

```bash
psql "$DATABASE_URL" <<'EOF'
BEGIN;
DROP INDEX IF EXISTS public.idx_meeting_transcripts_correction_run_at;
ALTER TABLE public.meeting_transcripts
  DROP COLUMN IF EXISTS corrected_full_text,
  DROP COLUMN IF EXISTS correction_confidence,
  DROP COLUMN IF EXISTS correction_meta,
  DROP COLUMN IF EXISTS correction_run_at;
NOTIFY pgrst, 'reload schema';
COMMIT;
EOF
```

これで 00065 適用前の状態に戻ります。

⚠️ `corrected_full_text` に既にデータが書き込まれている場合、それは失われます。
ロールバック前に必要なら `SELECT id, corrected_full_text FROM meeting_transcripts WHERE corrected_full_text IS NOT NULL;` でバックアップしておいてください。

---

## マイグレ適用後の sara のワークフロー

```bash
# 単発:
pnpm correct-speakers -- --video ~/Downloads/田島-2026-05-10.mp4 --write-db

# 動作確認だけしたい (DB 書かない):
pnpm correct-speakers -- --video ~/Downloads/田島-2026-05-10.mp4 --write-db --dry-run

# backlog 80 本一括:
#   1. ~/tldv-downloads/ に <名前>-<YYYY-MM-DD>.mp4 を集める
#   2. 以下を実行 (失敗は batch-errors.log に残る):
for f in ~/tldv-downloads/*.mp4; do
  pnpm correct-speakers -- --video "$f" --write-db --skip-already-corrected --auto-pick-first \
    || echo "[batch] FAILED: $f" >> batch-errors.log
done

# 補正済み row を巻き戻したい:
pnpm correct-speakers -- --video /tmp/x.mp4 --reset --meeting-id <uuid>
```

---

最終更新: 2026-05-24

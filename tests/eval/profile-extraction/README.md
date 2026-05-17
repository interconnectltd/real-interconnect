# profile-extraction eval

V2 architecture (`ARCHITECTURE_PROFILE_EXTRACTION_V2.md`) の **重み / 閾値 / 信号** を実データで測るための評価基盤。

## 何を測るか

V2 §10 で定義した 7 metric のうち、 Phase 0 では 4 つに絞る:

| ID | metric | 目標 | 計算 |
|---|---|---|---|
| M1 | `speaker_attribution_accuracy` | ≥ 0.92 | 正しい話者が当てられた発話数 / 全発話数 |
| M2 | `claim_precision` | ≥ 0.95 | 抽出 claim のうち ground truth に存在するもの / 抽出した全 claim |
| M3 | `claim_recall` | ≥ 0.70 | ground truth claim のうち抽出されたもの / 全 ground truth claim |
| M4 | `hallucination_rate` | ≤ 0.01 | 抽出 claim のうち ground truth に「**禁止**」と記された不実 claim の割合 |

## ディレクトリ

```
tests/eval/profile-extraction/
├── transcripts/        # tl;dv 生出力 (ASR 誤り含む)
├── ground-truth/       # 人手で訂正した「真」のラベル
├── predictions/        # baseline / V2 等の予測 fixture (committed)
├── results/            # runner の json 出力 (gitignored)
├── failure-modes.yaml  # V2 §16 の C1-C20 catalog
└── README.md
```

## YAML schema

### transcripts/meeting-NNN.txt
- tl;dv が出力した そのままの text。 改変禁止。
- 形式: `<speaker> [MM:SS]: <utterance>` 1 発話 / 段落。

### ground-truth/meeting-NNN.yaml
```yaml
meeting_id: meeting-001
duration_seconds: 1680
participants:
  - id: P1
    display_name: sara
    role: host
  - id: P2
    display_name: 田口恭平
    role: guest

# tl;dv の誤割当を真の割当に matrix で記録
speaker_corrections:
  - timestamp: "14:23"
    asr_speaker: 田口 恭平
    true_speaker: sara
    reason: "first_person_marker (僕) chain"
    failure_category: C2  # failure-modes.yaml の id

# 抽出されるべき claim (true positive)
expected_claims:
  - id: claim_001
    speaker: P2  # 田口
    field: business.industry
    value: "営業代行"
    source_timestamp_range: ["02:30", "03:10"]
    confidence: confirmed

# 抽出されてはいけない claim (hallucination 検出)
forbidden_claims:
  - id: forbidden_001
    speaker: P2  # 田口
    field: hobbies
    value: "シャンパンタワー / シャンパンコール"
    reason: "tl;dv 要約が誤って 田口 に帰属した。 真は sara の発言。"
    failure_category: C3
```

## 実行方法

```bash
# baseline (tl;dv 生 ASR を盲信) のスコアを測る
pnpm tsx scripts/eval/profile-extraction-runner.ts \
  --ground-truth tests/eval/profile-extraction/ground-truth/meeting-001.yaml \
  --predictions  tests/eval/profile-extraction/predictions/baseline-tldv-asr.yaml

# V2 理想 (Layer 2++ が完全に動いた場合) のスコアを測る
pnpm tsx scripts/eval/profile-extraction-runner.ts \
  --ground-truth tests/eval/profile-extraction/ground-truth/meeting-001.yaml \
  --predictions  tests/eval/profile-extraction/predictions/v2-ideal.yaml
```

## 現在のスコア (2026-05-16, n=68 attribution / n=37 claims)

| pipeline | M1 attribution | M2 precision | M3 recall | M4 hallucination |
|---|---|---|---|---|
| baseline-tldv-asr | **19.1%** (13/68) | 75.0% (3/4) | **8.1%** (3/37) | 50.0% (2 fired) 🚨 |
| v2-ideal (目標) | 100.0% (68/68) | 97.7% (42/43)\* | 97.3% (36/37)\*\* | 2.3% (1 fired)\*\*\* |

**重要な発見**:
- tl;dv ASR は誤帰属領域で **19% しか正しくない** (61 件のうち 55 件が誤り)
- tl;dv だけで Claim 抽出すると **recall 8%** (37 件中 3 件しか拾えない) — pipeline 必須
- baseline で hallucination 2 件発火、 うち 1 件は critical (シャンパン→田口)

V2 実装の到達点は M1: 19.1% → 100%、 M3: 8.1% → 97.3% の **80 ポイント超の改善**。

\* M2 の 1 件は `target_customer_categories` (list 型) を string 正規化で見落とした既知バグ。
\*\* M3 の 1 件は同上 (list 型 claim)。
\*\*\* M4 の 1 件は forbidden_003 (営業代行 source 取り違え検出) と expected claim が
    schema 上重複しているための誤発火。 forbidden に `source_timestamp` を厳密照合する
    runner 改修で解消可能。

## 注釈統計 (現状)

```
total_corrections: 100  (high=86, medium=12, low=2)
total_claims:       49
total_forbidden:    26
total_ambiguous:    22
annotators: [sara, agent-1, agent-2, agent-3, agent-4]
```

sara review 待ち。 conflict: 1 件 (07:37 mixed-line treatment)。

## Phase

- **Phase 0** (現在) — schema 確立 + n=1 ground truth + metric 計算 skeleton
- **Phase 1** — V1 pipeline で baseline 測定
- **Phase 2** — V2 Layer 2++ 実装 → 同 meeting で差分計測
- **Phase 3** — n を 5→30 へ拡張 → ablation で weight tuning

## 制約

- n=1 ground truth は **設計の妥当性検証**には十分だが **重み付け最適化**には不足。
- Phase 3 で 30 件揃うまで Layer 2++ の重み (`0.40 / 0.30 / 0.20 ...`) は **暫定値**。
- ground truth は会議参加者本人が監修すること (sara が監修)。

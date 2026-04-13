# INTERCONNECT スコアリング V2 設計書（改訂版）

> 会話内容に基づくビジネスマッチング — 完全設計
> 初版: 2026-04-13 / 改訂: 2026-04-13（精査フィードバック全20項目反映）

---

## 0. なぜ V2 が必要か

### 現行システム（V1）の致命的欠陥

INTERCONNECTの価値は「ミーティングで実際に語られた内容に基づくマッチング」。
しかし V1 では、Claude が抽出した豊富なデータの **90% が捨てられている**。

| Claude が抽出するもの | V1 での利用 |
|---|---|
| demonstrated_skills（実証されたスキル） | 文字列部分一致でテンプレート理由に使用 |
| expressed_needs（表明されたニーズ） | 文字列部分一致でテンプレート理由に使用 |
| offered_capabilities（提供できる能力） | 文字列部分一致でテンプレート理由に使用 |
| communication_traits（4つの数値） | **スコア計算の唯一のAI入力**（類似度） |
| key_statements（印象的な発言） | **未使用** |
| engagement_metrics（参加度） | **未使用** |

V1 のスコア計算は「コミュニケーションスタイルが似ている人 = 良いマッチ」という誤った前提に立っている。
実際は：
- 積極的なCEO × 分析的なCTO = スタイルは違うが最高の組み合わせ
- 全ペアの会話スコアが 0.80〜0.96 に集中 → **差別化不能**
- 分析 0回→1回でスコアが**下がる**（離散的重み遷移 + 過剰な二重縮小）

### V2 の設計原則

1. **会話内容が王** — プロフィール属性ではなく、実際に語られた内容がスコアの根幹
2. **非対称** — 「AにとってBの価値」≠「BにとってAの価値」
3. **プライバシー最優先** — 証拠引用は内部スコアリング専用。ユーザーのニーズを他者に明示しない
4. **正直なシグナル** — 良い会議はスコアを上げ、悪い会議はスコアを下げる
5. **漸進的** — 1回のミーティングでも意味のある結果。データが増えるほど精度向上
6. **コスト効率** — スコア計算時にLLM呼び出しゼロ。事前抽出データの純粋な計算

---

## 1. データモデル

### 1.1 Claude 抽出の強化（プロンプト v3.0.0）

現行 v2.0.0 の 6 フィールドを拡張。**破壊的変更を含む。**

```
v2.0.0 (現行):
  demonstrated_skills: string[]                           ← v3で構造変更
  expressed_needs: {text, category, subcategory, confidence}[]
  offered_capabilities: {text, category, subcategory, confidence}[]
  communication_traits: {assertiveness, collaboration, analytical, empathy}
  key_statements: string[]
  engagement_metrics: {participation_rate, question_frequency, response_quality}

v3.0.0 (変更点):
  demonstrated_skills: {text, category, subcategory, confidence}[]  ← string[]から構造体に変更
  (追加) topic_depth: {topic, category, depth: "mentioned"|"discussed"|"deep"}[]
  (追加) engagement_behaviors: {
    gives_actionable_advice: boolean,
    asks_deep_questions: boolean,
    shares_connections: boolean,
    offers_resources: boolean,
    challenges_ideas: boolean
  }
  (追加) evidence_quotes: {field: "need"|"offer"|"skill", index: number, quote: string}[]
```

**破壊的変更: demonstrated_skills**
- v2: `["プレゼンテーション能力", "資金調達"]`
- v3: `[{"text":"プレゼンテーション能力", "category":"leadership", "subcategory":"communication", "confidence":0.9}]`
- 集約ハンドラーは両形式を検出して処理する（§8.1 参照）

**コスト影響**: +500〜1,200 出力トークン/分析 ≈ +$0.015/分析 ≈ +$45/月（3000分析時）
**max_tokens**: 2000 → 3000 に引き上げ

**トランスクリプト前処理の注意**:
tl;dvが文字間スペース付きテキストを返す場合がある。
evidence_quotes にこのアーティファクトが入るため、集約時にスペース正規化を適用する。

### 1.2 ユーザー会話ベクトル（新テーブル）

スコアリング専用のデータ構造。移行期間中は `member_ai_profiles_v2` と並行して書き込む（§8 参照）。

```sql
CREATE TABLE public.user_conversation_vectors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  need_vectors          JSONB NOT NULL DEFAULT '[]',
  offer_vectors         JSONB NOT NULL DEFAULT '[]',
  expertise_vectors     JSONB NOT NULL DEFAULT '[]',
  topic_vectors         JSONB NOT NULL DEFAULT '[]',
  engagement_signature  JSONB NOT NULL DEFAULT '{}',
  evidence_index        JSONB NOT NULL DEFAULT '{}',
  hidden_items          JSONB NOT NULL DEFAULT '[]',
  analysis_count        INT NOT NULL DEFAULT 0,
  meeting_ids           UUID[] DEFAULT '{}',
  last_analyzed_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_conversation_vectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_vectors" ON public.user_conversation_vectors
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "service_role_all" ON public.user_conversation_vectors
  FOR ALL USING (auth.role() = 'service_role');
```

#### 各ベクトルの構造

**need_vectors / offer_vectors:**
```json
{
  "id": "uuid-v4",
  "text": "エンジニア採用に困っている",
  "category": "hr",
  "subcategory": "recruitment",
  "confidence": 0.92,
  "weight": 2.0,
  "source_count": 2,
  "last_seen": "2026-04-11T05:00:00Z",
  "evidence": ["内部参照用の引用テキスト"]
}
```

**evidence_index:** スコアリング精度向上のための**内部データ**。ユーザーには表示しない（§11参照）。

### 1.3 マッチングスコア V4（新テーブル）

```sql
CREATE TABLE public.matching_scores_v4 (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  need_offer_score  FLOAT NOT NULL DEFAULT 0.0,
  reverse_match     FLOAT NOT NULL DEFAULT 0.0,
  expertise_fit     FLOAT NOT NULL DEFAULT 0.0,
  topic_alignment   FLOAT NOT NULL DEFAULT 0.0,
  engagement_value  FLOAT NOT NULL DEFAULT 0.0,
  history_score     FLOAT NOT NULL DEFAULT 0.0,
  total_score       FLOAT NOT NULL DEFAULT 0.0,
  confidence        FLOAT NOT NULL DEFAULT 0.0,
  phase             TEXT NOT NULL DEFAULT 'attribute_only'
                    CHECK (phase IN ('attribute_only','hybrid','ai_primary')),
  score_reasons     JSONB DEFAULT '[]',
  notify_tier       TEXT CHECK (notify_tier IN ('high','medium','low')),
  is_stale          BOOLEAN NOT NULL DEFAULT true,
  calculated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(viewer_id, target_id)
);

CREATE INDEX idx_scores_v4_viewer ON matching_scores_v4(viewer_id) WHERE NOT is_stale;

ALTER TABLE public.matching_scores_v4 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_scores" ON public.matching_scores_v4
  FOR SELECT USING (auth.uid() = viewer_id);
CREATE POLICY "service_role_all" ON public.matching_scores_v4
  FOR ALL USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION mark_scores_v4_stale()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE matching_scores_v4 SET is_stale = true
  WHERE viewer_id = NEW.user_id OR target_id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stale_scores_v4
  AFTER UPDATE ON user_conversation_vectors
  FOR EACH ROW EXECUTE FUNCTION mark_scores_v4_stale();
```

**フェーズ名: V1互換。** `"attribute_only" | "hybrid" | "ai_primary"` をそのまま使用。

---

## 2. スコアリングアルゴリズム

### 2.1 5次元モデル（履歴は属性スコアにのみ含む）

| 次元 | 意味 | 重み |
|---|---|---|
| need_offer_score | 相手が自分のニーズに応えられるか（非対称） | 0.40 |
| reverse_match | 自分が相手のニーズに応えられるか（互恵性） | 0.18 |
| expertise_fit | 専門性が補完的か | 0.18 |
| topic_alignment | 深く議論するテーマが共通しているか | 0.12 |
| engagement_value | 相手の行動的価値 | 0.12 |

合計: 1.00。**history_score は属性スコアにのみ含む（二重計上防止）。**

### 2.2 各次元の計算

#### Dimension 1: ニーズ×オファーマッチ（need_offer_score）

```
viewer の各 need について target の offers からマッチを探索:
  a. カテゴリマッチ:
     subcategory 完全一致 → 1.0 / category 一致 → 0.5 / 隣接カテゴリ → 0.4 / 不一致 → 0.0
  b. テキスト類似フォールバック:
     カテゴリマッチ 0.0 の場合、テキスト共通キーワード2語以上 → 0.2

  マッチ強度 = max(カテゴリマッチ, テキスト類似) × min(need.confidence, offer.confidence)
  score = Σ(need.weight × match_strength) / Σ(need.weight)
```

#### Dimension 2: 逆方向マッチ（reverse_match）

```
calcNeedOfferScore(target.need_vectors, viewer.offer_vectors)
```

×0.7 割引は廃止。次元重み（0.18）が相対的重要度を表現。

#### Dimension 3: 専門性適合（expertise_fit）

```
同subcategory → 0.5 / 同category異subcategory → 1.0 / 隣接 → 0.4 / 異category → 0.1
score = Σ(value × target.weight) / Σ(target.weight)
```

#### Dimension 4: トピック親和性（topic_alignment）

```
alignment += catMatch × viewer.depth × target.depth × viewer.weight
score = alignment / Σ(viewer.weight)
  depth: mentioned=0.3, discussed=0.6, deep=1.0
```

#### Dimension 5: エンゲージメント価値（engagement_value）

```
advice:0.30 / connections:0.25 / resources:0.20 / questions:0.15 / challenges:0.10
score = Σ(behavior × weight)
```

Phase 2 でコンテキスト依存重みに拡張予定（viewer の need カテゴリに基づく）。

### 2.3 合成スコア計算

#### 信頼制御: alpha 一本化（shrinkage 廃止）

```
min_analysis = min(viewer.analysis_count, target.analysis_count)

alpha:  0→0.00 / 1→0.35 / 2→0.60 / 3→0.80 / ≥4→0.92

confidence（通知ティア判定用のみ）: min(min_analysis / 5, 1.0)

片側会話: viewer有 & target無 → alpha_one_sided = 0.15
```

#### 最終スコア

```
conv_score = 0.40×need_offer + 0.18×reverse + 0.18×expertise + 0.12×topic + 0.12×engagement
attr_score = 0.60×attribute + 0.25×purpose + 0.15×history
blended = alpha × conv_score + (1 - alpha) × attr_score

方向性付き単調保証:
  conv_score > 0.50 → total = max(blended, attr_score)  // 良い会議は絶対にスコアを下げない
  conv_score ≤ 0.50 → total = blended                   // 悪い会議は正直に下げる
```

**数値例（analysis=1, conv=0.80, attr=0.50）:**
`blended = 0.65×0.50 + 0.35×0.80 = 0.605 → max(0.605, 0.50) = 0.605` (+21%)

**数値例（analysis=1, conv=0.30, attr=0.50）:**
`blended = 0.65×0.50 + 0.35×0.30 = 0.430` (正しく下降)

---

## 3. 推薦理由生成

**原則: ユーザーの推論されたニーズは理由テキストに明示しない。ランキングにのみ使用。**

```
Tier 1: 「{name}さんは{capability}の実績をお持ちです」（ターゲット視点のみ）
Tier 2: 「{name}さんも{category}の領域で課題をお持ちです。お互いに力になれる関係です」
Tier 3: 「{topic}について深い知見をお持ちです」
Tier 4: 「ミーティングで具体的なアドバイスを提供してくれる方です」
Tier 5: 「{industry}で活躍されている方です」（属性フォールバック）
```

最大3件。evidence_quote は他ユーザーに**表示しない**（§11参照）。

---

## 4-7. パイプライン・カテゴリ・冷間起動・コスト

（§1-3の変更に伴う更新。主要な変更点:）
- aggregate は member_ai_profiles_v2 と user_conversation_vectors に**並行書き込み**
- v2形式スキルは `{category:"other"}` に自動変換
- max_tokens: 3000
- 月間コスト: V1 $72 → V2 $102 (+$30)
- 隣接カテゴリマップ: 11ペア、全て双方向
- 「高精度」ラベル廃止。データソースのみ表示

---

## 8. マイグレーションパス

Step 1: プロンプト+テーブル作成 → Step 1.5: 既存21件の再分析（推奨） → Step 2: 集約拡張（並行書込） → Step 3: V2スコアリング実装 → Step 4: フロントエンド更新 → Step 5: V1クリーンアップ

### 8.1 後方互換性

```
- topic_depth null → topic_vectors = []、topic_alignment = 0
- engagement_behaviors null → engagement_signature = {}、engagement_value = 0
- evidence_quotes null → evidence_index = {}
- demonstrated_skills が string[] → {text, category:"other", subcategory:"general", confidence:0.5}
- 全次元関数は空配列で 0 を返す
```

---

## 9-10. シミュレーション・将来拡張

（主要変更: pgvector Phase 2、エンゲージメント重みコンテキスト化、ユーザー手動入力によるベクトル補完）

---

## 11. プライバシー設計

### 11.1 証拠引用の取り扱い

```
禁止: 他ユーザーに証拠引用を表示 / viewer のニーズを理由テキストに明示 / ミーティングの存在を推測可能にする
許可: 内部スコアリング精度向上 / 抽象化された能力記述としてテンプレートに反映 / ユーザー本人が自分のプロフィールで確認
```

### 11.2 ユーザーの AI プロフィール管理

`/settings/ai-profile` ページ（新規）で自分の抽出データを確認・非表示化可能。
`hidden_items` に追加された項目はスコアリングから除外。

### 11.3 プライバシーポリシーとの整合

現行ポリシー「ニーズ情報は非公開」に完全準拠。テンプレートはターゲットの能力のみ記述。

---

## 付録: V1 との比較表

| 側面 | V1 | V2 |
|---|---|---|
| AI データ利用率 | ~10% | ~95% |
| 主入力 | 4トレイト類似度 | 5次元意味的マッチング |
| 推薦理由 | 汎用テンプレート | ターゲット視点の具体的理由 |
| 初回分析インパクト | 6%（二重減衰） | 35%（alpha一本化） |
| 単調保証 | なし/全方向（負を抹殺） | 方向性付き（良↑悪↓） |
| プライバシー | 証拠引用表示（違反） | 内部データのみ |
| 履歴の扱い | 二重計上 | 属性スコアのみ |
| ユーザー制御 | なし | AIプロフィール確認・非表示 |

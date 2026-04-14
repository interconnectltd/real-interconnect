# INTERCONNECT スコアリング V2 設計書（最終完全版）

> 会話内容に基づくビジネスマッチング — Opus構造化抽出 + Haiku LLM判定 + 自動改善ループ
> 参照: SCORING_V2_DESIGN.csv（機能設計82項目）

---

## 0. アーキテクチャ概観

```
┌─────────────────────────────────────────────────────────────────────┐
│                      4レイヤー構成                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 1: Opus 構造化抽出                                           │
│  ├─ 会議書き起こし → Opus 4.6 で深層分析                            │
│  ├─ solver_profile / beneficiary_profile（精度の核心）              │
│  ├─ explicit/implicit フラグ + signals + 日本語婉曲対策             │
│  └─ conversation_dynamics（ペア間会話品質）                          │
│                                                                     │
│  Layer 1.5: 集約エンジン                                            │
│  ├─ Haiku 重複判定（「エンジニア採用」≈「CTO探し」）               │
│  ├─ explicit 即統合 / implicit confidence 累積                      │
│  ├─ 時間軸管理（decay + urgency + 解決済み除去）                    │
│  └─ user_conversation_vectors に書き込み                            │
│                                                                     │
│  Layer 2-3: 5次元スコアリング + 動的重み + ブースト                  │
│  ├─ カテゴリベース事前スコア（O(N²)、LLMなし）                     │
│  ├─ 上位50件を Haiku LLM 判定でリランキング（+10点の核心）         │
│  ├─ 動的重み（need_offer高→集中 / 低→engagement重視）              │
│  └─ surprise_bonus（属性低×会話高 = INTERCONNECTの最大価値）       │
│                                                                     │
│  Layer 4: 自動フィードバックループ                                   │
│  ├─ 2段階FB UI + 暗黙シグナル                                      │
│  ├─ Haiku プロンプト自動改善（候補生成→A/Bテスト→承認適用）        │
│  ├─ 重み月次自動チューニング（scoring_config）                      │
│  └─ 属性スコア隣接マップ自動更新                                    │
│                                                                     │
│  セーフガード: ロールバック / 異常検出 / 段階ロールアウト / 過学習防止 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Opus 構造化抽出（レイヤー1）

### 1.1 モデル選択: Opus 4.6

Sonnet では暗黙ニーズの推論が弱い。日本語婉曲表現（「ちょっと気になって」= 重要課題）の読み取りに
Opus の高度な文脈理解が必要。1ミーティング1回きりの分析なのでコスト許容。

| 項目 | V1 (Sonnet) | V2 (Opus) |
|---|---|---|
| モデル | claude-sonnet-4-6 | claude-opus-4-6 |
| 月間コスト (1000人) | $44 | $330-500 |
| 暗黙ニーズ検出 | 弱い | 強い |
| 日本語婉曲理解 | 基本的 | 高度 |

### 1.2 プロンプト設計（v3.0.0）

#### explicit/implicit フラグ
各ニーズ・オファーに「明示的/推論」フラグを付与。
- `explicit: true` → 即使用（高信頼）
- `explicit: false` → confidence 低減だが **weight 下限 1.0 保証** + **confidence 下限 0.5 保証**
- implicit need の過小評価を防止

#### signals 検出（推論根拠の構造化）
```
同トピック2回言及 → 重要
具体的数字の言及 → 高信頼
質問の具体性     → ニーズ vs 社交辞令の判別
発言の長さ       → 関心度
```
Opus の推論をトレース可能にする。

#### 日本語婉曲対策（プロンプトに明示）
```
「ちょっと気になって」  → 重要課題
「もしよかったら」      → 明確ニーズ
「まあ一応」            → 謙遜 = 実績
「いいですよね」        → 社交辞令（除外）
```

#### solver_profile（精度向上の核心）
各ニーズに「このニーズに応えられる人はどういう人か」を自然言語で詳細記述。
Haiku 判定の入力精度を劇的に向上。embedding 化時にオファーと同空間で比較可能。

**例:**
```json
{
  "text": "シリーズAの資金調達を検討中",
  "solver_profile": "ITスタートアップ投資経験のあるVC/CVC。特にSaaS領域のシリーズA実績がある投資家。経営支援も含めたハンズオン型が理想。"
}
```

#### beneficiary_profile（solver_profile と対）
各オファーに「このオファーが役立つ人はどういう人か」を自然言語で詳細記述。
solver_profile とクロスマッチでカテゴリ横断の解決関係を捕捉。

**例:**
```json
{
  "text": "SaaS企業の成長戦略コンサルティング",
  "beneficiary_profile": "ARR 1-10億円のSaaSスタートアップ経営者。PMF達成後のスケール期に課題を抱えている。組織拡大やGTM戦略に悩んでいる人。"
}
```

#### conversation_dynamics（ペア間会話品質）
```json
{
  "rapport": 0.8,                  // 信頼関係
  "information_asymmetry": 0.6,    // 情報非対称（一方が教える側）
  "unspoken_tensions": ["予算"],   // 回避されたトピック
  "follow_up_potential": true      // 次のアクションの有無
}
```

### 1.3 出力構造

**needs:**
```json
{
  "text": "シリーズAの資金調達を検討中",
  "explicit": true,
  "confidence": 0.95,
  "evidence": ["来年の春までにシリーズAを..."],
  "signals": ["具体的時期の言及", "2回目の言及"],
  "solver_profile": "ITスタートアップ投資経験のあるVC...",
  "urgency_signals": ["来年の春まで"],
  "category": "finance",
  "subcategory": "fundraising"
}
```

**offers:**
```json
{
  "text": "SaaS企業の成長戦略コンサルティング",
  "explicit": true,
  "confidence": 0.90,
  "evidence": ["ARR 3億から10億に持っていった..."],
  "signals": ["具体的数字", "実績ベース"],
  "beneficiary_profile": "ARR 1-10億円のSaaSスタートアップ経営者...",
  "credibility": "実績",
  "category": "strategy",
  "subcategory": "business_development"
}
```

### 1.4 品質対策

- **tl;dv 文字起こし品質**: 話者分離エラー → 矛盾検出 → confidence 低下 + フラグ。スペース正規化。
- **バリデーション**: Zod スキーマで必須フィールド/テキスト長/confidence 範囲チェック。失敗 → 再試行 → フォールバックプロンプト。
- **会議品質重み**: meeting_type × duration で confidence 係数。10分雑談 → 0.5-0.7。60分深い議論 → 1.0。

### 1.5 コスト

1000人 × 月3回 = 3000分析。$0.10-0.15/回。solver/beneficiary_profile 追加で +$30-50。
**合計: 月 $330-500。** max_tokens: 3000。

---

## 2. 集約エンジン（レイヤー1.5）

### 2.1 基本ロジック

同一ユーザーの複数 MT 分析結果を統合。
- `explicit: true` → 即統合
- `explicit: false` → confidence 累積（複数回言及で信頼度上昇）
- `user_conversation_vectors` に書き込み（`member_ai_profiles_v2` と並行書込）

### 2.2 Haiku 重複判定

既存ニーズ一覧と新規抽出を比較し同一/新規を判定。
「エンジニア採用」vs「CTO探し」の区別に LLM が必要（embedding 距離では不十分）。
月 $5-10。

### 2.3 時間軸管理

**ニーズ decay:**
- `last_mentioned` フィールド追跡
- 3ヶ月言及なし → weight 半減
- 明示的「解決済み」言及 → 即除去
- `/settings/ai-profile` で手動除去も可能

**urgency 推定:**
- 複数 MT での言及頻度: 3回中3回 → high / 3回中1回 → low
- 単一 MT 推論より精度高

### 2.4 低参加者対策

participation_rate 低（聞き専）→ `/settings/ai-profile` で「関連トピック」任意選択可能。
沈黙 ≠ 無関心。

---

## 3. Haiku LLM 判定（レイヤー4）★精度+10点の核心

### 3.1 設計思想: カテゴリの壁を超える

カテゴリベースでは「マーケ分析ニーズ × データ基盤オファー」= 0.0。
Haiku は「因果的に解決可能か」を判定 → 0.58-0.82。
**精度 70点 → 80点の原動力。月 $110-130 の追加コスト。**

### 3.2 入力設計: 4テキストクロスマッチ

```
① need.text × offer.text
② solver_profile × offer.text
③ need.text × beneficiary_profile
④ solver_profile × beneficiary_profile

→ 4組のスコアの最大値を採用
```

solver/beneficiary_profile が精度を決定する。

### 3.3 出力設計

**Phase 2:** score(0-1) + reason(15字) の1軸
**Phase 3:** 直接性(0-1) + 確実性(0-1) の2軸

### 3.4 適用範囲

全ペアではなく、カテゴリベース or embedding で**上位50件に絞った後のリランキング**に使用。
コスト: 250回/ユーザー。

### 3.5 バッチ処理

- 差分更新: stale なペアのみ再判定
- バッチ API (50% off) + プロンプトキャッシュ (90% off)
- 結果は matching_scores_v4 にキャッシュ
- 夜間バッチ → レイテンシ問題なし

### 3.6 コスト

日50人再計算 × 250回 × $0.00065 = 月 $243。バッチ 50% off → $122。キャッシュ併用 → **月 $110-130。**

---

## 4. スコアリングモデル（5次元 + 動的重み + ブースト）

### 4.1 5次元

| 次元 | 説明 | データソース |
|---|---|---|
| need_offer_score | Haiku LLM 判定による解決関係スコア | solver/beneficiary_profile クロスマッチ |
| reverse_match | 逆方向（互恵性） | 同上、viewer↔target 入替 |
| expertise_fit | 補完的専門知識 | expertise_vectors カテゴリ照合 |
| topic_alignment | 深い共通テーマ | topic_vectors depth×depth |
| engagement_value | 行動的価値 | engagement_signature |

### 4.2 動的重み

need_offer のスコア（h_no）に応じて重み配分が変化。

| 条件 | need_offer | reverse | expertise | topic | engagement |
|---|---|---|---|---|---|
| h_no ≥ 0.80 | **0.50** | 0.10 | 0.08 | 0.08 | 0.24 |
| h_no ≥ 0.60 | **0.40** | 0.12 | 0.10 | 0.10 | 0.28 |
| h_no < 0.60 | 0.28 | 0.12 | 0.14 | 0.12 | **0.34** |

**設計根拠:**
- h_no 高 → それを信じて集中。完璧マッチを 0.8 台に押し上げ。
- h_no 低 → engagement 重視。紹介力の高い「コネクター型」人材を評価。

### 4.3 非線形ブースト

```
h_no ≥ 0.85 → conv_score + 0.08
h_no ≥ 0.70 → conv_score + 0.04

surprise_bonus:
  attr_score < 0.45 かつ conv_score > 0.45 → 最大 +0.06
  属性低 × 会話高 = 「意外な発見」= INTERCONNECT の最大価値
```

### 4.4 alpha（一本化 + 積極化）

shrinkage 二重減衰を廃止。alpha のみで制御。

```
分析 0回 → 0.00（純粋な属性）
分析 1回 → 0.50（初回から50%反映）
分析 2回 → 0.75
分析 3回 → 0.88
分析 4回+ → 0.95
片側データ → 0.20
```

V1: 初回影響 6% → **V2: 50%。** 1回のミーティングで即座に意味のある変化。

### 4.5 方向性付き単調保証

```
conv_score > 0.40 → total = max(blended, attr_score)  // 良い会議は下げない
conv_score ≤ 0.40 → total = blended                   // 悪い会議は正直に下げる
```

閾値を 0.50 → 0.40 に引き下げ。中立に近い会議でもスコアを維持。

---

## 5. データモデル

### 5.1 user_conversation_vectors

```
user_id(UNIQUE) / need_vectors(JSONB) / offer_vectors(JSONB) /
expertise_vectors / topic_vectors / engagement_signature / evidence_index /
hidden_items / analysis_count / meeting_ids / last_analyzed_at
```

各ベクトルに追加フィールド: `explicit` / `signals` / `last_mentioned` / `decay_weight` / `solver_profile` or `beneficiary_profile`

### 5.2 matching_scores_v4

V2 設計書の定義に加え: `config_version` + `algorithm_version`（段階ロールアウト + A/Bテスト用）

### 5.3 新規テーブル

| テーブル | 目的 |
|---|---|
| correction_log | ユーザーの修正記録（プロンプト改善の教師データ） |
| feedback_log | マッチング後の評価（5段階 + 価値タグ + 判定時スコア記録） |
| scoring_config | 重み配分の履歴管理 + ロールバック + 段階ロールアウト |

### 5.4 prompt_versions 拡張

v3.0.0 (Opus) / v3.0.x (Haiku auto-versioned) 追加。
`model_version` / `validated_accuracy` / `few_shot_count` / `is_active` 列追加。

---

## 6. 同席者管理・プライバシー

### 6.1 同席者検出

meeting_ids の重複で検出。推薦一覧から**除外ではなく「以前お会いした方」セクション分離**。

### 6.2 プライバシー

- evidence_quotes は内部スコアリングのみ
- viewer のニーズを理由テキストに明示しない
- 逆推論防止のため理由をターゲット視点に限定

### 6.3 AI プロフィール管理 (/settings/ai-profile)

抽出データ確認・非表示化・修正理由記録 (correction_log)。
任意の UI。ミーティングから吸い出すのが基本。強制フォームではない。

---

## 7. 推薦理由テキストエンジン V2

### 7.1 原則

viewer の推論ニーズは理由に明示しない。ターゲットの能力のみ記述。

### 7.2 Tier 構成

```
Tier 1: 属性（a01-a07 維持）
Tier 2: 会話（新規5種、ターゲット視点）
Tier 3: AI（ニーズ明示系を修正）
Tier 4: 関係（r01-r04 維持）
```

最大3件、priority 降順。

---

## 8. パイプライン

### 8.1 全体フロー（7段階）

```
Cron (9/12/15/18 JST)
  → tl;dv 取得
  → Opus 分析 (solver/beneficiary 含)
  → Haiku 集約 (重複判定)
  → ベクトル書込 (user_conversation_vectors)
  → stale フラグ
  → カテゴリスコア + Haiku 判定バッチ
  → 通知
```

**3段 LLM**: Opus (抽出) + Haiku (集約) + Haiku (判定)

### 8.2 コスト合計

```
Opus 分析:   $330-500/月
Haiku 集約:  $5-10/月
Haiku 判定:  $110-130/月
───────────────────────
合計:        $445-640/月（ユーザーあたり $0.45-0.64）
```

V1: $44/月 → V2: $445-640/月（精度 +30点以上と引き換え）

---

## 9. 自動フィードバックループ（使うほど良くなる仕組み）

### 9.1 フィードバック収集

**2段階 FB UI:**
- 1段階目（必須）: 5段階★評価
- 2段階目（任意）: 価値タグ選択（アドバイス/紹介/気づき/共通課題/なし）
- コネクション成立 1週間後に push

**暗黙シグナル活用:**
- profile_views の view_duration
- コネクション申請率 / 申請後承認率
- 全ユーザーから自動取得。FB の偏りを補完。

### 9.2 Haiku 自動改善（候補生成→A/Bテスト→承認適用）

1. **候補生成（自動）**: FB 正解/不正解ペアを自動抽出。不正解50件ごとに few-shot examples 候補を生成。prompt_versions に v3.0.1, v3.0.2 と自動バージョニング。
2. **A/Bテスト検証（自動）**: 現行プロンプト(A) と候補(B) で同一ペアセットを判定。時系列バリデーション（前半3ヶ月で生成→後半1ヶ月で検証）で過学習防止。
3. **承認→適用（半自動）**: 改善幅 +2% 以上のみ候補に。管理画面に通知。**自動適用はしない**。

### 9.3 重み最適化

FB 100件以上で起動。グリッドサーチで最適パラメータ探索。scoring_config に保存。
段階ロールアウト (10% → 50% → 100%)。

### 9.4 属性スコア自動調整

コネクション承認率を業種×職種ペアで集計 → 隣接マップ親和度を自動更新。
最低 30件/ペアで更新。完全自動化可能。

---

## 10. セーフガード（精度劣化防止）

| 仕組み | 詳細 |
|---|---|
| **ロールバック (prompt)** | prompt_versions に validated_accuracy 記録。is_active フラグ管理。 |
| **ロールバック (config)** | scoring_config の version_id 管理。matching_scores_v4 の config_version で追跡。 |
| **異常検出** | 日次コネクション申請率/閲覧数/クリック率を監視。前週比 -20% でアラート。 |
| **段階ロールアウト** | scoring_config 変更は 10% → 50% → 100% で段階適用。 |
| **モデル更新対策** | model_version 記録。Zod バリデーション失敗率急増で自動アラート。 |
| **過学習防止** | A/Bテストデータを時間分割（生成期間/検証期間）。 |
| **FB バイアス対策** | 回収率 30-40%。残り 60% は暗黙シグナルでカバー。 |

---

## 11. リスクと対策

| リスク | 対策 |
|---|---|
| tl;dv 話者分離エラー | Opus で矛盾検出 + confidence 低下 + /settings/ai-profile で修正 |
| 1回MTの限界 | unknown 許容 + 縦断分析 + alpha フォールバック |
| カテゴリ分類限界 | Haiku 判定がカテゴリ不一致でも解決関係を検出。Phase 3 で embedding |
| コスト増 ($445-640/月) | MT1回きり分析でスケーリング線形。ユーザーあたり $0.45-0.64 |
| コールドスタート | 属性 100% (alpha=0) + オンボーディングで任意入力 → 初期ノード |
| ライト層離脱 | アクティブ層の「メンター型」を優先推薦して良い体験を提供 |

---

## 12. マイグレーションパス

| Step | 内容 |
|---|---|
| **1** | テーブル作成 (user_conversation_vectors / matching_scores_v4 / correction_log / feedback_log / scoring_config) + prompt_versions v3.0.0 |
| **1.5** | 既存21件を Opus + v3.0.0 (solver/beneficiary 含) で再分析 |
| **2** | Haiku 重複判定 + user_conversation_vectors 並行書込 + decay 管理 |
| **3** | 5次元 + 動的重み + ブースト + Haiku 判定バッチ + 推薦理由 V2 |
| **4** | /settings/ai-profile + 2段階 FB UI + 同席者セクション + マッチング画面 V2 |
| **5** | feedback_log 収集開始 + 暗黙シグナル集計 + 管理画面（改善候補表示） |
| **6** | v3 → v4 完全移行確認後に v3 削除。member_ai_profiles_v2 は当面維持 |

---

## 13. 将来拡張（Phase 3-4、データドリブン判断）

| Phase | 技術 | 条件 | 期待効果 |
|---|---|---|---|
| 3 | pgvector embedding | other 率 > 30% で判断 | +2-3点 |
| 3 | XGBoost ML | FB 350件以上 | +2-3点 |
| 4 | GraphRAG | embedding 精度不足時 | 意味的に正確 |
| 4 | Gemini 長文コンテキスト | コスト許容時 | 情報圧縮損失ゼロ |
| 4 | 量子最適化 (QUBO) | グループマッチング時 | 組合せ最適化 |

---

## 付録: V1 との比較表

| 側面 | V1 | V2 |
|---|---|---|
| 分析モデル | Sonnet | **Opus 4.6** |
| AI データ利用率 | ~10% | **~95%** |
| 主入力 | 4トレイト類似度 | **solver/beneficiary_profile + Haiku 判定** |
| カテゴリの壁 | 超えられない (0.0) | **Haiku で因果的判定 (0.58-0.82)** |
| 重み | 固定 | **動的（need_offer 依存）** |
| 初回分析インパクト | 6%（二重減衰） | **50%（alpha 一本化）** |
| 単調保証 | なし/全方向 | **方向性付き（良↑悪↓）** |
| フィードバック | なし | **2段階FB + 暗黙シグナル + 自動改善** |
| セーフガード | なし | **ロールバック + 異常検出 + 段階ロールアウト** |
| プライバシー | 証拠引用表示 | **内部データのみ + ターゲット視点理由** |
| 月間コスト | $44 | **$445-640（精度+30点以上）** |

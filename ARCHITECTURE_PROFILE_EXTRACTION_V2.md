# INTERCONNECT プロフィール抽出パイプライン Architecture V2

> tl;dv 会議文字起こしから話者ビジネスプロフィールを高精度抽出する 7 層パイプライン
> **設計目標**: 字面正解率 ≥ 95% + 幻覚率 < 1% (V1 baseline = tl;dv 要約 88% / 12%)
> **本人レビュー前段で 90 点** から **本人レビュー直前で 95 点 + 1% 以下幻覚** へ目標を厳格化
> 参照: SCORING_V2_ARCHITECTURE.md(下流のマッチングスコア設計)

---

## Changelog (V1 → V2)

| 領域 | V1 | V2 |
|---|---|---|
| §2.4 Speaker 伝播 | first_person_marker 単独 (~70% 精度) | **Layer 2++ 10-signal 統合** (~95% 精度目標) |
| §5 検証ケース | C1-C3 (3 件) | **C1-C8 (8 件)** — echo / ASR rapid swap / role reversal / 敬語方向 追加 |
| §10 評価方法 | 無し | **新設**: 7 sub-metric 分解 + ground truth dataset + 評価カデンス |
| §11 コスト予算 | 無し (見積りすら無し) | **新設**: 実測 $0.27/meeting / SLO 表 / 削減戦略 / fallback chain |
| §12 プライバシー | 無し (重大 gap) | **新設**: 第三者言及検出 + 3 段同意モデル + 越境移転対応 |
| §13 移行戦略 | 無し | **新設**: Phase 0-5 shadow→cutover / rollback trigger / backfill |
| §14 観測/SLO | 無し | **新設**: 8 SLI / 8 SLO / drift detection / runbook |
| §15 LLM 障害 | 無し | **新設**: F1-F8 障害シナリオ / fallback chain / DLQ |
| §16 失敗モード taxonomy | §1.2 に 3 件のみ | **新設**: C1-C20 完全 taxonomy + eval YAML |
| §17 Phase 0 実装 | 無し | **新設**: SQL audit + entity-grounding 実装コード |
| 設計目標 | 「90 点」(未定義) | 字面正解率 95% / 幻覚率 1% (測定可能) |

V2 で **8 個の open 課題** を明示 (C7, C9, C10, C12, C14, C15, C18, C20)。これらは v3 (Cross-meeting validation / Discourse coherence) で対応予定。

---

## 0. アーキテクチャ概観

```
┌────────────────────────────────────────────────────────────────────────┐
│                  7 層 + 2 スキーマ + V2 拡張 4 層                       │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Layer 0:   入力正規化                                                 │
│  ├─ 生 transcript + tl;dv labels + invitees + organizer               │
│  ├─ HEARING_SCHEMA(構造化質問定義、ヒアリング会議のみ)              │
│  └─ tl;dv AI 要約は禁止(汚染源)                                       │
│                                                                        │
│  Layer 0.5: Utterance 前処理                          ★精度の核心 1 ★ │
│  ├─ Speech act 分類(assertion/question/agreement/hypothetical/...)   │
│  ├─ Zero-anaphora 解決(省略主語の補完)                              │
│  ├─ 一人称マーカー抽出(僕/私/うち/弊社)                              │
│  └─ 短 turn / 相槌の信頼度減衰                                       │
│                                                                        │
│  Layer 1:   Anchor 識別                                              │
│  ├─ 自己紹介 + 名前/会社名一致 → anchor (confidence 0.99)            │
│  ├─ HEARING_SCHEMA 質問への直接回答 → anchor                         │
│  └─ assertion フラグのものだけ採用                                    │
│                                                                        │
│  Layer 2++: Multi-signal Speaker Re-attribution      ★V2 大改修 ★    │
│  ├─ Entity grounding(0.40 / 最強)                                   │
│  ├─ Q&A pairing(0.30)+ Style fingerprinting(0.20)               │
│  ├─ Bidirectional reference + First-person + Topic-profile           │
│  └─ Discourse markers / Numeric / Pragmatic / ASR ラベル(0.10)     │
│                                                                        │
│  Layer 4:   Multi-perspective 抽出 + Self-consistency                  │
│  ├─ 異なる framing の 2 プロンプトで抽出                             │
│  ├─ confidence 中域(0.5-0.8)の claim だけ n=3 sampling 多数決      │
│  └─ Opus 4.6 + Zod structured output                                  │
│                                                                        │
│  Layer 4.5: Citation Grounding                        ★精度の核心 2 ★ │
│  ├─ source_quote は transcript の実在 substring 必須                   │
│  ├─ claim 内固有名詞は source_quote に出現必須                        │
│  ├─ NLI entailment 検証 (claim が quote から導出可能か)              │
│  ├─ Pragmatic 抽出時は inference_chain 必須                           │
│  └─ V2 追加: speaker-aware grounding(quote の話者が claim subject と一致)│
│                                                                        │
│  Layer 6:   Negative Evidence 適用                                    │
│  ├─ speech_act=assertion の発言からのみ否定 claim 抽出                │
│  ├─ 質問形(「〜されない?」)は self-claim 化しない                    │
│  └─ 第三者への否定は対象外                                            │
│                                                                        │
│  Layer 7:   Confidence Calibration                                    │
│  ├─ attribution × extraction × citation 統合                          │
│  ├─ status 決定: confirmed / candidate / rejected                     │
│  └─ Active learning loop で本人 reject 履歴を温度校正にフィードバック │
│                                                                        │
│  (v3 で追加予定: Cross-meeting validation / Discourse coherence)      │
└────────────────────────────────────────────────────────────────────────┘
```

**設計原則(V2 で 1 つ追加)**:
1. 原典主義 — tl;dv の AI 要約は使用禁止
2. 早期曖昧性除去 — Layer 0.5 で speech act・主語を確定
3. 引用強制 — Layer 4.5 で LLM の hallucination を構文的に遮断
4. 「捨てる」をデフォルト — 抽出根拠が弱ければ抽出しない
5. 本人が最終権威 — AI は候補生成器、確定権は本人
6. **Multi-signal による単一信号脆性の除去 — V2 新規**

---

## 1. 問題設定と失敗モード

### 1.1 入力の特性

tl;dv は音声 diarization で speaker label を付けるが、以下の構造的ノイズを持つ:

| ノイズ種別 | 発生条件 | 影響度 |
|---|---|---|
| Label swap Type A (ASR rapid swap) | 短 turn (<10 単語) / 相槌 / 話題遷移時 | 高 |
| Label swap Type B (要約 re-attribution) | tl;dv AI 要約が topic-based に label を上書き | **致命** |
| Concatenation | 同一 label に複数話者の発言が連結 | 中 |
| 句読点ゼロ | tl;dv 生 transcript は punctuation 無 | 中 |

### 1.2 実測 — 田口 28 分会議で見つかった failure modes

V2 では本会議で **41 件の swap** を実測 (Type A 13 件、Type B 3 件、Type C 25 件 — interview body 全体が systematic に逆転)。詳細は §16 完全 taxonomy 参照。

| ID | 内容 | V1 設計での挙動 | V2 設計での挙動 |
|---|---|---|---|
| C1 | 田口「タバコ吸われない?」(疑問) → sara「吸わないんで」(主張) | Layer 6 negative evidence が田口に「吸わない」を付与(誤) | Layer 0.5 で speech_act=question 判定 → Layer 6 が assertion のみ採用 |
| C2 | sara「僕…シャンパンコール作成…」を tl;dv 要約が「田口の副業」と誤帰属 | full_text に AI 要約を保存 → analyze が田口に attribute | tl;dv 要約使用禁止 + Layer 2++ で entity grounding (シャンパンコール = sara) |
| C3 | 田口「うちのお客さんでコピー機売りたい人がいる…僕らは探したい」(事業構造示唆) | 字義抽出で「コピー機関連顧客」のみ → 事業構造ロスト | Layer 0.5 で主語補完 + pragmatic 抽出 + inference_chain 必須 |
| **C4** (新) | 田口「この相手どうですかっていうことを」(echo) | tl;dv 要約が action_item 化 | Layer 0.5 speech_act=echo で除外 |
| **C5** (新) | 田口モノローグ 17:42-18:09 中の ASR rapid swap | Layer 2 first_person chain で隣接比較のみ → 貫通失敗 | Layer 2++ entity grounding × style fingerprint で全 turn 田口に再 attribute |
| **C6** (新) | (C2 と同根) シャンパンコール再帰属の構造的遮断 | 要約由来の attribution が永続化 | KnownEntities にシャンパンコール = sara 事前登録 → 二重防護 |
| **C7** (新) | 田口の逆質問「マッチングって…」(role reversal) | 田口の自己 claim として誤抽出 | Layer 0.5 speech_act=evaluation + subject_type=project_feedback → user_claims 化せず meeting_feedback テーブルへ |
| **C8** (新) | 田口「吸われない?」(敬語 outward) | Layer 5 が田口に negative attribute | Layer 0.5 keigo_direction + Layer 2++ bidirectional reference → sara claim 確定 |

---

## 2. 各層の詳細仕様

### 2.1 Layer 0: 入力正規化

(V1 と同一)

### 2.2 Layer 0.5: Utterance 前処理 ★

V1 仕様に加え、V2 で `speech_act` enum に以下を追加:

```typescript
speech_act:
  | 'assertion'        // 既存
  | 'question'         // 既存
  | 'agreement'        // 既存
  | 'hypothetical'     // 既存
  | 'reported'         // 既存
  | 'counterfactual'   // 既存
  // V2 追加
  | 'echo'              // 相手発言の predict / 復唱 (C4)
  | 'feedback_request'  // 「〜あれば教えて」「どう思う?」
  | 'evaluation'        // 「面白い」「すごい」(C7)
  | 'meta_dialogue'     // 「最後の質問なんですけど」 会話運営
```

V2 で `keigo_direction: 'self' | 'outward' | null` を追加 (C8 解決のため)。「されない?」 等の honorific question form を outward と判定し、Layer 2++ の bidirectional reference へ供給。

### 2.3 Layer 1: Anchor 識別

(V1 と同一 — anchor 検出器は Layer 2++ にも anchor 候補を投入)

### 2.4 Layer 2++: Multi-signal Speaker Re-attribution ★

**目的**: tl;dv ASR ラベルは noisy(田口 28 分回 17:42-18:09 で同一話者の長 monologue 中に rapid swap 発生)。旧 Layer 2 は first_person_marker 連続性に過依存し、両話者が「僕」を多用するケースで崩壊した。**10 個の独立信号を加重投票**することで、単一信号の脆さを除去する。

#### 2.4.1 信号一覧(信頼度降順)

| ID | 信号 | 重み | 根拠 |
|---|---|---|---|
| **S1** | Entity grounding(固有名詞所有関係。「うちのX社」「弊社のYプロジェクト」が `known_entities` と一致) | **0.40** | 固有名詞 ≒ 一意 ID |
| **S2** | Q&A 隣接対(直前 turn が question → 当該 turn は回答側話者) | 0.30 | 隣接対は文法的制約 |
| **S3** | Style fingerprinting(語彙/句読点/フィラー/長さの cosine 類似) | 0.20 | アンカー後に学習 |
| **S4** | Bidirectional reference(後続 turn の敬語/呼称が当該話者を指す) | 0.20 | look-ahead で曖昧性解消 |
| **S5** | First-person marker chain(旧 Layer 2、降格) | 0.15 | 共有時に無力 |
| **S6** | Topic-profile match(turn 内容が `user_profiles.expertise_tags` と一致) | 0.15 | 専門領域は分離しやすい |
| **S7** | Discourse markers(「では」「なるほどですね」等の会話運営語 → 司会/聞き手側) | 0.10 | 役割推定 |
| **S8** | Numeric/quantitative answer(直前が数値質問 + 当該 turn 数値開始) | 0.10 | Layer 1 anchor の弱版 |
| **S9** | ASR raw label match(旧 0.30 → 降格) | **0.10** | 信頼できない事実が判明 |
| **S10** | Pragmatic 文脈(「うちの」「弊社」「自社」+ 直近 anchor の所属) | 0.10 | 1 人称代用語 |

#### 2.4.2 前処理要件 ★

Layer 2++ 起動前に **`KnownEntities` map を構築必須** (詳細は §17 実装節)。

```typescript
interface KnownEntity {
  surface: string;                    // "アクメ商事" "Project Falcon"
  owner_user_id: string;
  source: 'profile_company' | 'past_company' | 'project_name' | 'invitee_name';
}
```

#### 2.4.3 アルゴリズム(4 phase)

```typescript
async function layer2pp(turns, anchors, entities) {
  // Phase 1: Multi-signal anchor expansion(LLM なし)
  // Phase 2: 話者ごとに style vector を学習
  // Phase 3: 各 turn を 10 信号で採点 → argmax + (top-second)/top で confidence
  // Phase 4: confidence < 0.5 の ambiguous turn のみ LLM holistic review
}
```

#### 2.4.4 出力スキーマ拡張

`meeting_segments.attribution_evidence JSONB` を追加。10 信号の生スコアを全保存(audit / 再校正用)。

#### 2.4.5 Performance

Phase 1-3 は LLM 呼び出しゼロ。Phase 4 のみ ambiguous turn (典型 5-10%) に限定。30 分会議あたり追加コスト **≤ +$0.03**。

#### 2.4.6 検証

**Canonical test**: 田口 28 分回 17:42-18:09。 Expected: 当該区間の全 turn が `resolved_speaker_id = 田口`, confidence > 0.85。

### 2.5 Layer 4: Multi-perspective + Self-consistency

(V1 と同一)

### 2.6 Layer 4.5: Citation Grounding ★

V1 検証 3 段に加え、V2 で **第 4 段「speaker-aware grounding」** を追加:

```typescript
// V2 追加: claim subject と quote 話者が一致するか
if (claim.subject_type === 'self' &&
    quote.speaker_user_id !== claim.attributed_to) {
  return { valid: false, reason: 'speaker_subject_mismatch' };
}
```

C2/C6 (シャンパンコール再帰属) を構造的に遮断する。

### 2.7 Layer 6: Negative Evidence 適用

(V1 + V2 追加: keigo_direction='outward' の question は本人 negative claim にしない)

### 2.8 Layer 7: Confidence Calibration

(V1 と同一)

---

## 3. データスキーマ

V1 schema に加え、V2 で以下を追加:

```sql
-- meeting_segments
ALTER TABLE public.meeting_segments
  ADD COLUMN attribution_evidence JSONB,  -- 10 signal の生スコア
  ADD COLUMN llm_reviewed_at TIMESTAMPTZ,
  ADD COLUMN llm_cost_usd_total NUMERIC(10,6) DEFAULT 0;

-- user_claims
ALTER TABLE public.user_claims
  ADD COLUMN subject_type TEXT CHECK (subject_type IN
    ('self', 'other_participant', 'third_party')) NOT NULL DEFAULT 'self',
  ADD COLUMN as_of_meeting_id UUID,  -- 数値の time-relative 化 (C18)
  ADD COLUMN tainted_by_summary BOOLEAN DEFAULT false;

-- 新規: meeting_feedback (C7 用)
CREATE TABLE public.meeting_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meeting_transcripts(id),
  speaker_user_id UUID NOT NULL REFERENCES user_profiles(id),
  target TEXT NOT NULL,  -- 'interconnect_matching_algo' 等
  suggestion TEXT NOT NULL,
  source_quote TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 新規: known_entities_cache (§17 参照)
CREATE TABLE public.known_entities_cache (
  meeting_id UUID PRIMARY KEY REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  built_at TIMESTAMPTZ DEFAULT now(),
  source_hash TEXT NOT NULL
);
```

---

## 4. ワーカージョブ設計

(V1 と同一 — 新規 `resolve_speakers` job が Layer 2++ を実行、§17 実装節参照)

---

## 5. 検証ケース(田口 28 分会議)

### 5.1 C1: タバコ negative evidence 誤抽出
(V1 と同一)

### 5.2 C2: シャンパンコール attribution swap
(V1 と同一)

### 5.3 C3: コピー機 pragmatic inference
(V1 と同一)

### 5.4 C4: Echo / predictive completion の誤 action_item 化

```
入力:
  sara [23:18]: "...この相手どうですかっていう"
  田口 [23:20]: "この相手どうですかっていうことを、ね"

Layer 0.5 出力:
  turn_23_20: {
    speech_act: 'echo',
    is_short_turn: true,
    confidence_dampening: 0.3,
    note: 'lexical_overlap≥0.8 with prev sara turn'
  }

Layer 4 適用:
  action_item 抽出器は speech_act ∈ {assertion, commitment} のみ採用
  → turn_23_20 は echo として除外

期待 user_claims:
  sara:  []   # action_item 起こさない
  田口:  []   # echo は本人主張ではない

失敗時(旧設計):
  - tl;dv 要約が「sara が田口に対し『この相手はどうですか』と提案予定」と誤 action_item 化
成功時(V2):
  - Layer 0.5 speech_act='echo' で早期破棄
```

### 5.5 C5: 田口 monologue 中の ASR rapid speaker swap

```
入力(tl;dv ラベル, 17:42-18:09 抜粋):
  田口 [17:42]: "別にうちって うちのお客さんのお客さんも探したい..."
  sara  [17:48]: "ラフメーカーさんとして..."          # ← ASR 誤 swap
  田口 [17:52]: "例えばうちのお客さんでコピー機を..."
  sara  [17:57]: "うちに頼ってきてる人がいたら..."     # ← ASR 誤 swap

Layer 2++ entity grounding:
  KnownEntities[田口] = {"ラフメーカー", "うちのお客さん", "僕ら"}
  → sara ラベル turn 内に田口専属 entity 検出
  → S1 score: 田口 +0.40

Layer 2++ style fingerprint:
  田口 anchored turn の n-gram プロファイル(「うち」「〜わけなんですよね」)
  → 17:48 / 17:57 turn と cosine 0.82 → S3 score: 田口 +0.20

統合:
  全 turn 再 attribute → resolved_speaker_id = 田口 (confidence 0.88-0.94)

期待 user_claims:
  田口: business_model claim 1 件 (B2B 仲介)
  sara: 該当 turn 由来 claim 0 件 ✓
```

### 5.6 C6: シャンパンコール — tl;dv 要約由来の DB 汚染遮断

```
ASR ラベル (正しい): sara [26:29]: "僕自分が今やってる仕事として シャンパンコール作成..."
tl;dv AI 要約 (使用禁止対象): "田口さんの副業: シャンパンコールサービス運営"

Layer 0 禁止事項適用:
  - tl;dv summary を full_text に保存しない
  - normalize 入力は ASR turn 配列のみ

KnownEntities 事前登録 (seed):
  KnownEntities[sara] ⊇ {"シャンパンコール"}

Layer 4 抽出:
  claim_text: "sara はシャンパンコール作成を副業として運営"
  subject_type: 'self'
  → sara user_claims に格納

期待 user_claims:
  sara: offering claim 1 件
  田口: []

構造的防護:
  - 要約使用禁止 + ASR ラベル直結 + KnownEntities 二重防護
  - 田口側 claim に流入する経路が存在しない
```

### 5.7 C7: Interview role reversal — 田口 が sara へアーキ提案

```
入力:
  田口 [25:24]: "業界の常識を AI に強めに多めに生成させて
                マッチングに使う方が精度上がるんじゃない?"

Layer 0.5 出力:
  turn_25_24: {
    speech_act: 'evaluation',
    subject_type: 'project_feedback',
    first_person_markers: [],
    addressee: 'sara'
  }

Layer 4 ルーティング:
  if subject_type == 'project_feedback':
    → user_claims には書かない
    → meeting_feedback テーブルへ insert

期待出力:
  user_claims: { 田口: [], sara: [] }
  meeting_feedback:
    { speaker: 田口, target: 'interconnect_matching_algo',
      suggestion: '業界常識を AI に多めに生成させてマッチング精度向上' }
```

### 5.8 C8: 敬語方向解析(「吸われない?」)

```
入力:
  sara  [28:10]: "...お酒もあんまり飲まなくて"
  田口 [28:15]: "じゃあタバコとかも全然吸われない?"

Layer 0.5 出力:
  turn_28_15: {
    speech_act: 'question',
    keigo_direction: 'outward',
    addressee_inference: 'sara'
  }

Layer 2++ bidirectional reference:
  田口 turn の keigo_direction=outward + 疑問形
  → 質問対象 = sara (直前 sara turn の subject に係る)

Layer 6 適用:
  speech_act='question' → negative evidence 抽出スキップ
  ただし addressee=sara の subject として bookmark
  → 直後 sara assertion (28:25 "タバコも吸わないんで") の主語確証に利用

期待 user_claims:
  田口: タバコ関連 0 件 ✓
  sara: negative claim 「タバコ吸わない」(lifestyle, attribution 0.97)
```

---

## 6. 実装ロードマップ

| Phase | 期間 | 対象層 | 既存への影響 |
|---|---|---|---|
| **0: 緊急対応** | 即日 | seed scripts + DB 汚染 audit | tl;dv AI 要約禁止徹底 + §17 SQL audit |
| **1: 前処理層** | 1-2 週 | Layer 0.5 拡張 (echo / keigo_direction) | `meeting_segments` 新設 |
| **2: Speaker++** | 2 週 | **Layer 2++ 全 10 signal 実装** | `resolve_speakers` job + `known_entities_cache` |
| **3: 抽出スキーマ拡張** | 1 週 | Layer 4 + 4.5 (speaker-aware grounding) | `user_claims` + `meeting_feedback` |
| **4: 集約・本人レビュー** | 2 週 | Layer 6+7 + Review UI | aggregate.ts 改修 |
| **5: 運用フィードバック** | 継続 | Active learning loop | correction_log → 月次校正 |
| **v3(将来)** | TBD | Cross-meeting validation / Discourse coherence | C7/C14/C20 OPEN 課題 |

---

## 7. 既知の限界

V1 と同一 (嘘の検出 / 完全な単会議精度 / 全自動運用 / 規制変更 / 言語拡張)。V2 で §16 に **8 個の OPEN 課題** を明示化 (C7, C9, C10, C12, C14, C15, C18, C20)。

---

## 8. 設計判断のログ

(V1 と同一 — V2 で追加した判断は各セクション内に inline で記載)

### 8.6 (V2 新規) なぜ Layer 2++ を 10 signal にしたか

田口 28 分会議の実測で 41 件の swap (うち 25 件は interview body 全体の systematic 逆転 = Type C) が判明。 first_person_marker chain 単独では Type C を貫通できない (両話者「僕」共有)。**Entity grounding (S1) と Style fingerprinting (S3) を主軸に据え、ASR ラベル (S9) を 0.30 → 0.10 に降格** することで、tl;dv の信頼性に依存しない設計に移行。

### 8.7 (V2 新規) なぜ tl;dv 要約だけでなく ASR ラベルも疑うか

設計書 V1 は「tl;dv AI 要約禁止」を強調していたが、実測では **ASR ラベル自体も 60% 程度しか正しくない**ことが判明。ASR ラベルを 1 つの signal (S9, 0.10) として weight ダウンし、entity grounding を 0.40 で主役に据える形式に変更。

### 8.8 (V2 新規) なぜ C7 を別 table (meeting_feedback) に分離したか

田口 が sara のプロダクトに評価を加える「役割逆転」 シーンで、 評価発言が 田口 の business profile に混入すると マッチング条件 が歪む。`subject_type='project_feedback'` で構造的に user_claims から排除し、 別 table に蓄積することで、 製品改善ループにも活用可能にする (一石二鳥)。

---

## 9. 関連ドキュメント

- `SCORING_V2_ARCHITECTURE.md` — 下流のマッチングスコア設計
- `ARCHITECTURE_CURRENT.md` — システム全体の現状
- `supabase/migrations/00002_scoring_v3.sql` — 既存 prompt v3.0.0
- `supabase/migrations/00057_link_aggregate_enqueue.sql` — aggregate job 連鎖
- `supabase/migrations/00061_quarantine_summary_tainted_claims.sql` — V2 Phase 0 (§17 参照)
- `supabase/migrations/00062_known_entities_cache.sql` — V2 cache (§17 参照)
- `src/lib/profile-extraction/entity-grounding.ts` — V2 KnownEntities builder (§17 参照)
- `src/lib/tldv/process-meeting.ts` — tl;dv 取込パイプライン現状
- `worker/src/handlers/analyze.ts` — claim 抽出ジョブ(改修対象)
- `worker/src/handlers/resolve-speakers.ts` — V2 新規 (§17 参照)
- `docs/eval/groundtruth-meeting-{id}.yaml` — V2 評価用 ground truth (§10 参照)
- `tests/eval/profile-extraction/failure-modes-v1.yaml` — V2 §16 から派生

---

## 10. 評価方法 (V2 新設)

「90 点精度」という主張を測定可能な形に分解し、ground truth に照らして検証可能な評価体系を定義する。

### 10.1 評価対象の分解

「90 点」は単一指標ではなく、以下 7 サブ指標の加重合成として扱う。

| # | 指標 | 定義 | Target |
|---|------|------|--------|
| M1 | Attribution precision | 「X が言った」と出力した発言のうち、実際に X が言ったものの比率 | ≥ 0.95 |
| M2 | Attribution recall | 実際に X が言った発言のうち、抽出できた比率 | ≥ 0.85 |
| M3 | Claim extraction precision | 抽出 claim のうち、原発言から論理的に導かれるもの | ≥ 0.99 |
| M4 | Claim extraction recall | ground truth claim のうち抽出できた比率 | ≥ 0.80 |
| M5 | Citation grounding accuracy | source_quote が transcript に文字列一致 **かつ** 話者帰属正しい | ≥ 0.98 |
| M6 | Speech act classification F1 | 4 クラス macro F1 | ≥ 0.85 |
| M7 | Action item FP rate | 「タスク化すべきでない発言」を action item にした率 | ≤ 0.05 |

総合スコア = `0.25·M1 + 0.15·M2 + 0.25·M3 + 0.10·M4 + 0.15·M5 + 0.05·M6 + 0.05·(1−M7)`。

### 10.2 Ground truth dataset 仕様

- **規模**: 最低 30 meeting (hearing 12 / sales 8 / casual 6 / internal 4)
- **アノテーション単位**: turn 毎の speaker ラベル + meeting 全体の ground truth claim list
- **アノテーター**: 一次 = 本人, 二次 = 第三者 (admin)
- **IAA**: Cohen's κ ≥ 0.80 を採用条件
- **格納**: `docs/eval/groundtruth-meeting-{meeting_id}.yaml`

### 10.3 Baseline 定義

| Baseline | 内容 | 字面正解率 | 幻覚率 |
|----------|------|-----------|--------|
| B0 | tl;dv AI 要約を素朴分解 (田口 28 分会議実測) | 88% | 12% |
| B1 | 本書 V1 設計の素朴実装 | 測定対象 | 測定対象 |
| **Target (V2)** | B1 が達成すべき水準 | **≥ 95%** | **< 1%** |

### 10.4 評価カデンス

- **Per-PR (smoke)**: CI で 1 meeting (固定 `meeting_id=001-taguchi-28min`)
- **週次 full eval**: 全 30 meeting、Slack に metric 投稿
- **月次 review session**: 失敗ケースを人間レビュアと突合

### 10.5 Active learning loop との接続

- reject 結果を `correction_log` に記録
- 月次 retrain で few-shot 追加
- 改訂 prompt は eval dataset で **regression test** 全 pass 必須

### 10.6 失敗時 alert (SLI/SLO)

| Signal | Threshold | Severity |
|---|---|---|
| M3 (claim precision) | 3 週連続で −5pt 以上低下 | P1 |
| 幻覚率 (1 − M3) | 任意週で > 5% | **P0** |
| M5 (citation grounding) | 単週 < 0.95 | P1 |

### 10.7 評価環境 (dev → staging → prod)

| Env | データ | 用途 |
|-----|--------|------|
| dev | ローカル + 3 meeting sample | プロンプト改訂時の手元検証 |
| staging | full eval dataset (30 meetings) | PR merge 前 / weekly |
| **prod (shadow)** | 本番 live meetings | 新パイプライン出力を旧と並走比較 |

---

## 11. コスト・レイテンシ予算 (V2 新設)

**前提**: Opus 4.6 単価 $15/Mtok in / $75/Mtok out、Haiku 4.5 単価 $1/Mtok in / $5/Mtok out。1 USD = 155 JPY。実測は田口 28 分会議。

### 11.1 1 会議あたりのコスト内訳

| Layer | 用途 | calls | モデル | 小計 (USD) |
|---|---|---:|---|---:|
| 0.5 | 全 turn speech-act 分類 | 1 | Opus | $0.228 |
| 1+2++ | anchor + propagation | 1.5 | Opus | $0.158 |
| 4 (multi-persp) | 抽出 ×2 視点 | 2 | Opus | $0.375 |
| 4 (self-consist) | 上位 20% 主張 ×n=3 | 3 | Opus | $0.203 |
| 4.5 | NLI grounding ×25 主張 | 25 | Opus | $0.244 |
| 7 | 統合 (rule-based) | 0 | — | $0.000 |
| **素朴合計** | | | | **$1.21** |
| **最適化後 (§11.4)** | | | | **$0.27** |

### 11.2 月次・年次予算試算 (最適化後 $0.27/meeting)

| 規模 | 月額 USD | 月額 JPY | 年額 USD | 年額 JPY |
|---:|---:|---:|---:|---:|
| 100 件/月 | $27 | ¥4,185 | $324 | ¥50,220 |
| 500 件/月 | $135 | ¥20,925 | $1,620 | ¥251,100 |
| 1,000 件/月 | $270 | ¥41,850 | $3,240 | ¥502,200 |
| 5,000 件/月 | $1,350 | ¥209,250 | $16,200 | ¥2,511,000 |

### 11.3 レイテンシ目標 (SLO)

30 分会議 → user_claims (candidate) 表示までの **p99 ≤ 10 min**。

### 11.4 コスト削減戦略

1. **Layer 0.5 を Haiku 4.5 へ**: $0.228 → $0.015 (15x 削減)
2. **Layer 4 ハイブリッド self-consistency**: $0.203 → $0.060
3. **Layer 4.5 NLI のルール優先**: $0.244 → $0.055
4. **Session-level caching**: 同一 turn の Layer 0.5 結果共有

### 11.5 コストキャップポリシー

- **Per-meeting hard cap**: $1.00
- **月次 budget alert**: 80% / 100%
- **Degraded mode**: cap 超過時は Layer 4 self-consistency skip

### 11.6 LLM 障害時の fallback

| 優先 | 経路 |
|---|---|
| Primary | Opus 4.6 |
| Fallback 1 | Haiku 4.5 (`confidence` 上限 0.6, `candidate` 固定) |
| Fallback 2 | Job queue 再投入 (最大 24h) |
| All-failure | `meeting_segments.status='pending_llm'` |

### 11.7 Cold start / surge

- worker concurrency = 5
- Anthropic API tier 4 = 100k input tpm
- 同時 6 会議で tier 上限到達 → concurrency 5 が安全マージン

---

## 12. プライバシー / 同意モデル (V2 新設)

### 12.1 同意モデル — 3 段階

| Stage | 対象 | 扱い |
|---|---|---|
| 1 | INTERCONNECT 会員の自己 claim | 抽出 → 本人レビュー → confirmed |
| 2 | 非会員参加者の発言 | claim 生成スキップ |
| 3 | **第三者言及 (非参加者)** | **絶対に user_claims 化しない** |

### 12.2 第三者言及の検出と削除

- Layer 4 prompt: `subject_type='third_party'` enum 必須
- Layer 4.5: `subject_type !== 'self'` の claim は即 reject
- 判定: 名前 / 役職表現が `meeting_participants` invitee リスト外 → third party

### 12.3 機密情報の自動マスキング

| 種別 | 処理 |
|---|---|
| 金額 (年商/単価) | 会員間共有時はレンジ化 (`1-10億`) |
| 連絡先 | email/phone/SNS ID は claim text に含めない |
| 顧客名 / 取引先名 | `redacted_company_N` で置換 |

### 12.4 既存データの retroactive cleanup

Phase 0 緊急対応:
1. `transcript_insights` / `member_ai_profiles_v2` 全件 LLM scan
2. third_party 由来 claim を `soft_deleted_at` で論理削除
3. script: `scripts/audit-and-redact-third-party-claims.ts`
4. **4 週間以内に完遂**

### 12.5 ユーザーコントロール UI

- 各 user_claim を本人が hide / edit / delete
- "私の AI プロフィール" で全 claim を時系列表示
- "全 claim 削除" → `purge_ai_data_on_delete()` RPC trigger

### 12.6 法的根拠

- **個人情報保護法 第 27 条**: 第三者提供制限 → §12.2 で構造遮断
- **GDPR Art. 6(1)(a)**: 明示同意ベース
- **DPIA**: §12.4 完了後に法務レビュー必須

### 12.7 セキュリティ

- RLS: owner + admin + service_role (Wave14 P0-1/P0-2 修正済)
- 監査ログ: 誰が誰の claim を read したか `audit_logs` に記録
- 暗号化: at-rest AES-256 + in-transit HTTPS

### 12.8 越境移転 (Anthropic API)

- Anthropic API は US 拠点 → 越境移転該当
- `legal/accept` で本人同意取得済
- データ最小化: 越境送出は `meeting_segments` の発話単位のみ、氏名は `participant_N` マスク
- **5 年以上経過の claim は Anthropic 経由 reanalyze 禁止**

---

## 13. 移行戦略と Rollback (V2 新設)

### 13.1 移行スケジュール (Phase 0-5)

```
Week:        0    1    2    3    4    5    6    7    8    9   10   11+
Phase 0 ▓ (即日, 継続監視)
Phase 1     ▓▓▓▓▓▓▓▓▓▓ (1-2w: meeting_segments + Layer 0.5)
Phase 2               ▓▓▓▓▓▓▓▓▓▓ (2w: Layer 2++ deploy)
Phase 3                         ▓▓▓▓▓ (1w: user_claims + Layer 4+4.5)
Phase 4                              ▓▓▓▓▓▓▓▓▓▓ (2w: aggregate + review UI)
Phase 5                                            ▓▓▓▓▓▓▓ (継続)
Shadow                ░░░░░░░░░░░░░░░░░░░░░░░░░░ (Phase 1-4 並走)
Switchover gate ───────────────────────────────▲ (Phase 4 終了時)
```

### 13.2 並走運用 (Shadow → Switchover)

- Phase 1-4 は **shadow mode**: `eval_claims_shadow` テーブルに書く、 `user_offerings` は更新しない
- admin dashboard で 旧 vs 新 を並列比較
- Phase 4 終了時に switchover gate 評価 (§13.4)

### 13.3 既存データ backfill

- 過去 6 ヶ月の `meeting_transcripts` (1,000-3,000 件) を新 pipeline で再処理
- 月次 batch、 100 meetings/day で 30-90 日
- 旧テーブル overwrite せず `user_claims_v2_backfill` に蓄積

### 13.4 切替判定 (Switchover Criteria)

**必須 (all-pass)**:
- Attribution precision ≥ 92%
- Claim precision ≥ 92%
- 幻覚率 ≤ 1%
- p99 latency ≤ 10 min
- 連続 alert なし期間 ≥ 28 日
- 第三者言及検出 working

**推奨**:
- 30 件の eval dataset で 100% pass
- admin reviewer 5 名の sign-off
- shadow precision ≥ 旧 baseline + 10pt

### 13.5 Rollback Plan

**即時 trigger**:
- P0 alert (幻覚率 > 5%)
- 本人 reject 率 > 20% (24h)
- LLM API 連続失敗

**手順**:
1. feature flag `USE_NEW_PIPELINE=false`
2. job_queue worker を旧 `analyze.ts` に再 route
3. user_claims 書込み停止 (`status='paused'`)
4. 既存 user_offerings は旧 path で継続
5. 1 時間以内 observation、 24 時間後 RCA

### 13.6 Cut-over Communication

- **1 週間前**: 全 user にメール + アプリ内通知
- **移行中**: dashboard banner で進捗表示
- **移行後**: 本人レビュー UI で 「以前と何が変わったか」 diff 表示

### 13.7 既存 RPC との互換性

- 既存 RPC (`onboarding_finalize_95` 他) は `user_offerings/goals` に書く
- **sync trigger**: `AFTER INSERT OR UPDATE ON user_claims WHEN status='confirmed' → INSERT/UPDATE user_offerings/goals`
- **片方向 (新 → 旧)** のみ。 循環書込み防止

### 13.8 失敗時の責任分担

| Role | 責務 |
|---|---|
| Tech lead | rollback 判断と実行 |
| Product | ユーザー対応 message 作成 |
| On-call | 24/7 monitoring |
| Data | eval dashboard 確認 |

---

## 14. 監視 (Observability) と SLO (V2 新設)

### 14.1 SLI 定義

| ID | 指標 |
|---|------|
| SLI-1 | meeting → user_claims (candidate) latency (p50/p95/p99) |
| SLI-2 | per-layer success rate |
| SLI-3 | per-meeting LLM cost ($) |
| SLI-4 | attribution precision (eval) |
| SLI-5 | claim extraction precision (eval) |
| SLI-6 | hallucination rate (eval) |
| SLI-7 | user rejection rate (本人 UI) |
| SLI-8 | job queue depth |

### 14.2 SLO 目標値

| ID | SLO | 評価窓 |
|---|---|---|
| SLO-1 | p99 latency ≤ 10 min | 7 日 |
| SLO-2 | per-layer success ≥ 99% | 24h |
| SLO-3 | per-meeting cost ≤ $0.50 | 1 meeting |
| SLO-4 | attribution precision ≥ 92% | weekly |
| SLO-5 | claim precision ≥ 90% | weekly |
| SLO-6 | hallucination rate ≤ 1% | weekly |
| SLO-7 | user rejection rate ≤ 15% | 7 日 |
| SLO-8 | queue depth ≤ 100 | 5 分 |

### 14.3 Dashboards (Grafana + PostgreSQL backend)

- Pipeline health, Cost tracker, Quality, User feedback の 4 view

### 14.4 Drift detection

週次で baseline と比較:
- claim_text 平均文字数
- taxonomy_tags 分布
- final_confidence 分布

**Z-score > 3** で alert。

### 14.5 アラート定義

| 重要度 | 条件 | 通知 |
|---|---|---|
| **P0** | hallucination > 5%, p99 > 1h, cost > $5/件 | PagerDuty |
| **P1** | precision < 85% (3日), reject > 25%, queue > 500 | Slack |
| **P2** | drift z > 3 (2週連続) | Slack 週次 |

### 14.6 ロギング規約

構造化 JSON ログ:
```json
{"type":"llm_call","meeting_id":"...","layer":"4","model":"claude-opus-4-6",
 "input_tokens":1234,"output_tokens":567,"latency_ms":8421,"cost_usd":0.0234}
```

機密フィールド (claim_text) はマスク、 ID のみログ出力。

### 14.7 audit_logs との連携

本人レビュー UI の操作 (claim confirm/reject/編集) を `audit_logs` に記録 — GDPR データアクセス記録兼用。

### 14.8 Incident response runbook

Slack `#intercom-ai-pipeline`、 P0 は 15 分以内 1st response。

---

## 15. LLM 障害ハンドリング (V2 新設)

### 15.1 想定障害シナリオ

| ID | シナリオ |
|---|---|
| F1 | Anthropic API 一時障害 (5xx/502/503/529) |
| F2 | Rate limit (429) |
| F3 | Token budget overflow |
| F4 | Malformed JSON (zod parse fail) |
| F5 | Refusal / safety block |
| F6 | 部分失敗 |
| F7 | Network timeout |
| F8 | Hallucination 多発 (regression) |

### 15.2 Per-layer retry policy

- Layer 0.5: 3 retry (1s/3s/10s exponential)、全失敗で `speech_act='unknown'` で進む
- Layer 4: 5 retry、 全失敗で meeting `status='failed'`
- Layer 4.5: 単発失敗は rule-based で代替

### 15.3 Partial failure handling

- 80%+ 成功時: 成功 turn のみ書込、 失敗 turn は `status='partial_failure'`
- 80% 未満: meeting 全体 retry

### 15.4 Fallback model chain

| 段階 | Model |
|---|---|
| P | Opus 4.6 |
| F1 | Haiku 4.5 (after 3 retry) |
| F2 | Opus 4.5 (旧) |
| F3 | 手動キュー |

### 15.5 Malformed output recovery

1. 1st fail: prompt に強調 + 1 retry
2. 2nd fail: temperature 0.7 → 0.3
3. 3rd fail: Haiku escalate

### 15.6 Safety / refusal

- refusal pattern を検出 → `status='extraction_blocked'`
- 本人レビュー UI に「AI が分析対象外と判定」
- retry しない

### 15.7 Token budget overflow

- 200K tokens 超 → 10 分 window で chunk 分割
- chunk 間 speaker resolution を aggregate で連続化

### 15.8 Hallucination outbreak (regression)

- 自動 action: Primary → Haiku に switch、 eval dataset で regression test、 LLM provider に report
- 該当時間帯出力を `quarantine` 化

### 15.9 Dead-letter queue (DLQ)

- 全 fallback 失敗 → `dlq_meetings`
- 日次で admin が手動確認
- 30 日経過後 S3 archive

### 15.10 User-facing メッセージ

| 状態 | dashboard 表示 |
|---|---|
| 通常 retry (<10min) | "AI 分析を再試行中" |
| 遅延 (>30min) | "分析が遅延しています。ETA: HH:MM" |
| 全 fallback 失敗 | "手動 review 中" |

「エラー / 失敗」 という単語は ユーザに出さない。

---

## 16. 失敗モード Taxonomy 完全版 (V2 新設)

### 16.1 一覧表

| ID | Cat | Name | Root cause | Handled by V2 |
|---|---|---|---|---|
| C1 | Attr | Speech act 誤分類 | 敬語疑問形未識別 | L0.5 speech_act + L6 assertion-only |
| C2 | Attr | tl;dv 要約 cross-speaker swap | 要約 full_text 混入 | L0 要約禁止 + L2++ entity grounding |
| C5 | Attr | ASR rapid swap during monologue | diarization 閾値振動 | L0.5 is_short_turn + L2++ multi-signal |
| C6 | Attr | Echo / predictive completion | claim / backchannel 境界曖昧 | L0.5 echo + L6 除外 |
| C7 | Attr | Interview role reversal | Q&A 交互前提崩壊 | **OPEN**: v3 anchor 再評価 trigger |
| C8 | Attr | Honorific direction misread | 敬語の二人称省略 | L0.5 keigo_direction + L2++ bidirectional |
| C3 | Prag | Literal-only extraction | 字義のみ抽出 | L4 pragmatic + inference_chain 必須 |
| C9 | Prag | Sarcasm / 自己卑下 | modality=hedge 未分類 | **OPEN**: L0.5 hedge tag |
| C10 | Prag | Hedge / mitigation | modality 二値 | **OPEN**: extraction_confidence dampening |
| C11 | Prag | Counterfactual reasoning | speech_act 未使用 | L0.5 counterfactual + L6 除外 |
| C12 | Prag | Generic 'you' vs addressee | 主語ゼロ解決誤り | **OPEN**: L0.5 generic ラベル |
| C4 | Topic | Feedback solicitation 誤 action-item 化 | question を action 化 | L0.5 question + L6 除外 |
| C13 | Topic | Compound HEARING 回答 | 1:1 前提 | L4 prompt で 1-to-N 許容 |
| C14 | Topic | Topic transition abrupt | discourse 不連続 | **OPEN**: v3 Discourse coherence |
| C15 | Topic | Polite small talk が claim 化 | meta-talk 未分離 | **OPEN**: L0.5 is_metatalk |
| C16 | Entity | 「うち」多義 | 多義語の文脈解決 | L0.5 resolved_subject (部分対応) |
| C17 | Entity | Third-party の self-claim 化 | subject_type 推論誤り | L4 subject_type='customer' 強制 |
| C18 | Entity | 数値の time-relative permanent 化 | as_of 欠落 | **OPEN**: structured_facts.as_of_meeting_id |
| C19 | Schema | 日英 code-switch | embedding 揺れ | taxonomy_v2 alias 辞書 (部分対応) |
| C20 | Schema | 句読点ゼロ問題 | tl;dv 仕様 | **OPEN**: L0 文区切り推論 |

### 16.2 OPEN 課題 (v3 で対応)

V2 で未対応: **C7, C9, C10, C12, C14, C15, C18, C20**。 うち 4 件 (C9/C10/C15/C18) は L0.5 / schema 拡張で吸収可能 (中規模)。 残り 4 件 (C7/C12/C14/C20) は L0.5+L2+v3 Discourse の合作 (大規模)。

### 16.3 Eval dataset YAML

```yaml
# tests/eval/profile-extraction/failure-modes-v1.yaml
version: 1
transcript_ref: taguchi_28min_2026Q1
cases:
  - id: C1
    turn_ts: "28:15"
    input: "じゃあタバコとかも全然吸われない?"
    expect: { speech_act: question, negative_claim_for_speaker: null }
  - id: C2
    turn_ts: "26:29"
    input: "僕自分が今やってる仕事として シャンパンコール作成"
    expect: { resolved_speaker: sara, taguchi_claim_count: 0 }
  - id: C3
    turn_ts: "17:42-18:09"
    expect:
      taguchi_claims_include:
        primary_type: business_model
        taxonomy_tags: [client_intro, sales_support]
  - id: C4
    turn_ts: "25:50"
    input: "これってどう思います?"
    expect: { action_items: [], speech_act: question }
  - id: C5
    turn_ts: "17:55"
    note: 1.2s sara-labeled "あー" mid monologue
    expect: { is_backchannel: true, excluded_from_chain: true }
  - id: C7
    turn_ts: "12:08"
    expect: { anchor_reassessed: true }  # OPEN v3
  - id: C8
    turn_ts: "28:15"
    expect: { addressee: sara, self_neg_for_taguchi: false }
```

(C1-C20 全件は `tests/eval/profile-extraction/failure-modes-v1.yaml` 参照)

---

## 17. Phase 0 実装ガイド (V2 新設)

### 17.1 SQL audit migration

`supabase/migrations/00061_quarantine_summary_tainted_claims.sql`:

```sql
-- 00061: Phase 0 — tl;dv 要約由来の汚染 claim を quarantine

ALTER TABLE public.member_ai_profiles_v2
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS quarantine_reason text,
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz;

CREATE OR REPLACE VIEW admin_summary_tainted_candidates AS
SELECT
  p.id, p.user_id, p.claim_text, p.source_quote, p.source_meeting_id,
  p.attribution_confidence, p.created_at,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.claim_text ~ '(述べています|考えています|行っており|していると話し|語っています)'
         THEN 'summary_predicate' END,
    CASE WHEN length(p.source_quote) >= 200
              AND p.source_quote !~ '(「|」|"|")'
         THEN 'narrative_quote' END,
    CASE WHEN p.attribution_confidence IS NULL
              OR p.attribution_confidence = 1.0
         THEN 'unconfident_or_legacy' END,
    CASE WHEN NOT EXISTS (
            SELECT 1 FROM meeting_segments s
             WHERE s.meeting_id = p.source_meeting_id
          ) THEN 'no_segments' END
  ], NULL) AS taint_flags
FROM member_ai_profiles_v2 p
WHERE p.status = 'active';

UPDATE member_ai_profiles_v2 p
   SET status            = 'quarantine_summary_taint',
       quarantine_reason = (
         SELECT array_to_string(taint_flags, ',')
           FROM admin_summary_tainted_candidates c
          WHERE c.id = p.id
       ),
       quarantined_at    = now()
 WHERE p.status = 'active'
   AND p.id IN (
     SELECT id FROM admin_summary_tainted_candidates
      WHERE array_length(taint_flags, 1) >= 2
   );
```

### 17.2 TypeScript audit wrapper

`scripts/audit-summary-tainted-claims.ts` — dry-run / --apply の 2 段操作。 詳細実装は別途参照。

### 17.3 Entity Grounding pre-processor

`src/lib/profile-extraction/entity-grounding.ts`:

```typescript
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface KnownEntities {
  ownership: Map<string, string>;
  participantNames: Map<string, string>;
  projects: Map<string, string>;
  thirdPartyKeywords: Set<string>;
}

const STATIC_THIRD_PARTY = new Set([
  "お客さん", "顧客", "うちの顧客", "クライアント",
  "相手", "先方", "取引先", "彼", "彼ら", "彼女",
  "あの人", "あいつ", "うちのお客様",
]);

function expandNameAliases(fullName: string): string[] {
  const parts = fullName.split(/[\s　]+/).filter(Boolean);
  const out = new Set<string>([fullName]);
  for (const p of parts) { out.add(p); out.add(`${p}さん`); }
  if (parts.length >= 2) out.add(parts.join(""));
  return [...out];
}

export async function buildKnownEntities(
  meetingId: string,
  sb?: SupabaseClient,
): Promise<KnownEntities> {
  const supabase = sb ?? createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const ownership = new Map<string, string>();
  const participantNames = new Map<string, string>();
  const projects = new Map<string, string>();

  const { data: parts } = await supabase
    .from("meeting_participants")
    .select(`
      user_id, invitee_name, invitee_email,
      user_profiles:user_id (
        full_name, display_name,
        company, past_company, project_name, service_name
      )
    `)
    .eq("meeting_id", meetingId);

  for (const part of parts ?? []) {
    const uid = part.user_id as string;
    const prof = (part as any).user_profiles ?? {};
    const names = [prof.full_name, prof.display_name, part.invitee_name]
      .filter(Boolean) as string[];
    for (const n of names) {
      for (const alias of expandNameAliases(n)) participantNames.set(alias, uid);
    }
    for (const noun of [prof.company, prof.past_company, prof.project_name, prof.service_name]
      .filter((s: any): s is string => !!s && s.trim().length >= 2)) {
      ownership.set(noun, uid);
    }
    if (prof.project_name) projects.set(prof.project_name, uid);
  }

  const userIds = [...new Set((parts ?? []).map((p: any) => p.user_id))];
  const { data: claims } = await supabase
    .from("user_claims")
    .select("user_id, entity_noun")
    .in("user_id", userIds)
    .eq("status", "confirmed")
    .eq("claim_type", "owns");
  for (const c of claims ?? []) {
    if (c.entity_noun) ownership.set(c.entity_noun, c.user_id as string);
  }

  return {
    ownership,
    participantNames,
    projects,
    thirdPartyKeywords: new Set(STATIC_THIRD_PARTY),
  };
}
```

### 17.4 Worker handler

`worker/src/handlers/resolve-speakers.ts`:

```typescript
import { buildKnownEntities } from "../../../src/lib/profile-extraction/entity-grounding";
import { supabase } from "../queue";

export async function resolveSpeakers(meetingId: string) {
  const entities = await buildKnownEntities(meetingId, supabase as any);
  const { data: segments } = await supabase
    .from("meeting_segments")
    .select("id, text, has_first_person, raw_speaker")
    .eq("meeting_id", meetingId)
    .order("start_ms");

  for (const seg of segments ?? []) {
    const scores = new Map<string, number>();
    const bump = (uid: string, d: number) =>
      scores.set(uid, (scores.get(uid) ?? 0) + d);

    // S1: entity grounding + 一人称
    for (const [noun, uid] of entities.ownership) {
      if (seg.text.includes(noun) && seg.has_first_person) bump(uid, 0.40);
    }
    // S10: 参加者名 → 第三者言及 (発話者ではない)
    for (const [alias, uid] of entities.participantNames) {
      if (seg.text.includes(alias)) bump(uid, -0.25);
    }
    // 第三者キーワード → ownership 増分を取り消す
    const hasThirdParty = [...entities.thirdPartyKeywords]
      .some((kw) => seg.text.includes(kw));
    if (hasThirdParty) for (const k of scores.keys()) bump(k, -0.30);

    const [best] = [...scores].sort((a, b) => b[1] - a[1]);
    if (best && best[1] >= 0.35) {
      await supabase.from("meeting_segments")
        .update({ speaker_user_id: best[0], speaker_confidence: best[1] })
        .eq("id", seg.id);
    }
  }
}
```

### 17.5 Cache migration

`supabase/migrations/00062_known_entities_cache.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.known_entities_cache (
  meeting_id   uuid PRIMARY KEY REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
  payload      jsonb NOT NULL,
  built_at     timestamptz NOT NULL DEFAULT now(),
  source_hash  text NOT NULL
);

CREATE INDEX IF NOT EXISTS known_entities_cache_built_at_idx
  ON known_entities_cache(built_at);

ALTER TABLE known_entities_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_known_entities"
  ON known_entities_cache
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
```

---

**ドキュメントバージョン**: V2
**最終更新**: 2026-05-15
**承認状態**: 設計段階、実装未着手 (Phase 0 即日着手対象)
**前バージョン**: `ARCHITECTURE_PROFILE_EXTRACTION_V1.md` (2026-05-12)
**Changelog**: 本文先頭の Changelog 表参照

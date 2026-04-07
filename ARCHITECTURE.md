# INTERCONNECT アーキテクチャ設計書

**最終更新**: 2026-04-04
**設計根拠**: 20+エージェント × 8ラウンドの深層分析・シミュレーションに基づく
**コード状態**: 86ファイル / 6,665行 / TS 0エラー / ビルド成功

---

## 1. システム全体像

```
┌─────────────────────────────────────────────────────────────┐
│                      ユーザー (ブラウザ)                       │
│  Next.js 16 App Router + shadcn/ui v4 + Tailwind 4          │
│  proxy.ts (認証ガード) → (public) | (auth) ルートグループ      │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────┐
│                    Render Web Service                        │
│  Next.js API Routes (/api/v1/*)                             │
│  withAuth() → Supabase getUser() → RLS付きクエリ             │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────────┐
        ▼              ▼                  ▼
┌──────────────┐ ┌──────────┐ ┌─────────────────────┐
│ Supabase     │ │ Supabase │ │ Supabase Storage    │
│ PostgreSQL   │ │ Auth     │ │ avatars / covers    │
│ + Realtime   │ │ Email+FB │ │                     │
└──────┬───────┘ └──────────┘ └─────────────────────┘
       │
       │ service_role (RLSバイパス)
       │
┌──────▼───────────────────────────────────────────────────────┐
│                    Render Worker (常駐)                       │
│  PostgreSQLジョブキュー → analyze → aggregate → score → notify │
└──────────────────────┬───────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ tl;dv API    │ │ Claude   │ │ Render Cron  │
│ transcripts  │ │ Sonnet   │ │ JST 9/12/15/18│
└──────────────┘ │ 4.6      │ └──────────────┘
                 └──────────┘
```

---

## 2. 双方向スコアリング

### 2.1 設計判断の経緯

| 論点 | 初期設計 | 最終決定 | 根拠 |
|------|---------|---------|------|
| 軸数 | 5軸 | **2軸** | 因子分析的に needs+skill=「有用性」、comm+engagement+history=「親和性」の2因子に集約される。5軸は実効次元2.5で冗長 |
| 類似度計算 | ビッグラムJaccard | **カテゴリタグ** | 日本語15ペアの実精度テストでJaccard MAE=0.52（壊滅）、カテゴリタグ MAE=0.09 |
| score_reasons | Claude API生成 | **テンプレート** | 500人でClaude生成は月$112。テンプレートは$0 |
| スコア表示 | 5軸バー+数値 | **理由テキストのみ** (デフォルト) | LinkedIn/YENTA/Eightいずれも数値非表示。成功プロダクトの共通パターン |
| 信頼度 | なし (fallback=50) | **ベイズshrinkage** | analysis_count少のスコアを事前分布(50)に縮約。データ不足時の過信を防止 |
| ジョブキュー | 未定義 | **PostgreSQL** | 追加インフラ$0。SELECT FOR UPDATE SKIP LOCKEDで十分な性能 |

### 2.2 2軸モデル

```
value_fit (重み 60%)
  「相手が自分のニーズ/課題を解決できる度合い」
  旧 needs_fulfillment + skill_complementarity を統合
  非対称: A→B ≠ B→A（Aのニーズ×Bの提供 vs Bのニーズ×Aの提供）

relational_quality (重み 40%)
  「コミュニケーション相性 + 交流の深さ」
  旧 communication_compatibility + engagement_quality + interaction_history を統合
  対称成分(comm差分, 会議回数) + 非対称成分(engagement評価)の混合
```

### 2.3 カテゴリタクソノミー (50種)

Claude Sonnet 4.6 が transcript_insights 抽出時に付与。追加トークン+400-600/分析、追加コスト+$1/月(500分析)。

| # | 大カテゴリ | サブカテゴリ |
|---|----------|------------|
| 1 | sales 営業 | sales_strategy, sales_channel, sales_management |
| 2 | marketing | digital_marketing, branding, content, analytics |
| 3 | technology | software_dev, infrastructure, data_ai, security |
| 4 | finance | accounting, fundraising, financial_planning |
| 5 | hr 人事 | recruiting, talent_dev, labor_mgmt, culture |
| 6 | legal 法務 | corporate_law, ip, compliance |
| 7 | operations | supply_chain, quality, project_mgmt |
| 8 | strategy | business_dev, m_and_a, international |
| 9 | design | ux_ui, product_design, creative |
| 10 | industry 業界 | healthcare, realestate, manufacturing, education, energy |
| 11 | leadership | executive, mentoring, change_mgmt |
| 12 | other | other |

**カテゴリマッチ計算:**
- 完全一致 (category + subcategory): 1.0
- 大カテゴリ一致 (category のみ): 0.5
- 不一致: 0.0
- 各項目に frequency重み(1回=1.0, 2回=2.0, 3回+=3.0) × 時間減衰(3ヶ月:1.0, 6ヶ月:0.7, 超:0.4) × confidence(0-1) を乗算

**ニッチスキル:** `other` にフォールバック。`text` フィールドで自由記述を保持。Phase 2 で pgvector embedding を追加しハイブリッド化。

### 2.4 スコア計算フロー

```typescript
function computeScore(viewer, target) {
  // ── Phase判定 ──
  const vCount = viewer.aiProfile?.analysis_count ?? 0;
  const tCount = target.aiProfile?.analysis_count ?? 0;
  const minCount = Math.min(vCount, tCount);
  const alpha = minCount === 0 ? 0.0
              : minCount <= 4 ? 0.2 * minCount
              : 0.85;

  // ── 属性スコア (常に計算) ──
  const hasBio = !!viewer.bio && !!target.bio;
  const [wI, wR, wB] = hasBio ? [0.35, 0.35, 0.30] : [0.50, 0.50, 0.0];
  const attrVF = wI * industryAffinity(viewer, target)
               + wR * roleComplement(viewer, target)
               + wB * bioKeywordOverlap(viewer, target);
  const attrRQ = 0.50; // 属性のみでは関係性品質は中立

  // ── AIスコア (hybrid/ai_primary時) ──
  let aiVF = 0, aiRQ = 0;
  if (minCount > 0) {
    const needsFulfill = categoryMatch(viewer.needs, target.offerings);
    const skillComplement = categoryMatch(viewer.skills, target.skills, "complement");
    aiVF = 0.60 * needsFulfill + 0.40 * skillComplement;

    const commCompat = commCompatibility(viewer.commProfile, target.commProfile);
    const engagementQ = engagementScore(viewer, target);
    aiRQ = 0.50 * commCompat + 0.50 * engagementQ;
  }

  // ── ベイズ shrinkage ──
  const conf = Math.min(minCount / 7, 1.0);
  const shrink = (raw) => conf * raw + (1 - conf) * 0.50;

  // ── alpha混合 ──
  const vf = shrink(alpha * aiVF + (1 - alpha) * attrVF);
  const rq = shrink(alpha * aiRQ + (1 - alpha) * attrRQ);
  const total = 0.60 * vf + 0.40 * rq;

  // ── 理由生成 ──
  const reasons = selectReasons(viewer, target, vf, rq, minCount);

  return { value_fit: vf, relational_quality: rq, total_score: total,
           confidence: conf, reasons };
}
```

### 2.5 属性ベースマッチング (コールドスタート)

analysis_count = 0 のユーザーペアで使用。3つのシグナル:

**業種隣接マップ (16種):**
- 同一業種: 1.0
- 高隣接: 0.7 (IT↔コンサル, 不動産↔建設, 広告↔メディア)
- 中隣接: 0.5 (IT↔金融, 製造↔物流, 教育↔人材)
- 低隣接: 0.15 (デフォルト)
- 「その他」: 0.25

```
根拠と限界: 重みはビジネス取引頻度と人材流動性の推定に基づく仮説値。
実データで検証されていない。ユーザー行動データ(コネクション承認率)で
Phase 2 以降に調整予定。間違った重みはランダムより悪い可能性があり、
この認識の上で保守的な値(差を小さく)に設定している。
```

**職種補完性 (14パターン正規化):**
```
CTO + VP Sales = 1.0 (最高補完)
CTO + CTO     = 0.6 (情報交換型)
engineer + PM = 0.9 (開発チーム補完)
未入力/不明   = 0.3 (中立)
```
自由入力テキストを正規表現で14カテゴリに分類。日本語職名(「技術責任者」「営業部長」等)にも対応。

**bioキーワード辞書 (12カテゴリ):**
```
startup: ["スタートアップ","起業","ベンチャー","PMF"]
ai_ml:   ["AI","機械学習","LLM","生成AI"]
saas:    ["SaaS","B2B","ARR","サブスクリプション"]
...
```
形態素解析不使用。辞書ベースの単語マッチ + Jaccard係数。
bio空の場合は重みをindustry/roleに按分 (50:50)。

**属性スコアの限界の自覚:**
```
この属性マッチングは「ないよりマシ」レベルの簡易推薦であり、
製品の本来の価値(AI分析ベースのマッチング)とは質が異なる。
ユーザーへの表示時も「プロフィール情報をもとに」と明記し、
AI分析後の推薦とは区別する。
```

### 2.6 ベイズ shrinkage

```
confidence = min(analysis_count / 7, 1.0)

shrink(raw_score) = confidence × raw_score + (1 - confidence) × 0.50

analysis_count=0  → confidence=0.00 → スコア=50 (事前分布平均)
analysis_count=1  → confidence=0.14 → スコアは50に強く引き寄せ
analysis_count=3  → confidence=0.43 → 半々
analysis_count=7  → confidence=1.00 → 観測値そのまま
analysis_count=20 → confidence=1.00 → 同上
```

**Phase移行:**

| Phase | 条件 (min(viewer, target)のcount) | alpha | 体験 |
|-------|----------------------------------|-------|------|
| attribute_only | count = 0 | 0.0 | 理由テキストのみ、属性ベース |
| hybrid | 1 ≤ count ≤ 4 | 0.2 × count | 理由テキスト + 「共通の関心」タグ |
| ai_primary | count ≥ 5 | 0.85 | 理由テキスト + オプトインで2軸バー |

alphaはペア単位で決定。viewer=分析済み、target=未分析の場合、そのペアだけattribute_onlyに落とす。

### 2.7 通知 (相互マッチ)

| tier | 条件 | アクション |
|------|------|-----------|
| high | total ≥ 75 AND confidence ≥ 0.6 | Realtime push + DB通知 |
| medium | total ≥ 60 AND confidence ≥ 0.4 | DB通知のみ |
| low | total ≥ 50 | 通知なし (一覧には表示) |

相互判定: A→BとB→Aの両方が条件を満たす場合、**低い方のtier**を採用。
重複防止: `mutual_match_notifications` テーブルのUNIQUE制約。

---

## 3. おすすめ理由テキストエンジン

### 3.1 設計原則

- **スコア数値はデフォルト非表示。** 理由テキストが推薦の主役
- **AIっぽさゼロ。** 禁止: 「分析の結果」「データに基づき」「スコアが高い」「AIが判断」
- **具体性の段階的向上。** 属性ベース(低)→カテゴリタグ(中)→AI分析(高)→実績(最高)

### 3.2 テンプレート体系 (4 Tier, 22パターン)

**Tier 1: 属性ベース (priority 8-30)**
| ID | 条件 | テンプレート |
|----|------|-------------|
| a01 | 同一業種 | `{industry}で活躍されている方です` |
| a02 | 異業種 | `{industry}の知見を持つ方。異業種の視点が得られそうです` |
| a03 | 同一ポジション | `同じ{position}のポジション。共通の悩みを話し合えるかもしれません` |
| a04 | 異なるポジション | `{position}として活動中。あなたの仕事と補い合える関係です` |
| a05 | bioキーワード重複 | `プロフィールに「{keyword}」という共通テーマがあります` |
| a06 | company存在 | `{company}での経験をお持ちの方です` |
| a07 | bio充実 | `幅広い経歴をお持ちの方。新たな視点が得られそうです` |

**Tier 2: カテゴリマッチ (priority 32-60)**
| ID | 条件 | テンプレート |
|----|------|-------------|
| c01 | needs∩skills非空 | `あなたが求めている「{need}」に関連するスキルをお持ちです` |
| c02 | offerings存在 | `「{offering}」を提供できる方。あなたの活動の力になりそうです` |
| c03 | skills重複 | `「{skill}」という共通の得意分野があります。話が弾みそうです` |
| c04 | skills≥3 | `多彩なスキルセットの持ち主。意外なコラボの可能性を秘めています` |
| c05 | count≥2 | `コミュニティで積極的に活動されている方です` |

**Tier 3: AI 2軸分析 (priority 52-80)**
| ID | 条件 | テンプレート |
|----|------|-------------|
| ai01 | value_fit≥0.70 | `あなたのニーズと相手の強みが高い確度で一致しています` |
| ai02 | value_fit≥0.70 (skill側) | `スキルの組み合わせに大きな相乗効果がありそうです` |
| ai03 | relational_quality≥0.70 | `コミュニケーションのスタイルが近く、打ち解けやすい相手です` |
| ai04 | needs∩offerings具体一致 | `あなたの課題「{need}」に対して「{offering}」という解決策を持つ方です` |
| ai05 | engagement≥0.60 | `会話の深まりが期待できる組み合わせです` |
| ai06 | 両軸≥0.50 | `ニーズとスキルの双方でバランスよく噛み合っています` |

**Tier 4: 関係性実績 (priority 78-95)**
| ID | 条件 | テンプレート |
|----|------|-------------|
| r01 | 会議≥3回 | `{count}回の会議を通じて、深い信頼関係が築かれています` |
| r02 | 会議≥1回 | `過去に同じ場で話した経験があり、次の対話がさらに実りあるものに` |
| r03 | history≥0.60 | `これまでの交流パターンから、相性の良さがうかがえます` |
| r04 | rq≥0.80+会議≥2 | `会話のテンポが合う方。議論が自然に深まる関係です` |

### 3.3 選択ロジック

1. 全テンプレートを `match()` で絞り込み
2. priority降順ソート (Tier 4 > 3 > 2 > 1)
3. 上位から最大3件を採用
4. **バッチ内重複抑制**: 同一テンプレートIDはバッチ内で最大3回。`usedTemplateIds` (Set) を共有
5. **フォールバック**: 0件の場合、target.id のハッシュで決定論的に3種のフォールバック文から選択

### 3.4 テンプレートの限界の自覚

```
22テンプレートは500人規模では繰り返しに気づかれる可能性がある。
対策:
  - バッチ内3回制限で1画面内の重複を抑制
  - Tier 2以降はカテゴリタグの変数展開で表面的な多様性を確保
  - Phase 2 で理由文の Claude 生成を上位ペア(相互70%超)のみに導入検討
  - テンプレート数は運用しながら増やす(目標: 40-50種)
```

---

## 4. パイプライン

### 4.1 全体フロー

```
[Render Cron JST 9/12/15/18]
  │
  ▼ tl;dv API ポーリング
  │ → meeting_transcripts UPSERT (pending → fetching → ready)
  │ → meeting_participants UPSERT
  │
  ▼ スピーカー紐付け (4段階)
  │ ①メール直接 ②正規化名前 ③姓部分一致 ④過去リンク
  │
  ▼ job_queue INSERT (type='analyze', per participant)

[Render Worker 常駐, 5秒ポーリング]
  │
  ▼ analyze (Claude Sonnet 4.6)
  │ → transcript_insights UPSERT (カテゴリタグ付き)
  │ → transcript status: ready → analyzing → analyzed
  │ → job_queue INSERT (type='aggregate', per linked user_id)
  │
  ▼ aggregate
  │ → member_ai_profiles_v2 UPSERT (差分マージ, 頻度重み, 時間減衰)
  │ → mark_cache_stale トリガー → is_stale=true
  │ → job_queue INSERT (type='score', user_id)
  │
  ▼ score (is_stale=true のみ, 500件/batch)
  │ → computeScore() 実行
  │ → matching_scores_v3 UPSERT, is_stale=false
  │ → 相互判定 → job_queue INSERT (type='notify', tier付き)
  │
  ▼ notify
    → mutual_match_notifications INSERT ON CONFLICT DO NOTHING
    → high: notifications INSERT + Realtime broadcast
    → medium: notifications INSERT のみ
    → low: スキップ
```

### 4.2 ジョブキュー (PostgreSQL)

```sql
CREATE TYPE public.job_type AS ENUM ('analyze','aggregate','score','notify');
CREATE TYPE public.job_status AS ENUM ('pending','running','completed','failed','dead');

CREATE TABLE public.job_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         public.job_type NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  status       public.job_status NOT NULL DEFAULT 'pending',
  priority     INT NOT NULL DEFAULT 0,
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error   TEXT,
  locked_at    TIMESTAMPTZ,
  locked_by    TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_poll ON job_queue (priority DESC, scheduled_at)
  WHERE status = 'pending';
```

**ジョブ優先度:** notify=1 > analyze=10 > aggregate=5 > score=3
**リトライ:** 指数バックオフ 30s / 120s / 480s。max 3回超過で `dead`
**ロックタイムアウト:** 5分。Worker起動時に stale locks を自動解放
**冪等性:** 全ステップ UPSERT + UNIQUE制約で保証
**重複防止:** INSERT WHERE NOT EXISTS (same type+payload in pending/running)

### 4.3 コスト見積もり

| 規模 | Claude分析 | カテゴリタグ追加 | スコア計算 | 理由生成 | 月額合計 |
|------|-----------|----------------|----------|---------|---------|
| 100人 | ~$4 | +$0.20 | $0 | $0 | **~$4** |
| 500人 | ~$21 | +$1 | $0 | $0 | **~$22** |
| 1000人 | ~$42 | +$2 | $0 | $0 | **~$44** |

コスト上限: 月次 analyze 完了件数をカウント。閾値超過で新規 analyze ジョブ投入を自動停止。

---

## 5. DBスキーマ変更 (v2 → v3)

### 5.1 matching_scores_v3

```sql
CREATE TABLE public.matching_scores_v3 (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  value_fit          FLOAT NOT NULL DEFAULT 0.50,
  relational_quality FLOAT NOT NULL DEFAULT 0.50,
  total_score        FLOAT NOT NULL DEFAULT 0.50,
  confidence         FLOAT NOT NULL DEFAULT 0.0,
  phase              TEXT NOT NULL DEFAULT 'attribute_only'
                     CHECK (phase IN ('attribute_only','hybrid','ai_primary')),
  score_reasons      JSONB DEFAULT '[]',
  notify_tier        TEXT CHECK (notify_tier IN ('high','medium','low')),
  is_stale           BOOLEAN NOT NULL DEFAULT true,
  calculated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(viewer_id, target_id)
);
```

### 5.2 transcript_insights 変更

```sql
-- expressed_needs / offered_capabilities を TEXT[] → JSONB[] に変更
-- 各要素: {text, category, subcategory, confidence}
ALTER TABLE public.transcript_insights
  ALTER COLUMN expressed_needs TYPE JSONB[] USING '{}',
  ALTER COLUMN offered_capabilities TYPE JSONB[] USING '{}';
```

### 5.3 job_queue 追加 (セクション4.2参照)

### 5.4 meeting_transcripts に meeting_type 追加

```sql
ALTER TABLE public.meeting_transcripts
  ADD COLUMN meeting_type TEXT CHECK (meeting_type IN (
    'business','internal','seminar','casual','unknown'
  )) DEFAULT 'unknown';
```

---

## 6. ユーザー体験の段階的進化

### Day 1 (attribute_only)

```
ダッシュボード:
  「あなたのプロフィールをもとに、話が合いそうな方をご紹介します」
  カード3枚: 名前/会社/職種 + 理由テキスト1行

マッチングページ:
  スコア数値なし。理由テキスト + 業種バッジのみ
  3-4人目の間に tl;dv 接続CTA (インライン、非モーダル)

理由テキスト例:
  「同じIT・テクノロジー業界で活躍されている方です」
  「コンサルティングの知見を持つ方。異業種の視点が得られそうです」
```

### Day 7 (hybrid, count=1-2)

```
+ カテゴリタグ由来の「共通の関心」タグ (最大2個)
+ 理由テキストがTier 2に進化:
  「あなたが求めている『顧客獲得』に関連するスキルをお持ちです」

ダッシュボード:
  「分析状況: 1件のミーティングを分析済み」
  「あと2件の分析で、おすすめ精度が大きく向上します」
```

### Day 30 (hybrid→ai_primary)

```
「特におすすめの方」と「こちらの方もいかがですか」の2セクション分離
箇条書き3点の具体理由:
  • 顧客オンボーディングの改善という共通テーマに取り組んでいます
  • プロダクト主導のグロース戦略に近い考え方をお持ちです
  • エンタープライズ営業の経験が、あなたの技術視点を補完します
```

### Day 90 (ai_primary, 成熟)

```
プロフィールモーダル内「詳しく見る」トグル:
  価値適合度    ━━━━━━━━━━░░  高い
  関係性の質    ━━━━━━━░░░░░  中程度
  ※ 12件のミーティング分析に基づく

数値(%)ではなくバー+言語ラベル(「高い/中程度/これから」)
```

### UI設計原則

- 数値を見せない (バー + 言語ラベル)
- 「AI」「スコア」という単語をUI上で使わない
- データ蓄積を自然に促す (進捗バー + 「あとN件で精度向上」)
- 1日最大1件の通知。週次サマリーは毎週月曜

---

## 7. 既知のリスクと対策

| リスク | 影響 | 対策 | フェーズ |
|--------|------|------|---------|
| tl;dv接続率が低い | AI分析が機能しない | 属性ベース推薦で最低限の価値提供 + 接続促進UI | Phase 1 |
| 業種隣接マップが不正確 | ランキングが的外れ | コネクション承認率データで重み調整 | Phase 2 |
| テンプレート繰り返しに気づかれる | ユーザー体験劣化 | テンプレート増加(40-50種) + 上位ペアのみClaude生成 | Phase 2 |
| Claude分析のハルシネーション | 不正確なプロフィール | analysis_count≥3でゲート + confidence shrinkage | Phase 1 |
| O(n²)スコア計算 | 1000人超で遅延 | is_stale差分 + 業種フィルタリングでペア数削減 | Phase 2 |
| 短い会議(5分)の分析精度 | ノイズ | meeting_type分類 + 短時間会議の重み低減 | Phase 2 |
| confidence = count/7 は品質指標でない | 低品質会議7回で過信 | Phase 2 で meeting_type × duration を加味した品質スコアに拡張 | Phase 2 |

---

## 8. 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | Next.js (App Router) | 16.2.2 |
| UI | shadcn/ui (base-nova) + Tailwind CSS | v4 |
| DB | Supabase (PostgreSQL + Auth + Realtime + Storage) | Pro |
| ホスティング | Render (Web + Worker + Cron) | Starter+ |
| CDN | Cloudflare (Phase 2) | - |
| AI分析 | Claude Sonnet 4.6 (Anthropic API) | - |
| 状態管理 | Zustand (UI) + TanStack Query (サーバー) | - |
| バリデーション | Zod v4 + @hookform/resolvers | - |
| 認証 | Email/Password + Facebook OAuth (Supabase Auth) | - |

---

## 9. UXシミュレーション結果 (8ラウンド完了: 2026-04-04)

20エージェント以上を投入した8ラウンドのシミュレーションで発見された全問題と修正状況。

### 9.1 シミュレーション履歴

| ラウンド | 視点 | 主要発見 | 修正状況 |
|---------|------|---------|---------|
| v1 | 新規ユーザーDay 1-3 | 5軸→2軸未移行、ProfileModal未実装、理由テキスト未表示、tl;dv CTA未配置、申請ボタンなし等 P0×8件 | **全件修正完了** |
| v2 | テクニカルQA Day 30 | score_reasons→reasonsマッピング欠落、閾値70→0.70、mutual API my_reasons未返却 | **全件修正完了** |
| v3 | 計算ロジック検証 | shrinkageがattribute_onlyで全スコア0.50に均一化、Tier 3テンプレートがconfidence=0で誤発火、compute完了後のinvalidation欠落 | **全件修正完了** |
| v4 | 認証+エッジケース | compute毎回再実行、?confirmed=true未処理、ブックマーク状態ハードコード、メンバー申請ボタンなし、UNIQUE制約エラー500返却 | **全件修正完了** |
| v5 | 3ペルソナ全フロー | 通知actionsのconnectionId欠落、おすすめスコア最低閾値なし、COMPLEMENT_MATRIX欠落 | **全件修正完了** |
| v6 | 視覚+インタラクション | ProfileModalブックマーク常にfalse、コネクション重複申請防止なし、マッチングカードdisabledなし、モバイル業種フィルタ画面占有 | **全件修正完了** |
| v7 | 攻撃的テスト | compute API無制限連打、存在しないユーザーへの申請、industry不正値バリデーション | **全件修正完了** |
| v8 | プロダクトレベル | 新規ユーザーの非対称性(A→Bはあるが B→Aがない)、Day 2+リテンション設計欠如 | **全件修正完了** |

### 9.2 現在の実装状態（v8修正後）

**コアフロー — 全て動作確認済み:**

```
登録(industry/bio必須) → メール確認メッセージ → ログイン
  → ダッシュボード(双方向compute自動→おすすめ+新着メンバー表示)
  → マッチング(2軸理由テキスト+接続済みガード+tl;dv CTA)
  → メンバー(ブックマーク状態反映+申請ボタン+横スクロールフィルタ)
  → ProfileModal(理由+スコアバー+接続状態+ブックマーク状態)
  → 通知(link遷移+actions承認/拒否ボタン+connectionId連携)
  → コネクション(方向チェック+状態遷移+承認通知)
  → contact_info公開(接続成立後のみ)
```

**セキュリティ — 検証済み:**
- withAuth() → getUser() (サーバー検証、JWT偽造不可)
- コネクション方向チェック (accept/reject=受信者のみ、cancel=送信者のみ)
- contact_info 可視性制御 (API層でコネクション状態チェック)
- 入力サニタイズ (PostgRESTフィルタ注入防止)
- UUID形式バリデーション
- UNIQUE制約エラー → 409変換
- compute APIレート制限 (5分間隔)
- 対象ユーザー存在確認
- industry バリデーション (z.enum)
- XSS防止 (React JSXデフォルトエスケープ)

### 9.3 残存する LOW 問題（MVP許容）

| # | 内容 | 理由 |
|---|------|------|
| 1 | tl;dv CTA の「接続する」がplaceholder href | OAuth実装は別タスク |
| 2 | 設定ページ通知/テーマが「準備中」 | Phase 2 対応 |
| 3 | Realtime Provider 未実装 (ポーリング30秒) | Phase 2、機能的には動作 |
| 4 | 自分自身をブックマーク可能 | UIから到達しにくい、実害なし |
| 5 | 同スコア帯のランダム性なし | DB insertion order、実害限定的 |
| 6 | 通知量がDay 7+で0-1件/日 | 週次メール(Phase 2)で補完 |
| 7 | メール未確認アクセス | Supabase設定依存 |
| 8 | useQuery失敗時のエラー表示不在 | toast(mutation側)で最低限カバー |

### 9.4 Phase 2 で対応すべき項目

| # | 内容 |
|---|------|
| 1 | Worker パイプライン (tl;dv取得→Claude分析→集約→スコアリング→通知) |
| 2 | カテゴリタクソノミー50種の Claude プロンプト適用 |
| 3 | Realtime Provider (通知push) |
| 4 | 週次ダイジェストメール |
| 5 | コネクション成立後の「次のステップ」提案 |
| 6 | マッチングページへの業種フィルタ追加 |
| 7 | 業種隣接マップのデータ駆動チューニング |
| 8 | テンプレート数の増加 (22→40-50種) |
| 9 | pgvector embedding によるハイブリッド類似度計算 |

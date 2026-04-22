# INTERCONNECT システムアーキテクチャ（現状版）

**最終更新**: 2026-04-10
**コード状態**: 102ファイル / ~8,200行 / TypeScript 0エラー / ビルド成功
**本番URL**: https://inter-connect.app（Netlify）

---

## 1. システム概要

INTERCONNECTは、ミーティングの会話内容をAIで分析し、ビジネスプロフェッショナル同士の
最適なマッチングを提案するプラットフォーム。

```
ユーザー → tl;dv で会議を録画
         → Webhook で自動取得
         → Claude Opus 4.6 で構造化抽出（ニーズ/オファー/solver_profile等）
         → 集約 → マッチングスコア計算
         → おすすめの方を表示（理由テキスト付き）
```

---

## 2. 技術スタック

| レイヤー | 技術 | バージョン |
|---|---|---|
| フロントエンド | Next.js (App Router) | 16.2.2 |
| UI | React + Tailwind CSS 4 + shadcn/ui v4 | React 19.2.4 |
| 状態管理 | TanStack React Query + Zustand | 5.96.1 / 5.0.12 |
| バックエンド | Next.js API Routes | — |
| データベース | Supabase PostgreSQL (RLS) | — |
| 認証 | Supabase Auth (Email/Facebook/LinkedIn) | — |
| AI分析 | Anthropic Claude Opus 4.6 | SDK 0.82.0 |
| ワーカー | Node.js + tsx (PostgreSQLジョブキュー) | — |
| 外部連携 | tl;dv API (Webhook + REST) | v1alpha1 |
| デプロイ | Netlify | — |
| 言語 | TypeScript 5 | Strict |
| バリデーション | Zod 4 | 4.3.6 |

---

## 3. ディレクトリ構造

```
interconnect2/
├── src/
│   ├── app/
│   │   ├── (auth)/              11ページ（認証済み）
│   │   │   ├── dashboard/       ダッシュボード（統計+おすすめ）
│   │   │   ├── matching/        マッチング一覧
│   │   │   ├── connections/     コネクション管理
│   │   │   ├── members/         メンバー検索
│   │   │   ├── meetings/        ミーティング管理
│   │   │   ├── profile/         プロフィール編集
│   │   │   ├── notifications/   通知一覧
│   │   │   ├── bookmarks/       ブックマーク
│   │   │   ├── settings/        設定
│   │   │   └── onboarding/      初期設定
│   │   ├── (public)/            9ページ（未認証）
│   │   │   ├── login/register/  認証フロー
│   │   │   ├── terms/privacy/   法的ページ
│   │   │   └── auth/callback/   OAuth コールバック
│   │   └── api/v1/              20 APIルート
│   │       ├── profiles/        GET me, GET [id], PATCH me
│   │       ├── connections/     GET, POST, PATCH [id]
│   │       ├── matching/        POST compute, GET scores, GET mutual
│   │       ├── members/         GET (検索+フィルタ)
│   │       ├── meetings/        GET, POST, PATCH [id], POST request
│   │       ├── notifications/   GET, PATCH, POST read-all
│   │       ├── transcripts/     POST webhook, POST sync
│   │       ├── bookmarks/       GET, POST, DELETE
│   │       ├── goals/           GET, POST
│   │       ├── offerings/       GET, POST
│   │       ├── invitation/      GET
│   │       └── health/          GET
│   ├── components/              18コンポーネント
│   │   ├── ui/                  shadcn/ui (button,card,dialog等)
│   │   ├── features/            auth, profile
│   │   ├── layouts/             header, sidebar
│   │   └── shared/              score-bar, tldv-cta
│   ├── hooks/                   13フック
│   │   ├── queries/             7クエリ + keys
│   │   └── mutations/           5ミューテーション
│   ├── lib/
│   │   ├── matching/            スコア計算(4ファイル)
│   │   ├── tldv/                tl;dv連携(4ファイル)
│   │   ├── supabase/            DB接続(2ファイル)
│   │   └── *.ts                 api-client, constants, sanitize等
│   ├── providers/               supabase, react-query
│   ├── stores/                  ui-store, filter-store
│   ├── types/                   index.ts, database.ts
│   └── validations/             auth.ts, profile.ts
├── worker/src/
│   ├── index.ts                 メインループ(5秒ポーリング)
│   ├── queue.ts                 ジョブキュー操作
│   └── handlers/
│       ├── analyze.ts           Opus 4.6 構造化抽出
│       └── aggregate.ts         ユーザーAIプロフィール集約
├── supabase/migrations/         5マイグレーション
└── 設計書
    ├── ARCHITECTURE_CURRENT.md  本ファイル
    ├── SCORING_V2_ARCHITECTURE.md  スコアリングV2設計
    └── SCORING_V2_DESIGN.csv    スコアリングV2 82項目仕様
```

---

## 4. データベース

### 4.1 主要テーブル（実在・データあり）

| テーブル | 行数 | 目的 |
|---|---|---|
| user_profiles | 5 | ユーザー情報 |
| connections | 1 | コネクション関係 |
| notifications | 5 | 通知 |
| meeting_transcripts | ~22 | tl;dv書き起こし |
| meeting_participants | 45 | 発話者（紐付け情報含む） |
| transcript_insights | 21 | AI分析結果（現在v2.0.0） |
| member_ai_profiles_v2 | 4 | 集約AIプロフィール |
| matching_scores_v3 | 8 | V1マッチングスコア（稼働中） |
| job_queue | 21 | ジョブキュー（全completed） |
| user_goals | 4 | ユーザー目標 |
| user_offerings | 4 | ユーザー提供 |
| bookmarks | 0 | ブックマーク |
| meetings | 1 | 会議 |
| prompt_versions | 4 | プロンプト管理 |

### 4.2 V2用テーブル（作成済み・データなし）

| テーブル | 目的 | 状態 |
|---|---|---|
| user_conversation_vectors | 5次元スコアリング用ベクトル | 空 |
| matching_scores_v4 | V2スコア保存 | 空 |
| correction_log | ユーザー修正記録 | 空 |
| feedback_log | マッチング後評価 | 空 |
| scoring_config | 重み配分管理 | 1行（v1.0 active） |

### 4.3 プロンプトバージョン

| version | model | is_active | 状態 |
|---|---|---|---|
| 1.0.0 | claude-sonnet-4-6 | false | 初期版 |
| 2.0.0 | claude-sonnet-4-6 | false | カテゴリ付き |
| **3.0.0** | **claude-opus-4-6** | **true** | solver/beneficiary_profile付き |

---

## 5. AI分析パイプライン

### 5.1 現在稼働中のフロー

```
tl;dv Webhook (TranscriptReady)
  ↓
POST /api/v1/transcripts/webhook
  ↓
processTldvMeeting()
  ├─ tl;dv API: getMeeting() + getTranscript()
  ├─ UPSERT meeting_transcripts
  ├─ linkSpeakerToUser() (email→名前完全→名前部分)
  ├─ INSERT meeting_participants
  └─ enqueue 'analyze' job
       ↓
Worker: handleAnalyze()
  ├─ Claude Opus 4.6 + v3プロンプト
  ├─ Zod バリデーション + フォールバック再試行
  ├─ 会議品質係数（meeting_type × テキスト長）
  └─ UPSERT transcript_insights
       ↓
Worker: handleAggregate()
  ├─ 全transcript_insightsを集約
  ├─ 時間減衰 + 頻度重み
  ├─ V2フィールド保持（solver_profile, beneficiary_profile等）
  └─ UPSERT member_ai_profiles_v2
       ↓
Dashboard: /matching/compute
  ├─ V1スコア計算（attribute + purpose + conversation + history）
  └─ UPSERT matching_scores_v3
```

### 5.2 Opus v3 プロンプトの抽出フィールド

```
needs[]:     text, explicit, confidence, evidence[], signals[],
             solver_profile, urgency_signals[], category, subcategory
offers[]:    text, explicit, confidence, evidence[], signals[],
             beneficiary_profile, credibility, category, subcategory
conversation_dynamics: rapport, information_asymmetry, unspoken_tensions[], follow_up_potential
topic_depth[]:        topic, category, depth
engagement_behaviors: 5つのbool
evidence_quotes[]:    field, index, quote
key_statements[]:     最大3件
```

### 5.3 V1スコアリング（現在稼働中）

```
2軸モデル:
  value_fit (60%):        industry_affinity + role_complement + bio_overlap
  relational_quality (40%): communication_score + history_score

3段階成熟度:
  Lv1 (分析0回): attribute 70% + purpose 20% + history 10%
  Lv2 (1-4回):  attribute 25% + purpose 20% + conversation 40% + history 15%
  Lv3 (5回+):   attribute 10% + purpose 15% + conversation 45% + history 30%

信頼度: min(analysis_count / 7, 1.0)
縮小:   confidence × raw + (1 - confidence) × 0.50
```

---

## 6. 認証・認可

- **Supabase Auth**: Email/Password + Facebook OAuth + LinkedIn OIDC
- **RLS**: 全テーブルにRow Level Security適用
- **Service Role**: ワーカー・Webhook・通知作成で使用（RLSバイパス）
- **withAuth()**: APIルートの認証ガード
- **proxy.ts**: ミドルウェアで (auth) ルートを保護
- **contact_info**: accepted/reaccepted接続 または 確認済み会議の共有時のみ表示

---

## 7. 外部連携

### tl;dv
- **Webhook**: POST /api/v1/transcripts/webhook?secret=... (TranscriptReady)
- **手動同期**: POST /api/v1/transcripts/sync（認証必要、最大10件/回）
- **API**: GET /v1alpha1/meetings, /meetings/{id}, /meetings/{id}/transcript

### Anthropic Claude
- **分析**: Opus 4.6（v3プロンプト、max_tokens: 4096）
- **コスト**: ~$0.40/分析（入力$15/MTok + 出力$75/MTok）
- **月間見積**: 1000人 × 月3回 = $330-500

---

## 8. 機能一覧と完成度

| 機能 | 完成度 | 備考 |
|---|---|---|
| 認証（Email/Facebook/LinkedIn） | 100% | |
| オンボーディング | 100% | 目標/提供設定 |
| ダッシュボード | 100% | 成熟度Lv + 完成度メーター + 統計 |
| マッチング表示 | 100% | V2スコア稼働中、5次元+動的重み |
| コネクション管理 | 100% | 申請/承認/解除/再申請 |
| メンバー検索 | 100% | ソート/フィルタ/役職追加 |
| プロフィール | 100% | アバターアップロード実装済み |
| ブックマーク | 100% | |
| 通知 | 100% | |
| tl;dv連携 | 90% | Webhook+手動同期稼働 |
| AI分析（Opus v3） | 100% | 全21件再分析完了 |
| V2スコアリング | 100% | Step 1-4 全完了 |
| 会議機能 | 100% | 完了: リクエスト/承認/辞退/キャンセル/完了 |
| 設定ページ | 90% | アカウント管理/通知設定/AIプロフィール/tl;dv表示 |
| フィードバックUI | 100% | 2段階モーダル実装済み、コネクションページに統合 |
| AIプロフィール管理 | 100% | /settings/ai-profile 実装済み、非表示/再表示機能 |

---

## 9. V2スコアリング移行状態

SCORING_V2_ARCHITECTURE.md に詳細設計。82項目の機能仕様は SCORING_V2_DESIGN.csv に記載。

| Step | 内容 | 状態 |
|---|---|---|
| 1 | テーブル + Opus v3 プロンプト + analyze handler | **完了** |
| 1.5 | 既存21件の Opus 再分析 | **完了** |
| 2 | 集約エンジン + user_conversation_vectors | **完了** |
| 3 | 5次元スコア + 動的重み + 推薦理由V2 | **完了** |
| 4 | フロントエンドV2切替 | **完了** |
| 5 | フィードバック基盤 | **完了** |
| 6 | V1クリーンアップ | **完了** |

---

## 10. 環境変数

```
NEXT_PUBLIC_SUPABASE_URL        Supabase接続
NEXT_PUBLIC_SUPABASE_ANON_KEY   Supabase公開キー
SUPABASE_SERVICE_ROLE_KEY       Supabaseサービスキー（RLSバイパス）
NEXT_PUBLIC_APP_URL             アプリURL
AI_API_KEY                      Anthropic APIキー（Opus 4.6）
TLDV_API_KEY                    tl;dv APIキー
TLDV_WEBHOOK_SECRET             Webhook検証シークレット
```

---

## 11. デプロイ

- **フロントエンド + API**: Netlify（`npx netlify deploy --build --prod`）
- **ワーカー**: ローカル実行（`npm run worker`）。本番はRender等にデプロイ予定。
- **データベース**: Supabase Cloud（マイグレーションはSQL Editorで手動適用）

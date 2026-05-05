# INTERCONNECT 統合アーキテクチャ設計書

> v4完全設計書 + 現行システム状態 + スコアリングV2 の統合版
> 最終更新: 2026-05-05
> 参照: SCORING_V2_ARCHITECTURE.md / SCORING_V2_DESIGN.csv / 完全設計書v4改訂サマリー

---

## 0. v4設計書 38項目の統合ステータス

### 解決済み（対応不要）

| # | 項目 | 理由 |
|---|---|---|
| A1 | Python Worker RLSバイパス | Node.js Worker で service_role_key 使用済み |
| A3 | Next.js 16 RouteContext型 | 全動的ルートで async params 対応済み |
| A12 | オンボーディングフロー | 3ステップ実装済み（goals/offerings/完了）。Step Indicator は `<ol>` + `aria-current="step"`、Tabs は `role="tablist"/tab/tabpanel` + `aria-selected/aria-controls`、必須 input は `aria-required` + `aria-invalid`、第三者提供同意の checkbox は重複参照を解消（label htmlFor のみで accessible name を提供）|
| A35 | Daily.co Bot検証 | tl;dv採用のため不要。Webhook+手動同期稼働中 |
| A2 | Monorepo Python型共有 | Node.js単体構成のため不要 |

### 完了済み（実装完了）

| # | 項目 | 完了内容 |
|---|---|---|
| A14 | 検索ソート・フィルタ | ソート/フィルタ/役職追加 |
| A15 | 推薦ブラックリスト | localStorage ベース、X ボタン + リセット |
| A16 | プロフィール完成度メーター | 7グループ / 19項目 / 100点制（基本15+アイコン2+自己紹介20+目標提供30+連絡先5+会話分析25+SNS3）。SCORING_V2_ARCHITECTURE.md §4.4 alpha と 1:1 整合（tldv 5段階 × 5pt = 25pt が core lever）。bio 5段階 / goals/offerings 3段階 × detail 文字数評価込み。ダッシュボード+プロフィール |
| A32 | エラー時ユーザー導線 | グローバルエラー境界 + 404 + APIトースト |
| A19 | 特商法ページ | /tokushoho 静的ページ、フッターリンク |
| A25 | データ保持期間マトリクス | プライバシーページに保持期間表追加 |
| A5 | APIレート制限 | インメモリ、一般60/min、認証10/min、compute 5/5min |
| A11 | 招待機能 use_count 修正 | PATCH で use_count インクリメント |

### 対応予定（優先度順）

| 優先度 | # | 項目 | 工数 | 依存 |
|---|---|---|---|---|
| **P0** | A4 | Stripe課金統合 | 大 | なし |
| **P0** | A20 | 消費税表示（税込） | 小 | A4 |
| **P0** | A21 | インボイス対応 | 小 | A4 |
| **P1** | A7 | パスワードポリシー | 小 | なし |
| **P1** | A8 | 2FA | 中 | なし |
| **P1** | A10 | 会議排他制御 | 小 | なし |
| **P1** | A13 | 「推薦されない」診断 | 中 | なし |
| **P1** | A17 | PWA/プッシュ通知 | 大 | なし |
| **P1** | A22 | クーリングオフ明記 | 小 | A4 |
| **P1** | A23 | SLA定義 | 小 | なし |
| **P1** | A24 | DPA/業務委託契約 | 小 | なし |
| **P1** | A26 | バックアップ検証手順 | 中 | なし |
| **P1** | A27 | 容量見積もり表 | 小 | なし |
| **P1** | A28 | パフォーマンステスト | 中 | なし |
| **P1** | A30 | WCAG 2.1 AA検証 | 中 | なし |
| **P1** | A31 | レスポンシブ画面仕様 | 中 | なし |
| **P1** | A36 | Supabase Realtimeレイテンシ検証 | 小 | なし |
| **P1** | A37 | Opus日本語精度実測 | 小 | 完了済み（テスト分析で検証） |
| **P1** | A38 | Anthropic Batch API時間実測 | 小 | なし |
| **P2** | A6 | ウイルススキャン | 中 | なし |
| **P2** | A18 | メンバーカテゴリ絞り込み | 小 | なし |
| **P2** | A29 | Chaos Engineering | 大 | なし |
| **P2** | A33 | ダークモード | 中 | なし |
| **P2** | A34 | チャット絵文字 | 小 | チャット機能 |
| **P3** | A9 | SMS通知 | 中 | なし |

---

## 1. 技術スタック（v4統合版）

| レイヤー | v4設計 | 現在の実装 | 判断 |
|---|---|---|---|
| フロントエンド | Next.js App Router | Next.js 16.2.2 | **現行維持** |
| ワーカー | Python Bot | Node.js + tsx | **現行維持**（Node.jsで十分） |
| 会議連携 | Daily.co Bot | tl;dv API | **現行維持**（tl;dv稼働中） |
| AI分析 | Opus 4.6 | Opus 4.6 | **一致** |
| DB | Supabase PostgreSQL | Supabase PostgreSQL | **一致** |
| 認証 | Supabase Auth | Supabase Auth | **一致** |
| 課金 | Stripe | 未実装 | **P0で実装予定** |
| レート制限 | 未指定 | 未実装 | **P0で実装予定** |

### v4との差異と判断根拠

**Python Worker → Node.js維持の理由:**
- 既にOpus v3分析 + 集約 + V2スコアリングが完全稼働
- Supabase JS SDK + Anthropic JS SDKの連携が安定
- Python移行のコスト/リスクに見合うメリットがない

**Daily.co → tl;dv維持の理由:**
- tl;dv Webhook + 手動同期が稼働中
- 21件の書き起こし取得・分析実績
- Daily.coは「リアルタイム会議ホスティング」、tl;dvは「録画分析」で目的が異なる

---

## 2. 現在の機能完成度

| 機能 | 完成度 | v4要件との整合 |
|---|---|---|
| 認証（Email/Facebook/LinkedIn） | 100% | A7(パスワードポリシー)、A8(2FA)が未対応 |
| オンボーディング | 100% | A12解決済み |
| ダッシュボード | 95% | — |
| V2マッチングスコア | 100% | 5次元+動的重み+理由V2 稼働中 |
| コネクション管理 | 100% | — |
| メンバー検索 | 100% | A14完了（ソート/フィルタ/役職追加）、A18(カテゴリ絞込)未対応 |
| tl;dv連携 | 90% | 稼働中 |
| AI分析（Opus v3） | 100% | solver/beneficiary_profile抽出済み |
| プロフィール | 98% | 完成度メーター v2 (alpha 整合 / detail 文字数評価)、アバター 4-variant WebP 実装済、**11 項目編集 UI 完備** (name/company/position/industry/bio/contact_info/avatar/goals/offerings/goal_detail/offering_detail) — `/profile` で 7 項目 + `/onboarding` で 4 項目を網羅、各 input に label htmlFor / aria-describedby / aria-required / aria-invalid を WCAG 2.1 AA 準拠で実装 |
| 通知 | 100% | A17(PWA/プッシュ)未対応 |
| ブックマーク | 100% | — |
| 招待機能 | 70% | A11: use_count未加算 |
| 課金 | 0% | A4: Stripe未実装 |
| 法務ページ | 30% | A19-A24: 特商法/税/インボイス未対応 |
| レート制限 | 0% | A5: 未実装 |
| ワーカーデプロイ | 0% | render.yaml作成済み、デプロイ未実行 |

---

## 3. 実装ロードマップ（v4準拠）

### Phase 1: 法務・セキュリティ基盤（1-2週間）

```
A19: 特商法ページ（/tokushoho）
A25: データ保持期間定義 + プライバシーポリシー更新
A5:  APIレート制限（Upstash Redis or インメモリ）
A11: 招待機能 use_count 修正
A7:  パスワードポリシー（Supabase Auth設定）
ワーカーデプロイ（Render.com）
```

### Phase 2: 課金・収益化（2-3週間）

```
A4:  Stripe統合（checkout/webhook/portal）
A20: 消費税表示（税込）
A21: インボイス対応
A22: クーリングオフ明記
```

### Phase 3: UX改善（2-3週間）

```
A14: 検索ソート・フィルタ ← 完了
A15: 推薦ブラックリスト ← 完了
A16: プロフィール完成度メーター ← v2 完了（Z1-Z5: alpha 整合 / 段階粒度 / detail 質評価）
A13: 「推薦されない」診断
A32: エラー時ユーザー導線 ← 完了
A31: レスポンシブ画面仕様
A30: WCAG 2.1 AA検証
```

### Phase 4: 高度な機能（3-4週間）

```
A8:  2FA
A17: PWA/プッシュ通知
A10: 会議排他制御
A26: バックアップ検証
A28: パフォーマンステスト
スコアリングV2 Step 5: フィードバック基盤
スコアリングV2 Step 6: V1クリーンアップ
```

### Phase 5: 将来（データドリブン判断）

```
A6:  ウイルススキャン
A29: Chaos Engineering
A33: ダークモード
A34: チャット絵文字
A9:  SMS通知
Haiku LLM判定（スコアリングV2拡張）
pgvector埋め込み
フィードバックループ自動改善
```

---

## 4. P0項目の実装仕様

### A19: 特商法ページ

```
ファイル: src/app/(public)/tokushoho/page.tsx（新規）
内容: 事業者名/代表者/所在地/連絡先/販売価格/支払方法/キャンセル
ミドルウェア: publicPaths に /tokushoho 追加
フッター: 全ページのフッターにリンク追加
```

### A25: データ保持期間

```
定義:
  meeting_transcripts.full_text → 分析完了後90日でNULL化
  job_queue (completed/dead) → 30日で削除
  notifications (既読) → 90日で削除
  login_sessions → 1年で削除
  user_signals → 180日で削除

実装: Vercel Cron or Worker に cleanup ジョブ追加
プライバシーポリシー: 保持期間マトリクスを追記
```

### A5: APIレート制限

```
方式: インメモリ Map ベース（小規模のため Redis 不要）
  - 一般API: 60 req/min per user
  - 認証系: 10 req/min per IP
  - compute: 5 req/min per user
  - webhook: 制限なし

実装: src/lib/rate-limit.ts + api-helpers.ts に統合
```

### A11: 招待機能修正

```
修正: auth callback で invitation_codes.use_count をインクリメント
追加: use_count >= max_uses でコード無効化
```

---

## 5. スコアリング V2 ステータス（統合）

SCORING_V2_ARCHITECTURE.md に詳細。現在の状態：

| Step | 状態 |
|---|---|
| 1: テーブル + Opus v3 | **完了** |
| 1.5: 既存再分析 | **完了** |
| 2: 集約エンジン | **完了** |
| 3: 5次元スコア | **完了** |
| 4: フロントエンドV2 | **完了** |
| 5: フィードバック基盤 | Phase 4 で実装 |
| 6: V1クリーンアップ | Phase 4 で実装 |

---

## 6. デプロイ構成（v4統合版）

```
フロントエンド + API:  Netlify (inter-connect.app)
ワーカー:             Render.com Background Worker（デプロイ待ち）
データベース:          Supabase Cloud
AI分析:               Anthropic Opus 4.6
会議書き起こし:        tl;dv API + Webhook
課金:                 Stripe（Phase 2で実装）
```

---

## 7. v4「完璧性への正直な宣言」への対応

> 1. 100%完璧な設計書は存在しない → **同意。実装→検証→調整ループで進める**
> 2. OWASP/GDPR/WCAG チェックリスト → **Phase 1-3で段階的に対応**
> 3. 未決論点は隠さず明示 → **A35-A38を明示的にトラッキング**
> 4. Claude Code が手を止めるべき: タブ45の項目 → **A35(N/A), A36-A38は検証タスクとして分離**
> 5. 実装→検証→調整のループ → **現在のアプローチと一致**

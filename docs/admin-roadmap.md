# 運営管理画面 拡張ロードマップ

> 作成: 2026-05-06
> ステータス: **計画書 (確実な実装時期は未確定。可能な範囲から段階的に着手)**
>
> 4 並列レビューエージェント (内部gap / 業界ベンチマーク / 監視メトリクス / コンプライアンス workflow) の調査結果を集約。

---

## 0. 現状診断 (2026-05-06)

| 項目 | 現状 |
|---|---|
| admin 画面 | `/admin/import-requests` の 1 ページのみ |
| admin API | `/api/v1/admin/import-requests` の 1 endpoint |
| ユーザー管理 | Supabase Studio 直叩き (誤操作で本番事故リスク) |
| お問い合わせ | `/contact` は `mailto:` のみ・DB 化なし |
| audit_logs | テーブル + writeAuditLog 既存だが閲覧 UI なし |
| AI 抽出レビュー | confidence_score だけ記録・人間承認 workflow なし |
| 通報・モデレーション | テーブル自体未設計 |

**運営の日常操作の 9 割が SQL 直叩き** → スケール時に確実に詰まる。

---

## 1. Tier 1 — 最優先 (運営事故防止)

### A) `/admin/users` + `/admin/users/[id]` ★最優先
HubSpot 級「1 人の全て」を 1 画面に。
- **Overview**: profile / stub or real / 同意状態 / 最終 login
- **Profile timeline**: AI 抽出 + 手動編集の差分履歴
- **Meetings**: tl;dv 連携会議一覧 + transcript link
- **Matches**: 発生したペア + ステータス
- **Chats**: 会話一覧 + keyword hit ハイライト
- **Reports**: 通報の発信/受信
- **Consent log**: 同意ログと join
- **Audit Trail**: admin が触った履歴
- **Danger zone**: 停止 / BAN / 匿名化

`audit_logs` に閲覧理由 (reason) 必須記録 — 目的外閲覧抑止。

### B) `/admin/data-rights` ★法的義務
個情法 27 条開示請求対応 — **30 日以内対応が法定義務**。
- 申請受付 inbox (開示 / 利用停止 / 削除 / 第三者提供停止)
- state machine: `received → identity_verified → reviewing → executed`
- SLA カウントダウン (15日経過で代表メール自動 escalate)
- 開示資料生成 RPC (`dsr_export(user_id)` で JSON+CSV を Supabase Storage に AES 暗号化)

**新規テーブル**: `data_subject_requests` (request_type, requester_id, sla_due_at, executed_at)

### C) `/admin/contacts` ★即時必要
`/contact` フォームの inbox 化。
- 現在 mailto: のみで取りこぼし不可避 → DB 化必須
- Gmail 風 3 ペイン (新規/担当者割当/状態)
- SLA: 初回応答 24h / 解決 5 営業日

**新規テーブル**: `contact_messages` (sender_email, body, assignee_id, status, sla_due_at)

### D) `/admin/transcripts`
- `meeting_transcripts` 一覧 (status filter: error/pending/fetching)
- error_message 表示 + 再 fetch ボタン
- `meeting_participants.is_linked=false` の手動 link UI
- AI 抽出結果の人間承認 (confidence < 0.8 は publish しない)

### E) `/admin/audit-logs`
- audit_logs 検索 (actor / action / target / 期間)
- CSV export
- ユーザー別の時系列ビュー

### F) `/admin/dashboard` (運営 top hub)
**KPI 8 枚カード**
- DAU/WAU/MAU
- Onboarding funnel
- **Matching funnel** (核心): impressed → requested → accepted → chat_started → meet_held
- マッチ精度 (avg confidence_score)
- Cohort retention (週次ヒートマップ)
- 未処理 import_requests / contacts / data-rights バッジ

---

## 2. Tier 2 — 次フェーズ (1-2 ヶ月)

| 画面 | 機能 |
|---|---|
| `/admin/reports` | 通報受付 → 警告/削除/停止 workflow (Reddit modlog 流) |
| `/admin/chat-alerts` | regex + Claude で「外部誘導/金銭/ハラスメント」3 軸スコア + SLA タイマー |
| `/admin/connections` | 申請数/承諾率/blocked 集計 + 個別 pair 介入 |
| `/admin/health` | Supabase advisor / Edge latency / Claude token cost / cron job 状態 |
| `/admin/legal` | terms_versions 一覧 + 新版公開 + 再同意キュー |
| `/admin/applications` | 会員審査キュー (Yenta 型: 承認/差戻し/BAN) |
| `/admin/stub-claims` | stub アカウント本人移管 workflow |
| **Impersonation** | CS が本人視点で問題再現 (操作ログ必須・期限付き) |

---

## 3. Tier 3 — 将来 (PMF 後)

- `/admin/matching-config` — scoring_config / prompt_versions / ab_tests GUI
- `/admin/notifications` — 全体 broadcast / cohort 別 push
- `/admin/billing` — 課金導入時
- 段階的 ban (warn → mute → suspend → permaban) + appeal 窓口
- shadow downgrade (推薦から除外しても本人には見えない)
- ban evasion 検知 (device fingerprint)
- 外部 BI (Metabase/Looker) 連携

---

## 4. 監視・アラート (Tier 1 と並行)

| 検知 | ロジック | 通知 |
|---|---|---|
| 荒らし connection | 1 user が 1h で >20 申請 | Slack 即時 |
| chat spam | sender_id 別 1h メッセージ >100 OR 同一文字列 ×5 | Slack + 自動 throttle |
| Claude cost spike | 1h cost が 7d 平均 ×3 超過 | email + Slack |
| 同意撤回未処理 | 24h 以上未対応 | Notion DB 起票 |
| RLS 大量拒否 | 1 user 5min で >50 拒否 | Slack + IP 一時 ban |
| API 5xx rate | >1% | alert |

実装: Supabase Edge Cron 5 分毎 + Resend/Slack webhook

---

## 5. 業界 Anti-pattern (避ける)

- ❌ CSV 全件 export だけ提供 — フィルタ無き 10万行 DL は誰も読まない
- ❌ ログ無限スクロール — 日付範囲 + 種別フィルタ + ページング必須
- ❌ 検索 1 秒超 — pg_trgm / GIN index を最初から
- ❌ 削除がハード DELETE — soft delete + 理由 + 操作者記録必須
- ❌ 通報が email のみ — チケット化されず追えない → DB 化必須
- ❌ AI 抽出結果が即公開 — confidence < 0.8 は人間承認

---

## 6. 横断的な技術負債 (Tier 1 着手前に対処)

1. `withAdminAuth()` helper を `lib/api-helpers.ts` に昇格 (`ensureAdmin` のコピペ蔓延を防ぐ)
2. `audit_logs` の改ざん検知 (日次 SHA-256 ハッシュチェーンを `audit_log_seals` に記録、7 年保持・WORM)
3. admin 操作は middleware で閲覧理由 reason 必須
4. `prompt()` 利用は dialog 化 (現在 `/admin/import-requests` で使用)
5. 全 admin UI に WCAG / SP card stack / 絵文字ナシ方針を踏襲

---

## 7. 推奨実装順 (運営 6 名想定)

```
Week 1-2:
  - withAdminAuth helper 抽出 ★ (技術負債解消)
  - /admin/dashboard (Tier1-F)
  - /admin/users + /admin/users/[id] (Tier1-A)
  - /admin/audit-logs (Tier1-E)

Week 3-4:
  - /admin/data-rights (Tier1-B) ★法的義務
  - /admin/contacts (Tier1-C) ★即時必要
  - /admin/transcripts (Tier1-D) + AI 抽出レビュー

Month 2:
  - /admin/reports + /admin/chat-alerts (Tier2)
  - 監視アラート 5 種

Month 3+:
  - applications / health / legal / impersonation
  - Tier3 は PMF 後
```

---

## 8. 結論

運営 UX の最大ボトルネック 3 つ:
1. **ユーザー詳細が見れない** → トラブル時に SQL 5 本叩く運用 → `/admin/users` が最優先
2. **個情法 27 条開示請求の SLA 30 日対応 workflow が無い** → 法的リスク → `/admin/data-rights` が次点
3. **`/contact` が DB 化されてない** → 取りこぼしリスク → `/admin/contacts` が即時必要

この 3 ページ + dashboard で運営の 80% を解消できる見込み。

---

## 9. 着手済 (2026-05-06 〜 2026-05-07)

- [x] `withAdminAuth` helper 抽出 (Tier1 前提条件)
- [x] `/admin/dashboard` 実装 (KPI 12 枚 + visibility-gated polling + Cache-Control)
- [x] `/admin/users` 一覧 (estimated count, debounce 検索)
- [x] `/admin/users/[id]` 詳細 (Overview / Audit Trail / Meetings の **3 タブ** 部分実装)
  - 残: Matches / Chats / Reports / Consent / Danger zone (5 タブ未実装)
  - 残: 停止 / BAN / 匿名化 RPC
- [x] `/admin/audit-logs` 検索 + cursor pagination + payload 折畳
  - 残: CSV export / 期間 picker / IntersectionObserver 自動 pagination
- [x] `/admin/import-requests` 取込申請 + 会議選択ダイアログ + Dialog 化
- [x] **`/admin/contacts` 受付 inbox** (migration 00043 + 公開フォーム + SLA 24h/4h)
- [x] migration 00033-00044 (audit_logs 統一 / RLS 補強 / WORM trigger / 楽観ロック)

## 10. 未着手 (今後の予定)

### Tier1 残
- [ ] `/admin/data-rights` (個情法 27 条 30 日 SLA / 新規テーブル + state machine 必要)
- [ ] `/admin/transcripts` (AI 抽出レビュー workflow / confidence < 0.8 公開 block)
- [ ] `/admin/users/[id]` の残 5 タブ (Matches / Chats / Reports / Consent / Danger zone)
- [ ] `audit_log_seals` (SHA-256 ハッシュチェーン WORM / 7 年保持)
- [ ] admin 操作 middleware で reason 必須化 (現状は users/[id] のみ)

### Tier2 全機能 (詳細は §2)

### Tier3 全機能 (詳細は §3)

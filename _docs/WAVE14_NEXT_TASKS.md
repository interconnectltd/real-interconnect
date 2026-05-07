# Wave14 次回編集課題メモ (2026-05-07)

ユーザー指摘事項を未実装のまま履歴に残す。 実装は次セッション以降。

---

## 1. tl;dv 連携: 同時刻に複数社別々の会議が走った時の挙動

**現状**: `/settings` の「ミーティング分析 (tl;dv 連携)」セクションが「未接続」表示。 connect すると tl;dv の録画を AI 分析して関心領域を抽出する建付け (project_tldv_notion_rag.md と同根の設計)。

**指摘**: 「ここのミーティングは運営の tl;dv が自動で入る。 同じ時刻に複数社別々の会議があっても tl;dv は入れるのか?」

**確認すべき点**:
- tl;dv ボット (Recall.ai 系) の **同時参加上限**: 同 organization アカウントから複数 Meet/Zoom に同時 Join できるか?
- INTER CONNECT の運営アカウント 1 つで同時刻に N 件 (例: 14:00 開始の 5 ペア = 5 会議) に bot を入れる場合、 tl;dv plan の concurrent recording limit に当たる
- 同時刻ミーティングが N 件発生した時、 1 件しか録画できないなら **どの会議の bot を優先するか** のルール設計が必要 (firstcome / プレミアム会員優先 / 全員諦める)
- 録画失敗時に proposer / target に通知する経路が必要

**実装案**:
- `meeting_recordings` テーブルに `tldv_status` (queued / recording / failed_capacity / completed) 列追加
- `/scheduling/confirm` 後の bot dispatch worker で capacity check → 失敗時 chat に「録画は今回入りません」通知
- tl;dv API (もしくは Recall.ai) の concurrent limit を `.env` で `TLDV_MAX_CONCURRENT=5` に設定

---

## 2. 運営側 Google Calendar API で Meet/Zoom/Teams 自動発行

**現状**: `/scheduling/confirm` route で proposer の OAuth Calendar token (個人) で Meet event 生成。 → Calendar 未連携 user は manual fallback で URL 後共有。

**指摘**: 「運営側の Google Calendar API も活用して、 皆の MT の Meet 勝手に発行してリンク渡してほしい。 Meet、 Zoom、 Teams 選べるようにしてほしい。」

**実装案**:
- 運営アカウント (例: `meetings@inter-connect.app`) の Google Workspace Calendar に **専用 service account** で event を作る経路を追加
- ユーザー個人の Calendar 連携を必須化しなくても、 全員に Meet URL が渡る (= dead-end の根本解消)
- `/scheduling/confirm` body に `provider: "google_meet" | "zoom_meeting" | "ms_teams"` 拡張、 platform 既定は `data.platform === "google_meet"` かつ proposer 連携無し → 運営アカウント経由で生成
- Zoom: Zoom OAuth Server-to-Server で会議室自動生成 API (`POST /users/me/meetings`) を運営アカウントから叩く
- Teams: Microsoft Graph `POST /me/onlineMeetings` を運営 Workspace アカウントで叩く
- 環境変数:
  - `OPS_GOOGLE_SA_KEY_JSON` (運営 Google Workspace SA 鍵)
  - `OPS_ZOOM_S2S_CLIENT_ID` / `OPS_ZOOM_S2S_CLIENT_SECRET` / `OPS_ZOOM_ACCOUNT_ID`
  - `OPS_MS_TENANT_ID` / `OPS_MS_CLIENT_ID` / `OPS_MS_CLIENT_SECRET`
- Settings 画面に「会議プロバイダ」既定値選択 (Meet / Zoom / Teams) UI を追加し、 `user_profiles.preferred_meeting_provider` 列で永続化
- セキュリティ: 運営 SA で他人の Calendar に勝手に書き込むのではなく **専用 calendar** に event 作成し attendees に user を招待する形にする (権限境界明確化)

---

## 3. カレンダー連携 / AI プロフィール管理が機能してるか実機確認

**指摘**: 「カレンダー連携や、 AI プロフィール管理 も機能いけてるのか?」

**確認すべき**:
- `/settings` の「Google Calendar 連携」ボタン → POST `/api/v1/calendar/connect` → 同意ログ未済なら 403 CONSENT_REQUIRED → **dead-end** (Wave13 で確認、 settings に dialog 経路無し / `meeting_consents` への INSERT 経路存在しない)
- 「AI プロフィール管理」: tl;dv 録画から AI 分析 → `user_profiles.skills` / `interests` 自動更新の動線。 録画 0 件の状態で UI に「分析待ち」が永遠に出続けないか
- onboarding で `availability_rules` を seed するフローが無い → 新規 user の `/scheduling/suggest` が常に 0 件返却 (Wave12 BUG-5 既知)

**実装案** (Wave13 R3 で deferred 済):
- `/api/v1/calendar/consent` POST endpoint (meeting_consents へ INSERT)
- settings に AlertDialog で「Google への越境送信に同意する」CTA → 同意 record → POST connect
- onboarding step に「平日 9-18 デフォルト」または対話式の availability rules seed wizard

---

## 4. 通知許可しても消えないバナー (UX)

**指摘**: 「通知の許可しても消えないんだけどこれはいいの? UX 考えて。 どっちでもいいけど。」

**確認すべき**:
- どの画面のどのバナーか特定 (header / dashboard / settings の中?)
- Notification API の permission 状態を localStorage / Supabase 側に同期できているか
- 「許可」押下 → permission='granted' になっても banner が再表示される条件分岐ミス疑い

**実装案**:
- `useNotificationPermission()` hook で `Notification.permission` を購読し `granted` になったら banner を非表示
- ユーザー dismiss を localStorage に記録し N 日間再表示しない (= soft dismiss)
- 既に granted な環境で banner 見えた時の repro を録画 → CSP / Service Worker 周りの状態 mismatch を疑う

---

## 5. 通知設定: 通知種別ごとの届け先 (メール / Facebook / Push)

**現状 UI**: 「コネクション通知」「マッチング通知」「会議通知」のトグルがある。

**指摘**:
- 「これの通知設定もメールにしっかりくるのか?」
- 「Facebook で通知送れないのか?」

**確認すべき**:
- 通知 worker (`worker/src/index.ts` 等) が:
  - 各種 event でメール送信しているか (Resend / SendGrid 経路の実装有無)
  - メール template が3 種類分用意されているか
  - 1 通も来ない / 1 種類しか来ない 等の漏れ
- Facebook Messenger Bot 連携: そもそも Facebook Page と連携する Bot Framework が無い → **未実装**

**実装案**:
- メール: 既に Resend 等で送られているなら 3 種類の event を叩いた actual email を実機で確認、 来てなければ template + worker handler 追加
- Facebook: Meta Messenger Platform の Facebook Page 連携 + webhook で送信、 ただし **B2B SaaS で Facebook 通知は珍しい**ので採用前にユーザー要望の本意確認 (「Facebook で送る」より「LINE / Slack / Discord で送る」の方が適切な可能性高)
- 通知設定 UI に「届け先」(メール / Push / LINE / Slack 等) を行ごとに選べる matrix UI を追加
  ```
  通知種別     | メール | Push | LINE
  -------------|--------|------|------
  コネクション | [✓]    | [✓]  | [ ]
  マッチング   | [✓]    | [ ]  | [✓]
  会議         | [✓]    | [✓]  | [✓]
  ```
- DB: `user_notification_prefs` (user_id, kind, channel, enabled) で N×M 管理

---

## 優先度付け (PM 視点)

| # | 課題 | 優先度 | 工数感 |
|---|------|--------|--------|
| 3 | カレンダー連携 dead-end (consent endpoint + dialog) | **P0** | 0.5 日 |
| 5-メール | 通知メール 3 種類が実際に届くか実機確認 + 修正 | **P0** | 0.5-1 日 |
| 4 | 通知許可後 banner が消えない | **P1** | 0.5 日 |
| 2 | 運営 Calendar API で Meet/Zoom/Teams 自動発行 | **P1** | 3-5 日 |
| 1 | tl;dv 同時刻複数会議の挙動確認 + 失敗通知 | **P1** | 1-2 日 |
| 5-FB | Facebook 通知 (要本意確認、 LINE/Slack の方が適切) | **P2** | 2-3 日 |

## 参考メモ

- 既知の Wave13 P1 残: SSOT MeetingConfirmedPayload 二重定義、 idempotency rate-limit decrement、 zoom_pmi_url Settings UI、 `calendar_event_id_organizer` nullable 化、 受信側 confirm 経路、 onboarding availability_rules seed
- Calendar 連携 dead-end (#3) は Wave13 R1 audit で P0 指摘済 (`agent: connect 403 CONSENT_REQUIRED dead-end`) 既に未対処状態が継続
- 課題 2 (運営 Calendar) を実装すると課題 3 の dead-end は実質迂回可能 (= 個人連携無くても Meet URL 配布される) ので 2 + 3 はセットで取り組むのが効率的

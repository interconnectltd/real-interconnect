# メール認証 (新規登録時) セットアップ手順書

> **目的**: Supabase 内蔵 SMTP の「4 通/時間」制限を解消し、メール認証を本番運用可能な状態に戻す。

---

## 全体像

```
┌─────────────────────────────────────────────────┐
│ あなたが手作業 (合計 約30分)                    │
│                                                 │
│   STEP 1: Resend を契約 (5分)                   │
│   STEP 2: DNS レコードを 3 つ追加 (10分)        │
│   STEP 3: Supabase Dashboard で SMTP 切替 (5分) │
│   STEP 4: メール認証を ON に戻す (1クリック)    │
│   STEP 5: メールテンプレを日本語に差替え (5分)  │
│   STEP 6: 動作確認 (テスト登録)                 │
└─────────────────────────────────────────────────┘
```

STEP 1〜4 完了時点で「4 通/時間」上限は解消し、メール認証が実用可能になります。
STEP 5〜6 は仕上げです。

---

## STEP 1: Resend を契約 (5 分)

1. <https://resend.com/signup> にアクセスして GitHub または Google でサインアップ
2. ログイン後、左メニュー **「Domains」** → **「Add Domain」** をクリック
3. ドメインに **`inter-connect.app`** を入力
4. Region は **Tokyo (ap-northeast-1)** を推奨(日本ユーザーへの配信レイテンシ最小化)
5. **「Add」** をクリック

すると次の画面で 3 種類の DNS レコード(SPF / DKIM / DMARC)が表示されます。
**この画面を開いたまま** STEP 2 へ進んでください。

---

## STEP 2: DNS レコードを追加 (10 分)

Resend が表示する DNS レコード(例)を、`inter-connect.app` の **DNS 管理画面**で追加します。

### 追加するレコード (Resend 画面の値をコピペ)

| 種類 | ホスト名 (Name) | 値 (Value) | 用途 |
|------|---|---|---|
| **TXT** | `send.inter-connect.app` | `v=spf1 include:amazonses.com ~all` | SPF (送信元 IP 認証) |
| **TXT** | `resend._domainkey.inter-connect.app` | `p=MIGfMA0GCSqGSIb3...` (長い文字列) | DKIM (署名検証) |
| **MX** | `send.inter-connect.app` | `feedback-smtp.ap-northeast-1.amazonses.com` (priority `10`) | Bounce 受信 |

> **注意**: 実際の値は Resend 画面に表示される値を **そのままコピペ**してください。
> 上記はサンプルです(特に DKIM の `p=` 以降は長くて環境ごとに異なります)。

### DNS 管理画面の場所(代表例)

| ドメイン取得元 | DNS 管理画面 |
|---|---|
| Cloudflare | dash.cloudflare.com → DNS → Records |
| Route 53 | AWS Console → Route 53 → Hosted zones → `inter-connect.app` |
| お名前.com | DNS 設定/転送設定 → DNS レコード設定 |
| Google Domains / Squarespace | DNS → Custom records |

### 追加時の注意点

- `Name` 欄に **末尾の `.inter-connect.app` まで含めて貼り付けない**ように
  注意してください。多くの DNS プロバイダは自動的にドメインを補完します。
  たとえば `send.inter-connect.app` の場合、`Name` には `send` だけ入力します。
- **TTL** は 3600(1時間)で OK。
- **既存の SPF レコード(他のメール送信元向け)があると競合します**。
  既に `v=spf1 ...` がドメインのルートにある場合は、Resend のサポートに統合方法を確認してください。
  純粋に Resend 専用ドメインなら問題ありません。

### 反映確認

1. DNS レコードを追加したら Resend の Domain 画面に戻る
2. **「Verify DNS Records」** ボタンをクリック
3. 通常 1〜10 分で全て **緑のチェックマーク**になります
4. **5 分待っても認証されない場合**:
   - DNS の伝播待ち(15〜30 分かかる場合あり)
   - `dig TXT resend._domainkey.inter-connect.app` で値が見えるか確認
5. 全て緑になったら STEP 3 へ

---

## STEP 3: Supabase Dashboard で SMTP を切り替え (5 分)

### 3-1. API Key を発行

1. Resend Dashboard → 左メニュー **「API Keys」** → **「Create API Key」**
2. 名前: `supabase-smtp`(任意)
3. Permission: **「Sending access」** を選択(全権限 `Full access` は付与しない)
4. Domain: **`inter-connect.app` を選択**
5. **「Add」** をクリック → 表示される `re_xxxxxxxxxxxxxx` を **必ずコピー**
   (一度しか表示されません。閉じたら再発行)

### 3-2. Supabase Dashboard で設定

1. <https://supabase.com/dashboard> → プロジェクト選択
2. 左メニュー **「Project Settings」** (歯車アイコン) → **「Authentication」**
3. **「SMTP Settings」** セクションまでスクロール
4. **「Enable Custom SMTP」** トグルを **ON**
5. 以下の値を入力:

   | 項目 | 値 |
   |---|---|
   | **Sender email** | `noreply@inter-connect.app` |
   | **Sender name** | `interconnect`(または好みの表示名) |
   | **Host** | `smtp.resend.com` |
   | **Port number** | `465` |
   | **Minimum interval between emails being sent** | `60` (秒) |
   | **Username** | `resend` (固定文字列) |
   | **Password** | `re_xxxxxxxxxxxxxx` (STEP 3-1 でコピーした API Key) |

6. ページ下部 **「Save」** をクリック

### 3-3. Rate Limits を緩める(任意だが推奨)

1. 同じ画面の少し上、**「Rate Limits」** セクション
2. **「Rate limit for sending emails」** を **`30`** (毎時) に変更
   (custom SMTP 配下では Resend 側の制限が支配的になるので、Supabase 側は緩めに)
3. **「Save」** をクリック

---

## STEP 4: メール認証を ON に戻す (1 クリック)

1. Supabase Dashboard → **「Authentication」** → **「Sign In / Up」** タブ
2. **「Email」** プロバイダの詳細を展開
3. **「Confirm email」** トグルを **ON**
4. **「Save」** をクリック

これで「新規登録 → 確認メールリンクをクリックしないとログイン不可」の状態に戻ります。

---

## STEP 5: メールテンプレを日本語に差替え (5 分)

### 5-1. Supabase Dashboard でテンプレを開く

1. Supabase Dashboard → **「Authentication」** → **「Email Templates」** タブ
2. **「Confirm signup」** を選択

### 5-2. Subject (件名)

```
【interconnect】メールアドレスをご確認ください
```

### 5-3. Message body (HTML) — 以下を丸ごと貼付

```html
<!DOCTYPE html>
<html lang="ja">
  <body style="margin:0;padding:0;background-color:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;border:1px solid #e6e8ec;">
            <tr>
              <td style="padding:32px 32px 24px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.5;color:#0f172a;font-weight:600;">
                  メールアドレスをご確認ください
                </h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#334155;">
                  interconnect へのご登録ありがとうございます。<br>
                  下のボタンをクリックして、メールアドレスの確認を完了してください。
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px;background-color:#0f172a;">
                      <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                        メールアドレスを確認する
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;line-height:1.7;color:#64748b;">
                  ボタンが開けない場合は、以下の URL をブラウザに貼り付けてください:<br>
                  <span style="word-break:break-all;color:#475569;">{{ .ConfirmationURL }}</span>
                </p>
                <hr style="margin:32px 0 16px;border:none;border-top:1px solid #e6e8ec;">
                <p style="margin:0;font-size:11px;line-height:1.7;color:#94a3b8;">
                  このメールに心当たりがない場合は破棄してください。<br>
                  リンクの有効期限は 24 時間です。
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">© interconnect</p>
        </td>
      </tr>
    </table>
  </body>
</html>
```

### 5-4. 「Save changes」をクリック

---

## STEP 6: 動作確認

### 6-1. テスト登録

1. 本番 (`https://inter-connect.app/register`) または preview 環境を開く
2. **自分が受信できるメールアドレス**で登録(招待コード必要)
3. `/register/sent` 画面に遷移すれば登録成功
4. 数十秒以内に確認メールが届く

### 6-2. チェックリスト

- [ ] 件名が日本語で `【interconnect】メールアドレスをご確認ください`
- [ ] 送信元が `noreply@inter-connect.app` (Supabase の noreply ではない)
- [ ] 迷惑メールフォルダに入っていない
- [ ] ボタンをクリックで `/login?confirmed=true` に遷移
- [ ] その後ログインできる

### 6-3. 再送テスト

1. 同じメールアドレスで再度登録を試みる → silent redirect で `/login?registered=true`
2. ログイン画面で「確認メールを再送する」ボタンをクリック
3. 30 分内に 3 回まで再送可能(4 回目は rate limit エラー)

### 6-4. 失敗時の切り戻し

「Confirm email」を OFF に戻せば、認証なしの状態に即座に戻せます。
SMTP 設定はそのまま残しても問題ありません(送信されないだけ)。

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| メールが届かない | Resend Domain 未認証 | Resend Dashboard で Domain ステータス確認 |
| メールが迷惑メールに入る | DKIM/SPF 未反映 | DNS 反映を待つ(最大 24h)。`dig` で値確認 |
| `over_email_send_rate_limit` が出る | Supabase 側 Rate Limit が低い | STEP 3-3 で Rate Limit を 30/h に引き上げ |
| `Invalid login: 535 Authentication failed` | API Key が `Sending access` 権限ない | API Key を作り直し |
| 確認リンクが `localhost` に飛ぶ | Site URL 未設定 | Auth → URL Configuration の Site URL を `https://inter-connect.app` に |
| Resend で `not delivered` ログ | 受信側で reject | Resend Dashboard → Logs で reason 確認 |

---

## なぜこの構成にしたか

### Resend を選んだ理由

| 観点 | Resend | AWS SES | SendGrid |
|---|---|---|---|
| 無料枠 | **3,000通/月** | 0(従量) | 100/日 |
| 単価 | $20/50K | $0.10/1K | $19.95/50K |
| 日本リージョン | ✅ Tokyo | ✅ ap-northeast-1 | ✅ |
| Bounce/Complaint UI | ✅ Dashboard | △ SNS自前構築 | ✅ |
| 開発者DX | ◎ | △ | ○ |
| 初期セットアップ難度 | 簡単 | 中(sandbox解除申請) | 簡単 |

→ **招待制で立ち上げ中の今は Resend 無料枠で十分。ボリュームが出てから SES へ移行も可能。**

### 環境変数 (.env) の変更は不要

SMTP 認証情報は **Supabase Dashboard 内に保存**されます。
アプリケーション側の `.env.local` は変更不要です。

### コード側で並行実装した補助機能 (Task 2〜5)

- **`/register/sent` 画面**: 登録後の道案内画面(60s cooldown 再送ボタン付き)
- **`/api/v1/auth/resend-confirmation`**: サーバー側 rate limit (IP + email) 付き再送 API
- **`register-form` の遷移先変更**: 成功時に `/register/sent?email=...` へ
- **`login-form` の再送ボタン**: 新 API に切替

これらは STEP 1〜4 と独立に動作するため、SMTP 切替の前後どちらでも安全です。

# 動画を補正するシステムの使い方（やさしく説明）

## このシステムは何をするの？

会議の録画動画を渡すと、**「誰が話したか」のラベルが間違っている所を AI が自動で直してくれる** システム。

例:
```
直す前:
  田島「最近 AI マッチング作ってて...」
  sara「採用支援です」
         ↑ 話してる人が逆になってる

直した後:
  sara「最近 AI マッチング作ってて...」
  田島「採用支援です」
         ↑ 正しくなった
```

---

## 使うための準備（最初に 1 回だけ）

すべて済んでいます。✅
- システムは sara の Mac の `/Users/sara/realinterconnect` にあります
- Supabase の DB にも準備済み

---

## 1 本の動画を補正する手順

### ステップ 1: tldv から動画をダウンロード

1. ブラウザで tldv を開く
2. 補正したい会議のページを開く
3. 「ダウンロード」ボタンを押す
4. メールにリンクが来る（数分待つ）
5. メールのリンクから mp4 をダウンロード
6. `~/Downloads/` に保存される

### ステップ 2: ファイル名を変える

ダウンロードした mp4 のファイル名を、こんな形に変更:

```
<相手の名前>-<会議の日付>.mp4
```

例:
- `田島-2026-05-10.mp4`
- `佐藤-2026-05-12.mp4`
- `Tajima-2026-05-10.mp4` (英字でも OK)

**ルール:**
- 名前と日付は **ハイフン（-）** か **アンダースコア（_）** で区切る
- 日付は **YYYY-MM-DD** 形式（例: 2026-05-10）
- 名前は相手の苗字でも、フルネームでも OK

**NG な例:**
- `会議.mp4` （日付がない）
- `2026-05-10-田島.mp4` （順番が逆）
- `Recording-xxx.mp4` （tldv のデフォルト名のまま）

### ステップ 3: ターミナルで実行

ターミナルアプリを開いて、以下を実行:

```bash
cd /Users/sara/realinterconnect
pnpm correct-speakers -- --video ~/Downloads/田島-2026-05-10.mp4 --write-db
```

（ファイル名の部分は実際の動画ファイル名に置き換える）

### ステップ 4: 15〜20 分待つ

裏で処理が走ります。コーヒー飲んでて OK ☕️

進捗が表示されます:
```
[phase] probe ...
[phase] extract-frames ...
[phase] classify-frames .........
[phase] extract-refs ...
[phase] classify-audio .....
[phase] merge ......
[phase] build-output .

=== Summary ===
  corrected segments : 17
  ...
```

### ステップ 5: 完了

最後にこう出れば成功:
```
✅ meeting_transcripts updated
✅ re-analyze enqueued: 2 new
```

DB に補正結果が書き込まれて、AI 要約も自動で更新されます。

---

## 複数本（80 本など）を一度に補正する手順

### ステップ 1: フォルダを用意

ターミナルで:
```bash
mkdir -p ~/tldv-downloads
```

### ステップ 2: 全部の動画を集める

80 本それぞれ:
1. tldv からダウンロード（メール経由）
2. 名前-日付.mp4 にリネーム
3. `~/tldv-downloads/` に入れる

最終的にフォルダの中身がこんな感じに:
```
~/tldv-downloads/
  田島-2026-05-10.mp4
  佐藤-2026-05-12.mp4
  山田-2026-05-15.mp4
  ...
  （80 本）
```

### ステップ 3: ターミナルで一括実行

```bash
cd /Users/sara/realinterconnect
pnpm batch-correct-speakers -- --yes
```

### ステップ 4: 寝る 😴

15 分 × 80 本 = 約 20 時間かかる。一晩〜2 晩放置すれば終わる。

途中で Ctrl+C で止めても、次回実行時に「既に処理した分は飛ばす」ので、安心して中断できます。

### ステップ 5: 翌朝確認

```bash
cat batch-report.json
```

失敗があれば、もう一度同じコマンドを叩くと、失敗した分だけ再処理されます:
```bash
pnpm batch-correct-speakers -- --yes
```

---

## 困ったとき

### 「ファイル名が間違ってる」と言われる

→ `<名前>-<YYYY-MM-DD>.mp4` の形式になっているか確認

### 「meeting が見つからない」と言われる

→ その動画の会議が Supabase の DB に登録されているか確認
→ tldv 同期が走っていない可能性あり

### 「Migration not applied」と言われる

→ DB の準備がまだ。`_docs/speaker-correction-migration.md` を参照

### 補正結果を取り消したい

```bash
pnpm correct-speakers -- --video /tmp/x.mp4 --reset --meeting-id <UUID>
```

（meeting_id は Supabase の meeting_transcripts テーブルから確認）

### 全部やり直したい

batch-report.json を消して、もう一度実行:
```bash
rm batch-report.json
pnpm batch-correct-speakers -- --yes --force-reprocess
```

---

## よく使うコマンド表

| やりたいこと | コマンド |
|---|---|
| 動画 1 本を補正 | `pnpm correct-speakers -- --video ~/Downloads/<名前>-<日付>.mp4 --write-db` |
| 動画 1 本で試す（DB 書かない） | 上に `--dry-run` を付ける |
| 複数本を一括補正 | `pnpm batch-correct-speakers -- --yes` |
| 巻き戻し | `pnpm correct-speakers -- --reset --meeting-id <UUID>` |

---

## このシステムの裏側（豆知識）

「3 つの判定者に投票させて、多数決で正解を決める」 仕組み:

```
判定者 ①  tldv の元の判定 (音声から)     ← これが間違うことがある
判定者 ②  Gemini AI が画面を見て判定    ← 青い枠を見る
判定者 ③  Gemini AI が声紋で判定        ← 声の特徴を聞く

3 人で多数決:
  全員一致     → 正しい
  ①だけ違う   → tldv が間違い → 直す
  ②だけ違う   → 信頼性下がるので保留
  ③だけ違う   → 信頼性下がるので保留
  バラバラ     → 保留
```

「①と②と③が独立してる」のがミソ。同じ間違いを 3 人とも同時にする確率は低いから、多数決が成り立つ。

---

## 最後に

何か困ったら、Claude (このチャット相手) に聞けば一緒に直せます。  
このファイルもいつでも読み返せます: `_docs/videosystem_explain.md`

最終更新: 2026-05-25

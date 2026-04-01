# INTERCONNECT フロントエンド＆デザインシステム実装計画書

**作成日**: 2026-03-31
**対象**: Phase 1 フロントエンド全域
**技術**: Next.js 15+ App Router / Tailwind CSS / shadcn/ui / Zustand / TanStack Query

---

## 1. ディレクトリ構造

```
src/
├── app/
│   ├── (public)/                    # 未認証ユーザー向け
│   │   ├── layout.tsx               # PublicLayout（ヘッダー+フッター）
│   │   ├── page.tsx                 # ホームページ（SSG）
│   │   ├── login/
│   │   │   └── page.tsx             # ログイン
│   │   ├── register/
│   │   │   └── page.tsx             # 新規登録
│   │   ├── forgot-password/
│   │   │   └── page.tsx             # パスワードリセット申請
│   │   ├── reset-password/
│   │   │   └── page.tsx             # 新パスワード設定
│   │   ├── auth/
│   │   │   └── callback/
│   │   │       └── page.tsx         # OAuthコールバック
│   │   ├── terms/
│   │   │   └── page.tsx             # 利用規約（SSG）
│   │   └── privacy/
│   │       └── page.tsx             # プライバシーポリシー（SSG）
│   │
│   ├── (auth)/                      # 認証後ユーザー向け
│   │   ├── layout.tsx               # AuthLayout（サイドバー+ヘッダー+Realtime購読）
│   │   ├── dashboard/
│   │   │   └── page.tsx             # ダッシュボード
│   │   ├── profile/
│   │   │   └── page.tsx             # プロフィール（表示+編集）
│   │   ├── connections/
│   │   │   └── page.tsx             # コネクション管理
│   │   ├── notifications/
│   │   │   └── page.tsx             # 通知一覧
│   │   ├── matching/
│   │   │   └── page.tsx             # マッチング一覧
│   │   ├── members/
│   │   │   └── page.tsx             # メンバー検索
│   │   └── settings/
│   │       └── page.tsx             # 設定
│   │
│   ├── api/
│   │   ├── v1/
│   │   │   ├── profiles/
│   │   │   │   ├── [id]/route.ts    # GET プロフィール
│   │   │   │   ├── me/route.ts      # PATCH 自分のプロフィール
│   │   │   │   └── avatar/route.ts  # POST アバターアップロード
│   │   │   ├── connections/route.ts  # GET/POST コネクション
│   │   │   ├── connections/[id]/route.ts # PATCH ステータス更新
│   │   │   ├── matching/
│   │   │   │   ├── scores/route.ts  # GET スコア一覧
│   │   │   │   ├── [userId]/route.ts # GET 詳細スコア
│   │   │   │   └── mutual/route.ts  # GET 相互マッチ
│   │   │   ├── notifications/route.ts    # GET/PATCH 通知
│   │   │   ├── notifications/read-all/route.ts # PATCH 一括既読
│   │   │   ├── bookmarks/route.ts   # GET/POST/DELETE
│   │   │   ├── members/route.ts     # GET メンバー検索
│   │   │   ├── profile-views/route.ts # POST 閲覧記録
│   │   │   └── health/route.ts      # GET ヘルスチェック
│   │   └── auth/
│   │       └── callback/route.ts    # Supabase Auth callback
│   │
│   ├── layout.tsx                   # RootLayout
│   ├── loading.tsx                  # グローバルローディング
│   ├── error.tsx                    # エラーバウンダリ
│   ├── not-found.tsx                # 404
│   └── middleware.ts                # 認証ガード + CSP
│
├── components/
│   ├── ui/                          # shadcn/ui Atoms
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── textarea.tsx
│   │   ├── select.tsx
│   │   ├── checkbox.tsx
│   │   ├── toggle.tsx
│   │   ├── radio-group.tsx
│   │   ├── badge.tsx
│   │   ├── avatar.tsx
│   │   ├── skeleton.tsx
│   │   ├── spinner.tsx
│   │   ├── tooltip.tsx
│   │   ├── popover.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── dialog.tsx
│   │   ├── sheet.tsx
│   │   ├── tabs.tsx
│   │   ├── card.tsx
│   │   ├── toast.tsx
│   │   └── toaster.tsx
│   │
│   ├── features/                    # Molecules & Organisms（機能別）
│   │   ├── profile/
│   │   │   ├── profile-card.tsx     # Molecule: プロフィール概要カード
│   │   │   ├── profile-modal.tsx    # Organism: フルプロフィール+スコア+CTA
│   │   │   ├── profile-edit-form.tsx # 編集フォーム
│   │   │   └── image-uploader.tsx   # 画像アップロード+プレビュー+進捗
│   │   ├── connections/
│   │   │   ├── connection-card.tsx  # Molecule: ステータス+アクション
│   │   │   └── connection-list.tsx  # Organism: タブ(全て/承認待ち/送信済み)+検索
│   │   ├── matching/
│   │   │   ├── match-card.tsx       # Organism: 双方向スコア+理由+CTA
│   │   │   ├── score-bar.tsx        # Molecule: 5軸水平バー+ツールチップ
│   │   │   └── bidirectional-score-display.tsx # Molecule: 左右並列スコア
│   │   ├── notifications/
│   │   │   ├── notification-toast.tsx # Molecule: auto消去+スタック
│   │   │   └── notification-list.tsx  # Organism: 一覧+actions実行+一括既読
│   │   ├── members/
│   │   │   └── member-list.tsx      # Organism: 検索+フィルター+一覧
│   │   ├── bookmarks/
│   │   │   └── bookmark-list.tsx    # Organism: 一覧+メモ+解除
│   │   ├── auth/
│   │   │   ├── login-form.tsx       # ログインフォーム
│   │   │   ├── register-form.tsx    # 登録フォーム+利用規約同意
│   │   │   ├── forgot-password-form.tsx
│   │   │   ├── reset-password-form.tsx
│   │   │   ├── password-change-form.tsx
│   │   │   └── facebook-login-button.tsx
│   │   └── dashboard/
│   │       └── stats-cards.tsx      # 統計カード群
│   │
│   ├── layouts/
│   │   ├── header.tsx               # Organism: ロゴ+ナビ+検索+通知ベル+メニュー
│   │   ├── sidebar.tsx              # Organism: ナビゲーション
│   │   ├── footer.tsx               # フッター
│   │   └── mobile-nav.tsx           # モバイル: ハンバーガー/ドロワー
│   │
│   └── shared/
│       ├── search-bar.tsx           # Molecule: 300msデバウンス検索
│       ├── pagination.tsx           # Molecule: ページネーション
│       ├── empty-state.tsx          # Molecule: ページ別空状態
│       └── confirm-dialog.tsx       # Molecule: 確認ダイアログ
│
├── hooks/
│   ├── queries/
│   │   ├── use-profile.ts          # useProfile(id)
│   │   ├── use-connections.ts       # useConnections(filter)
│   │   ├── use-notifications.ts     # useNotifications(unreadOnly)
│   │   ├── use-matching-scores.ts   # useMatchingScores(filter, sort)
│   │   ├── use-members.ts          # useMembers(search, filters)
│   │   ├── use-bookmarks.ts        # useBookmarks()
│   │   └── use-events.ts           # useEvents() (Phase 2)
│   ├── mutations/
│   │   ├── use-update-profile.ts
│   │   ├── use-request-connection.ts
│   │   ├── use-update-connection.ts
│   │   ├── use-mark-notification-read.ts
│   │   ├── use-toggle-bookmark.ts
│   │   └── use-upload-avatar.ts
│   ├── use-auth.ts                  # 認証状態Hook
│   ├── use-realtime-subscription.ts # Realtime購読
│   └── use-debounce.ts             # デバウンスユーティリティ
│
├── stores/
│   ├── ui-store.ts                  # モーダル/サイドバー/トースト
│   └── filter-store.ts             # 検索・フィルター条件
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # createBrowserClient
│   │   ├── server.ts               # createServerClient
│   │   └── middleware.ts            # Supabase middleware helper
│   ├── api-client.ts               # fetch wrapper with auth
│   ├── errors.ts                   # カスタムError + Toast連携
│   ├── utils.ts                    # cn() + 汎用ユーティリティ
│   └── constants.ts                # 定数定義
│
├── types/
│   ├── database.ts                 # Supabase CLI生成型
│   ├── profile.ts                  # Profile アプリ型
│   ├── connection.ts               # Connection アプリ型
│   ├── notification.ts             # Notification + Action型
│   ├── matching.ts                 # MatchScore, ScoreAxis型
│   ├── api.ts                      # APIレスポンス共通型 {data, error, meta}
│   └── index.ts                    # re-export
│
├── providers/
│   ├── supabase-provider.tsx        # Supabase Client Context
│   ├── query-provider.tsx           # TanStack Query + devtools
│   ├── theme-provider.tsx           # ダークモードProvider (Phase 2切替UI)
│   └── realtime-provider.tsx        # 通知Realtime購読
│
├── validations/
│   ├── auth.ts                      # ログイン/登録/リセット Zodスキーマ
│   ├── profile.ts                   # プロフィール更新 Zodスキーマ
│   └── connection.ts                # コネクション申請 Zodスキーマ
│
└── content/
    ├── terms.md                     # 利用規約
    └── privacy.md                   # プライバシーポリシー
```

### 命名規約

| 対象 | 規約 | 例 |
|------|------|-----|
| ファイル名 | kebab-case | `profile-card.tsx` |
| コンポーネント名 | PascalCase | `ProfileCard` |
| Hooks | useCamelCase | `useProfile` |
| ストア | camelCase + Store | `uiStore` |
| 型名 | PascalCase | `MatchScore` |
| CSS変数 | kebab-case | `--color-primary` |
| Tailwindトークン | kebab-case | `text-brand-primary` |

---

## 2. デザインシステム

### 2.1 設計原則

1. **人間の温かみ**: 冷たいテック感を排除。丸みと柔らかさを持たせる
2. **装飾排除**: 不要なグラデーション、パーティクル、イラストを使わない
3. **空白の活用**: 十分な余白で呼吸感を持たせる
4. **非対称レイアウト**: 均等3カラム反復を避け、視覚的リズムを作る

**禁止パターン**: 紫→青グラデーション / 均等3カラム反復 / ネオンカラー / アイソメトリックイラスト / 過剰パーティクル

### 2.2 カラーシステム

#### ブランドカラー

「信頼感 + 温かみ」を体現。深いティールグリーンで信頼感を、テラコッタのアクセントで人間的温もりを表現。

```
Primary (信頼・安定):
  50:  #E6F5F3
  100: #C2E8E3
  200: #99D9D0
  300: #6FC9BD
  400: #4FBDAE
  500: #2E9E8F  ← メイン
  600: #278A7C
  700: #1F7368
  800: #175C53
  900: #0E3F39
  950: #082723

Accent (温かみ・行動):
  50:  #FDF3ED
  100: #FADDCC
  200: #F5C0A3
  300: #F0A37A
  400: #EC8E5C
  500: #E8824A  ← メイン
  600: #D06F3A
  700: #AD5B2E
  800: #894823
  900: #653518
  950: #42220F
```

#### ニュートラル (Warm Gray)

```
  50:  #FAFAF9
  100: #F5F5F3
  200: #E8E7E5
  300: #D4D3D0
  400: #A8A7A3
  500: #7C7B77
  600: #5C5B58
  700: #454442
  800: #2E2D2B
  900: #1C1B1A
  950: #0F0E0E
```

#### セマンティック

```
Success:  300: #86EFAC  500: #22C55E  700: #15803D
Warning:  300: #FDE68A  500: #EAB308  700: #A16207
Error:    300: #FCA5A5  500: #EF4444  700: #B91C1C
Info:     300: #93C5FD  500: #3B82F6  700: #1D4ED8
```

#### 使用ルール

- Primary面積: 全体の10%以下（CTA、選択状態、アクティブ要素）
- Accent面積: 5%以下（重要な強調、通知バッジ）
- Neutral: 85%以上（背景、テキスト、ボーダー）

### 2.3 タイポグラフィ

```
フォント: Inter (欧文) + Noto Sans JP (和文)
読込み: next/font セルフホスト, display: swap

スケール:
  h1:      32px / bold / line-height: 1.25 / letter-spacing: -0.02em
  h2:      24px / bold / line-height: 1.3
  h3:      20px / semibold / line-height: 1.4
  h4:      16px / semibold / line-height: 1.5
  body-lg: 18px / regular / line-height: 1.8
  body:    16px / regular / line-height: 1.8 / max-width: 680px
  body-sm: 14px / regular / line-height: 1.7
  caption: 12px / regular / line-height: 1.5

数値: font-variant-numeric: tabular-nums
句読点: hanging-punctuation: first last
禁則処理: word-break: keep-all; overflow-wrap: break-word
```

### 2.4 スペーシング

```
4px基準スケール:
  0:   0px
  0.5: 2px
  1:   4px
  1.5: 6px
  2:   8px
  3:   12px
  4:   16px
  5:   20px
  6:   24px
  8:   32px
  10:  40px
  12:  48px
  16:  64px
  20:  80px
  24:  96px

コンテナ幅:
  prose:   680px   (本文テキスト)
  card:    960px   (カードグリッド)
  full:    1120px  (フルコンテンツ)

ブレイクポイント:
  sm:  640px
  md:  768px
  lg:  1024px
  xl:  1280px

余白リズム:
  重要な区切り → 広い余白 (48-96px)
  関連要素間   → 狭い余白 (8-16px)
  セクション間 → 中間余白 (24-48px)
```

### 2.5 シャドウ・ボーダー・角丸

```
シャドウ:
  sm:  0 1px 2px rgba(0,0,0,0.05)
  md:  0 4px 6px rgba(0,0,0,0.07)
  lg:  0 10px 15px rgba(0,0,0,0.1)

角丸:
  sm:   4px
  md:   8px
  lg:   12px
  xl:   16px
  full: 9999px

ボーダー:
  1px solid neutral-200 (控えめ、必要最低限)
```

### 2.6 アイコン

```
Lucide React
  ストローク: 1.5px
  サイズ: 16px (sm) / 20px (md) / 24px (lg)
  カラー: currentColor
```

### 2.7 globals.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Primary */
    --color-primary-50: 168 40% 93%;
    --color-primary-100: 168 40% 83%;
    --color-primary-200: 168 35% 73%;
    --color-primary-300: 168 32% 61%;
    --color-primary-400: 168 42% 53%;
    --color-primary-500: 168 55% 40%;
    --color-primary-600: 168 55% 35%;
    --color-primary-700: 168 55% 28%;
    --color-primary-800: 168 55% 22%;
    --color-primary-900: 168 62% 15%;
    --color-primary-950: 168 62% 9%;

    /* Accent */
    --color-accent-50: 24 82% 96%;
    --color-accent-100: 24 78% 89%;
    --color-accent-200: 24 74% 80%;
    --color-accent-300: 24 72% 71%;
    --color-accent-400: 24 78% 64%;
    --color-accent-500: 24 79% 60%;
    --color-accent-600: 24 58% 52%;
    --color-accent-700: 24 58% 43%;
    --color-accent-800: 24 58% 34%;
    --color-accent-900: 24 60% 25%;
    --color-accent-950: 24 60% 16%;

    /* Neutral (Warm Gray) */
    --color-neutral-50: 40 10% 98%;
    --color-neutral-100: 40 10% 96%;
    --color-neutral-200: 36 6% 91%;
    --color-neutral-300: 36 4% 83%;
    --color-neutral-400: 36 3% 66%;
    --color-neutral-500: 36 3% 48%;
    --color-neutral-600: 36 3% 36%;
    --color-neutral-700: 36 3% 26%;
    --color-neutral-800: 36 3% 18%;
    --color-neutral-900: 36 5% 11%;
    --color-neutral-950: 36 5% 6%;

    /* Semantic */
    --color-success: 142 71% 45%;
    --color-warning: 48 96% 53%;
    --color-error: 0 84% 60%;
    --color-info: 217 91% 60%;

    /* Layout */
    --background: var(--color-neutral-50);
    --foreground: var(--color-neutral-900);
    --card: 0 0% 100%;
    --card-foreground: var(--color-neutral-900);
    --muted: var(--color-neutral-100);
    --muted-foreground: var(--color-neutral-500);
    --border: var(--color-neutral-200);
    --ring: var(--color-primary-500);
    --radius: 8px;
  }

  .dark {
    --background: var(--color-neutral-950);
    --foreground: var(--color-neutral-100);
    --card: var(--color-neutral-900);
    --card-foreground: var(--color-neutral-100);
    --muted: var(--color-neutral-800);
    --muted-foreground: var(--color-neutral-400);
    --border: var(--color-neutral-700);
    --ring: var(--color-primary-400);
  }
}

@layer base {
  body {
    @apply bg-background text-foreground antialiased;
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
    font-variant-numeric: tabular-nums;
  }

  h1 { @apply text-[32px] font-bold leading-[1.25] tracking-[-0.02em]; }
  h2 { @apply text-[24px] font-bold leading-[1.3]; }
  h3 { @apply text-[20px] font-semibold leading-[1.4]; }
  h4 { @apply text-[16px] font-semibold leading-[1.5]; }
}
```

### 2.8 tailwind.config.ts

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "hsl(var(--color-primary-50) / <alpha-value>)",
          100: "hsl(var(--color-primary-100) / <alpha-value>)",
          200: "hsl(var(--color-primary-200) / <alpha-value>)",
          300: "hsl(var(--color-primary-300) / <alpha-value>)",
          400: "hsl(var(--color-primary-400) / <alpha-value>)",
          500: "hsl(var(--color-primary-500) / <alpha-value>)",
          600: "hsl(var(--color-primary-600) / <alpha-value>)",
          700: "hsl(var(--color-primary-700) / <alpha-value>)",
          800: "hsl(var(--color-primary-800) / <alpha-value>)",
          900: "hsl(var(--color-primary-900) / <alpha-value>)",
          950: "hsl(var(--color-primary-950) / <alpha-value>)",
          DEFAULT: "hsl(var(--color-primary-500) / <alpha-value>)",
        },
        accent: {
          50: "hsl(var(--color-accent-50) / <alpha-value>)",
          100: "hsl(var(--color-accent-100) / <alpha-value>)",
          200: "hsl(var(--color-accent-200) / <alpha-value>)",
          300: "hsl(var(--color-accent-300) / <alpha-value>)",
          400: "hsl(var(--color-accent-400) / <alpha-value>)",
          500: "hsl(var(--color-accent-500) / <alpha-value>)",
          600: "hsl(var(--color-accent-600) / <alpha-value>)",
          700: "hsl(var(--color-accent-700) / <alpha-value>)",
          800: "hsl(var(--color-accent-800) / <alpha-value>)",
          900: "hsl(var(--color-accent-900) / <alpha-value>)",
          950: "hsl(var(--color-accent-950) / <alpha-value>)",
          DEFAULT: "hsl(var(--color-accent-500) / <alpha-value>)",
        },
        neutral: {
          50: "hsl(var(--color-neutral-50) / <alpha-value>)",
          100: "hsl(var(--color-neutral-100) / <alpha-value>)",
          200: "hsl(var(--color-neutral-200) / <alpha-value>)",
          300: "hsl(var(--color-neutral-300) / <alpha-value>)",
          400: "hsl(var(--color-neutral-400) / <alpha-value>)",
          500: "hsl(var(--color-neutral-500) / <alpha-value>)",
          600: "hsl(var(--color-neutral-600) / <alpha-value>)",
          700: "hsl(var(--color-neutral-700) / <alpha-value>)",
          800: "hsl(var(--color-neutral-800) / <alpha-value>)",
          900: "hsl(var(--color-neutral-900) / <alpha-value>)",
          950: "hsl(var(--color-neutral-950) / <alpha-value>)",
        },
        success: "hsl(var(--color-success) / <alpha-value>)",
        warning: "hsl(var(--color-warning) / <alpha-value>)",
        error: "hsl(var(--color-error) / <alpha-value>)",
        info: "hsl(var(--color-info) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        border: "hsl(var(--border) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "var(--font-noto-sans-jp)", "sans-serif"],
      },
      maxWidth: {
        prose: "680px",
        card: "960px",
        full: "1120px",
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 4px 6px rgba(0,0,0,0.07)",
        lg: "0 10px 15px rgba(0,0,0,0.1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

---

## 3. コンポーネント階層

### 3.1 Atoms (shadcn/ui ベース)

| コンポーネント | Props概要 |
|---------------|-----------|
| Button | variant: default/outline/ghost/destructive, size: sm/md/lg, loading: boolean |
| Input | type, placeholder, error: string |
| Textarea | rows, maxLength, error |
| Select | options[], value, onChange, placeholder |
| Checkbox | checked, onCheckedChange, label |
| Toggle | pressed, onPressedChange |
| RadioGroup | options[], value, onValueChange |
| Badge | variant: default/success/warning/error, removable, onRemove |
| Avatar | src, alt, size: xs/sm/md/lg/xl, fallback: string |
| Skeleton | className (寸法) |
| Spinner | size: sm/md/lg |
| Tooltip | content, side, delayDuration |
| Popover | trigger, content |
| DropdownMenu | trigger, items[] |
| Dialog | open, onOpenChange, title, description |
| Sheet | open, onOpenChange, side: left/right |
| Tabs | tabs: {value, label, content}[], defaultValue |
| Card | className, children |
| Toast | title, description, variant, action |

### 3.2 Molecules

| コンポーネント | Props概要 | 説明 |
|---------------|-----------|------|
| ProfileCard | profile, onView, onConnect | プロフィール概要（名前/会社/役職/業種+アバター） |
| ConnectionCard | connection, onAccept, onReject, onBlock | コネクション状態表示+アクションボタン群 |
| ScoreBar | axis: string, score: number, maxScore: number | 5軸水平バー+ツールチップ |
| BidirectionalScoreDisplay | myScore, theirScore, axes[] | 左右並列スコア表示 |
| NotificationToast | notification, onDismiss | auto消去(5秒)+スタック表示 |
| EmptyState | icon, title, description, action | ページ別空状態誘導 |
| ConfirmDialog | title, description, onConfirm, destructive | 確認ダイアログ（削除等） |
| SearchBar | value, onChange, placeholder, debounceMs=300 | デバウンス検索入力 |
| Pagination | page, totalPages, onPageChange | ページネーション |
| ImageUploader | onUpload, accept, maxSize, preview | 画像選択→プレビュー→アップロード→進捗 |

### 3.3 Organisms

| コンポーネント | 説明 |
|---------------|------|
| Header | ロゴ+ナビ+検索+通知ベル(未読バッジ)+ユーザーメニュー。モバイル:ハンバーガー |
| Sidebar | ナビリンク群+アクティブ状態。レスポンシブ対応 |
| MobileNav | ドロワー式ナビゲーション |
| MatchCard | 双方向スコア並列+理由+プロフィール概要+CTA。非対称デザイン |
| ProfileModal | フルプロフィール+双方向5軸内訳+コネクションCTA+contact_info(接続後) |
| NotificationList | 通知一覧+actionsホワイトリスト実行+フィルター(未読/全て)+一括既読 |
| BookmarkList | ブックマーク一覧+メモ+解除 |
| ConnectionList | タブ(全て/承認待ち/送信済み)+検索+承認/拒否/ブロック/削除 |
| MemberList | SearchBar+業種/スキルフィルター+一覧+ProfileModal+ブックマーク |
| LoginForm | Email/Password+Facebookログインボタン+「パスワード忘れた」リンク |
| RegisterForm | name/email/password/会社名/役職+利用規約同意チェック+招待コード |
| DashboardStats | 統計カード群（コネクション数/通知/マッチング等） |
| SettingsPanel | テーマ/通知設定/パスワード変更(PasswordChangeForm) |

### 3.4 ページ構成

| ページ | パス | 主要コンポーネント |
|--------|------|-------------------|
| ホーム | / | ヒーロー + 特徴 + CTA + ニュースセクション(md) (SSG) |
| ログイン | /login | LoginForm |
| 新規登録 | /register | RegisterForm |
| パスワードリセット | /forgot-password | ForgotPasswordForm |
| パスワード再設定 | /reset-password | ResetPasswordForm |
| OAuthコールバック | /auth/callback | セッション確立→リダイレクト |
| 利用規約 | /terms | 静的マークダウン (SSG) |
| プライバシーポリシー | /privacy | 静的マークダウン (SSG) |
| ダッシュボード | /dashboard | DashboardStats + マッチング推薦 |
| プロフィール | /profile | プロフィール表示+編集モーダル+ImageUploader |
| コネクション | /connections | ConnectionList (タブ) |
| 通知 | /notifications | NotificationList |
| マッチング | /matching | MatchCard一覧 + 相互おすすめ + フィルター/ソート |
| メンバー | /members | MemberList + ProfileModal |
| 設定 | /settings | SettingsPanel |

---

## 4. 状態管理設計

### 4.1 Zustand ストア

```typescript
// stores/ui-store.ts
interface UIStore {
  // サイドバー
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // モーダル
  profileModalUserId: string | null;
  openProfileModal: (userId: string) => void;
  closeProfileModal: () => void;

  // 確認ダイアログ
  confirmDialog: {
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
    destructive: boolean;
  } | null;
  showConfirmDialog: (config: ConfirmConfig) => void;
  closeConfirmDialog: () => void;
}

// stores/filter-store.ts
interface FilterStore {
  // メンバー検索
  memberSearch: string;
  memberIndustryFilter: string[];
  memberSkillFilter: string[];
  setMemberSearch: (q: string) => void;
  setMemberIndustryFilter: (industries: string[]) => void;
  setMemberSkillFilter: (skills: string[]) => void;
  resetMemberFilters: () => void;

  // マッチングフィルター
  matchingSortBy: 'score' | 'recent';
  matchingMinScore: number;
  setMatchingSortBy: (sort: 'score' | 'recent') => void;
  setMatchingMinScore: (min: number) => void;

  // コネクションフィルター
  connectionTab: 'all' | 'pending' | 'sent';
  setConnectionTab: (tab: string) => void;
}
```

### 4.2 TanStack Query キー設計

```typescript
const queryKeys = {
  profile: {
    all: ['profiles'] as const,
    detail: (id: string) => ['profiles', id] as const,
    me: () => ['profiles', 'me'] as const,
  },
  connections: {
    all: ['connections'] as const,
    list: (filter: ConnectionFilter) => ['connections', 'list', filter] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (unreadOnly: boolean) => ['notifications', 'list', { unreadOnly }] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
  },
  matching: {
    all: ['matching'] as const,
    scores: (filter: MatchFilter) => ['matching', 'scores', filter] as const,
    detail: (userId: string) => ['matching', 'detail', userId] as const,
    mutual: () => ['matching', 'mutual'] as const,
  },
  members: {
    all: ['members'] as const,
    list: (search: string, filters: MemberFilter) => ['members', 'list', search, filters] as const,
  },
  bookmarks: {
    all: ['bookmarks'] as const,
    list: () => ['bookmarks', 'list'] as const,
  },
} as const;
```

### 4.3 楽観的更新パターン

```typescript
// 例: コネクション承認
useMutation({
  mutationFn: (id: string) => api.patch(`/connections/${id}`, { status: 'accepted' }),
  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.connections.all });
    const previous = queryClient.getQueryData(queryKeys.connections.list(currentFilter));
    queryClient.setQueryData(queryKeys.connections.list(currentFilter), (old) =>
      old?.map(c => c.id === id ? { ...c, status: 'accepted' } : c)
    );
    return { previous };
  },
  onError: (_err, _id, context) => {
    queryClient.setQueryData(queryKeys.connections.list(currentFilter), context?.previous);
    toast.error('承認に失敗しました。もう一度お試しください。');
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
  },
});

// 同パターン適用対象:
// - 通知既読: notifications cache更新 → invalidate
// - ブックマーク追加/解除: bookmarks cache更新 → invalidate
```

### 4.4 Realtime連携

```typescript
// RealtimeProvider内で通知チャネル購読
// INSERT イベント → TanStack Query キャッシュを invalidate + トースト表示

supabase
  .channel(`notifications:${userId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `user_id=eq.${userId}`,
  }, (payload) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    showNotificationToast(payload.new);

    // バックグラウンド時 Web Notification API
    if (document.hidden && Notification.permission === 'granted') {
      new Notification(payload.new.title, { body: payload.new.message });
    }
  })
  .subscribe();
```

---

## 5. レスポンシブ設計

```
モバイルファースト: 375px起点
タッチターゲット: 最小 48x48px

レスポンシブ変換:
  - Header: デスクトップ=水平ナビ → モバイル=ハンバーガー+ドロワー
  - Sidebar: デスクトップ=常時表示 → モバイル=Sheet
  - カードグリッド: xl=3列 → lg=2列 → sm=1列
  - テーブル: デスクトップ=テーブル → モバイル=カード変換
  - ProfileModal: デスクトップ=Dialog → モバイル=フルスクリーンSheet
```

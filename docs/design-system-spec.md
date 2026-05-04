# INTER CONNECT UI Design System (画像8枚から抽出)

ChatGPT生成 8 枚 (`C:/Users/ooxmi/Downloads/INTER CONNECT＿UI_デザインシステム/`) のスペックをコード基盤に落とすためのリファレンス。

## 1. ブランドトーン
- **質実・信頼・エンタープライズ**。余白広め、不要な装飾なし。
- ロゴ (gradient C: teal → cyan → navy) を起点に色を決定。
- グラデは限定: ヒーロー帯/CTA/プログレスバー/ロゴのみ。本文・カードでは使わない。
- **禁止**: ネオン、紫→青グラデ、アイソメトリック、均等3カラム反復。

## 2. カラートークン
| Role | Light | 用途 |
|------|-------|------|
| primary | navy `#142033` (oklch ~0.22 0.06 255) | ボタン/強調文字 |
| primary-foreground | white | primary背景上の文字 |
| accent (brand-C) | teal `#23B8A4` (oklch ~0.72 0.12 180) | リンク・アクティブ・プログレス |
| accent-foreground | white | accent背景上の文字 |
| background | #FAFCFE 極薄blue tint | アプリbg |
| surface (card) | white | カード地 |
| surface-2 | #F4F7FB | セクション差し替え |
| border | #E5EAF1 | カード/入力 |
| muted | #F4F7FB | section差替bg |
| muted-foreground | #6B7280 | キャプション |
| placeholder | #9CA3AF | input placeholder |
| success | teal `#10B981` | OK/承認 |
| warning | amber `#F59E0B` | 注意 |
| destructive | red `#EF4444` | 失敗 |
| info | blue `#3B82F6` | 情報 |

ダークモード: bg navy `#0B1220`, surface `#152033`, primary はやや明るい teal-navy。

## 3. タイポ (Noto Sans JP + Inter)
| トークン | サイズ | 行間 | 太さ |
|---------|--------|-----|------|
| display | 36-44px | 1.15 | 700 |
| h1 | 28px | 1.25 | 700 |
| h2 | 22px | 1.3 | 600 |
| h3 | 18px | 1.35 | 600 |
| body | 14px | 1.6 | 400 |
| body-strong | 14px | 1.6 | 500-600 |
| caption | 12px | 1.5 | 400 |
| kpi-number | 32px | 1 | 700 (tabular-nums) |

## 4. 角丸/影
- radius-sm 6, md 10, **lg 14 (デフォ)**, xl 20, full
- shadow-sm: `0 1px 2px rgb(15 23 42 / 0.04)`
- shadow-md: `0 4px 16px rgb(15 23 42 / 0.06)`
- shadow-lg: `0 12px 32px rgb(15 23 42 / 0.08)`

## 5. スペーシング (8pt grid)
4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64

## 6. コンポーネント仕様

### Button
- 高さ: sm=36, **default=40**, lg=48
- radius-lg (14)
- variant=default → bg-primary text-white
- variant=accent → bg-accent text-white (新設)
- variant=gradient → linear teal→navy (CTA限定)
- variant=outline → border-input bg-background hover:bg-muted
- variant=ghost → bg無 hover:bg-muted
- focus: outline ring 3px ring-primary/40

### Input
- h-10, radius-lg, border 1px input
- focus: ring 3px ring-primary/30 + border-primary
- error: border-destructive ring-destructive/20

### Card
- bg-card (white), border 1px border, radius-lg, shadow-sm
- hover: shadow-md transition
- padding: p-5 (20px) デフォ

### KPI Card
- 縦並び: caption(12 muted) → number(32 bold navy) → delta (badge or arrow)
- icon は右上 24px muted

### Progress Bar
- 高さ 6px, bg-muted, fill `linear-gradient(90deg, teal, navy)` rounded-full

### Badge / Pill
- h-5 / h-6, px-2.5, rounded-full, text-xs medium
- semantic variants: success/warning/destructive/info → bg-{c}/12% text-{c}

### Avatar
- 円, size sm=32 / md=40 / lg=56
- border 1px white + ring optional

### Empty State
- 中央寄せ + 1px dashed border-muted-foreground/40 + lucide line icon (text-muted-foreground/40 32px) + caption + CTA

### Dialog / Modal
- max-w-md, radius-xl, shadow-lg, header pb-3 with separator, body p-6, footer flex-end gap-2

## 7. ページパターン

### ログイン
- Hero左カラム: brand graphic (gradient C 大型 + tagline) — 任意
- Right card: max-w-sm, card-shell with shadow-md, padding 32px
- 順序: ロゴ → 見出し (h1) → サブ → アラート(成功/エラー) → form → divider "または" → social buttons (LinkedIn/Facebook) → footer link

### ダッシュボード
- 上段: pageTitle + caption + refresh icon
- KPI Row: 4枚 grid-cols-4 (sm 2 / lg 4)
- 成熟度プログレス: 1枚 card 横長
- プロフィール完成度: 1枚 card 横長
- セクション (おすすめ/相互/新着): h2 + caption + "すべて見る" Button + grid 3カラム メンバーカード

### Member Card
- avatar 56 + name (16 medium) + role (12 muted) + 1行サマリ + tag chips + actions (Connect/Profile)

## 8. 状態の表現
- loading: skeleton (`bg-muted animate-pulse rounded-lg`) — サイズはコンテンツに合わせる
- empty: 上記 Empty State
- error: destructive bg-tint card (rounded-lg bg-destructive/10 p-4 text-destructive)

## 9. アクセシビリティ
- focus-visible 必須、ring 3px
- color contrast AA (text/bg ≥ 4.5)
- すべてのアイコンボタンに aria-label
- form の label-input pair は htmlFor

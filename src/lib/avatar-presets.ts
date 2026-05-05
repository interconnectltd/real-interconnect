/**
 * Avatar presets — 顔写真を載せたくないユーザー向けの選択肢。
 *
 * 設計:
 *   - SVG をインライン化して network round-trip ゼロ
 *   - 全 12 種、ロゴパレット (teal-green / cyan / mid-blue / navy) と warm 系を循環
 *   - 中身は幾何学パターン (3 wave / 4 dot / monogram など) で
 *     人間アバター感を残しつつ identity を持つ
 *   - プロフィールには `preset:<id>` 形式で保存し、UserAvatar 側で SVG 描画
 *
 * 規則:
 *   - id は kebab-case、安定し変更しない (DB に saved されるため)
 *   - preset:<id> は avatar_url カラムに直接書き込む
 */

export interface AvatarPreset {
  id: string;
  label: string;
  /** SVG <g> 内に挿入される図形 markup (viewBox は固定 0 0 96 96) */
  paint: string;
  /** 背景色 token (CSS変数) */
  bgVar: string;
  /** 前景色 token (CSS変数) */
  fgVar: string;
}

const VB = "0 0 96 96";

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: "teal-monogram",
    label: "ティール モノグラム",
    bgVar: "var(--brand-teal)",
    fgVar: "white",
    paint: `<text x="48" y="58" text-anchor="middle" font-family="Inter, sans-serif" font-size="34" font-weight="700" fill="currentColor">IC</text>`,
  },
  {
    id: "cyan-waves",
    label: "シアン ウェーブ",
    bgVar: "var(--brand-cyan)",
    fgVar: "white",
    paint: `<path d="M8 56 Q24 44 40 56 T72 56 T104 56" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M8 68 Q24 56 40 68 T72 68 T104 68" stroke="currentColor" stroke-width="3" fill="none" opacity="0.55" stroke-linecap="round"/>`,
  },
  {
    id: "blue-orbit",
    label: "ブルー オービット",
    bgVar: "var(--brand-blue)",
    fgVar: "white",
    paint: `<circle cx="48" cy="48" r="20" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="48" cy="48" r="6" fill="currentColor"/><circle cx="68" cy="48" r="3" fill="currentColor"/>`,
  },
  {
    id: "navy-square",
    label: "ネイビー グリッド",
    bgVar: "var(--brand-navy)",
    fgVar: "white",
    paint: `<rect x="32" y="32" width="14" height="14" fill="currentColor"/><rect x="50" y="32" width="14" height="14" fill="currentColor" opacity="0.6"/><rect x="32" y="50" width="14" height="14" fill="currentColor" opacity="0.6"/><rect x="50" y="50" width="14" height="14" fill="currentColor"/>`,
  },
  {
    id: "teal-arrow",
    label: "ティール アロー",
    bgVar: "color-mix(in oklab, var(--brand-teal) 18%, white)",
    fgVar: "var(--brand-teal-strong)",
    paint: `<path d="M30 60 L48 36 L66 60" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: "cyan-pulse",
    label: "シアン パルス",
    bgVar: "color-mix(in oklab, var(--brand-cyan) 18%, white)",
    fgVar: "var(--brand-cyan-strong)",
    paint: `<path d="M16 48 L36 48 L42 32 L52 64 L60 48 L80 48" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: "blue-network",
    label: "ブルー ネットワーク",
    bgVar: "color-mix(in oklab, var(--brand-blue) 18%, white)",
    fgVar: "var(--brand-blue-strong)",
    paint: `<line x1="30" y1="30" x2="66" y2="66" stroke="currentColor" stroke-width="2"/><line x1="66" y1="30" x2="30" y2="66" stroke="currentColor" stroke-width="2"/><circle cx="30" cy="30" r="6" fill="currentColor"/><circle cx="66" cy="30" r="6" fill="currentColor"/><circle cx="30" cy="66" r="6" fill="currentColor"/><circle cx="66" cy="66" r="6" fill="currentColor"/><circle cx="48" cy="48" r="7" fill="currentColor"/>`,
  },
  {
    id: "navy-handshake",
    label: "ネイビー ハンドシェイク",
    bgVar: "color-mix(in oklab, var(--brand-navy) 14%, white)",
    fgVar: "var(--brand-navy)",
    paint: `<path d="M24 50 L42 50 L48 44 L54 50 L72 50" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="44" r="3" fill="currentColor"/>`,
  },
  {
    // chart-5 = warm accent (warning/highlight) を再利用
    id: "warm-sun",
    label: "ウォーム サン",
    bgVar: "color-mix(in oklab, var(--chart-5) 22%, white)",
    fgVar: "color-mix(in oklab, var(--chart-5) 80%, var(--brand-navy))",
    paint: `<circle cx="48" cy="48" r="14" fill="currentColor"/><g stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="48" y1="20" x2="48" y2="28"/><line x1="48" y1="68" x2="48" y2="76"/><line x1="20" y1="48" x2="28" y2="48"/><line x1="68" y1="48" x2="76" y2="48"/><line x1="28" y1="28" x2="34" y2="34"/><line x1="62" y1="62" x2="68" y2="68"/><line x1="68" y1="28" x2="62" y2="34"/><line x1="34" y1="62" x2="28" y2="68"/></g>`,
  },
  {
    id: "navy-mountain",
    label: "ネイビー マウンテン",
    bgVar: "var(--brand-navy)",
    fgVar: "color-mix(in oklab, var(--brand-cyan) 60%, white)",
    paint: `<path d="M16 70 L36 38 L50 56 L62 42 L80 70 Z" fill="currentColor" opacity="0.85"/><circle cx="68" cy="28" r="5" fill="currentColor" opacity="0.7"/>`,
  },
  {
    id: "cyan-leaf",
    label: "シアン リーフ",
    bgVar: "var(--brand-cyan)",
    fgVar: "white",
    paint: `<path d="M30 66 Q30 30 66 30 Q66 66 30 66 Z" fill="currentColor" opacity="0.85"/><path d="M30 66 Q48 48 66 30" stroke="white" stroke-width="2" fill="none" opacity="0.6"/>`,
  },
  {
    id: "teal-spark",
    label: "ティール スパーク",
    bgVar: "var(--brand-teal)",
    fgVar: "white",
    paint: `<path d="M48 22 L52 44 L74 48 L52 52 L48 74 L44 52 L22 48 L44 44 Z" fill="currentColor"/>`,
  },
];

export const AVATAR_PRESET_PREFIX = "preset:";

export function isPresetAvatarUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(AVATAR_PRESET_PREFIX);
}

export function findPreset(url: string | null | undefined): AvatarPreset | null {
  if (!url || !isPresetAvatarUrl(url)) return null;
  const id = url.slice(AVATAR_PRESET_PREFIX.length);
  return AVATAR_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * SVG markup を data: URI に変換 (img.src で使えるが、SR では emoji 化されないため
 * UserAvatar 側で <svg> インライン描画を推奨)
 */
export function presetSvgViewBox(): string {
  return VB;
}

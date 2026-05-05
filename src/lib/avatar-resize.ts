/**
 * クライアント側で画像を複数解像度の WebP に圧縮するユーティリティ。
 *
 * 目的:
 *   50MB の元画像をそのまま配信するとメンバー一覧 20名分で 1GB を読み込むことになり
 *   mobile 4G で数十秒のラグになる。アップロード時に下記 4 variant を生成し、
 *   表示する size に応じて適切な軽量版を読み込ませる:
 *
 *     thumb (96x96, WebP)   → 約5KB    : sm/md avatar (リスト表示)
 *     sm    (256x256, WebP) → 約30KB   : lg avatar (Hero card)
 *     md    (512x512, WebP) → 約80KB   : xl avatar (Profile modal)
 *     main  (1024x1024, WebP) → 約150KB : 詳細画面 (拡大表示)
 *
 *   元 50MB → 合計約 250KB に圧縮。**16-200倍の表示高速化**。
 *
 * 実装:
 *   - OffscreenCanvas (高速) → 不可なら HTMLCanvasElement にフォールバック
 *   - createImageBitmap (zero-copy) → 不可なら <img>.onload にフォールバック
 *   - JPEG/PNG/WebP/GIF 入力対応
 *   - 縦横比を保持してアスペクト維持の resize
 *   - quality はサイズが小さいほど高め (thumb は鮮明さ重視)
 */

export interface AvatarVariant {
  /** "thumb" | "sm" | "md" | "main" */
  key: AvatarVariantKey;
  /** 一辺の最大ピクセル数 */
  maxDim: number;
  /** WebP 圧縮率 0.0-1.0 */
  quality: number;
}

export type AvatarVariantKey = "thumb" | "sm" | "md" | "main";

export const AVATAR_VARIANTS: AvatarVariant[] = [
  { key: "thumb", maxDim: 96, quality: 0.85 },
  { key: "sm", maxDim: 256, quality: 0.82 },
  { key: "md", maxDim: 512, quality: 0.8 },
  { key: "main", maxDim: 1024, quality: 0.78 },
];

interface ResizeResult {
  key: AvatarVariantKey;
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
}

async function loadImageBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // 一部ブラウザで HEIF/AVIF などが落ちることがあるためフォールバック
    }
  }
  // <img> 経由でデコード
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    // Canvas 描画に渡せるよう ImageBitmap-like を返す
    return img as unknown as ImageBitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function calcSize(srcW: number, srcH: number, maxDim: number): { w: number; h: number } {
  if (srcW <= maxDim && srcH <= maxDim) return { w: srcW, h: srcH };
  const ratio = Math.min(maxDim / srcW, maxDim / srcH);
  return {
    w: Math.max(1, Math.round(srcW * ratio)),
    h: Math.max(1, Math.round(srcH * ratio)),
  };
}

async function drawAndEncode(
  bitmap: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  // OffscreenCanvas が使えれば高速
  if (typeof OffscreenCanvas === "function") {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // ImageBitmap and HTMLImageElement are both drawable (CanvasImageSource)
      ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height);
      return await canvas.convertToBlob({ type: "image/webp", quality });
    } catch {
      // fall through to HTMLCanvasElement
    }
  }
  // HTMLCanvasElement フォールバック (Safari < 16 / SSR では typeof document が undefined)
  if (typeof document === "undefined") {
    throw new Error("Canvas unavailable on server");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas 2d context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/webp",
      quality,
    );
  });
}

/**
 * file から 4 variant の WebP Blob を並列生成。
 * 元画像が小さい場合 (例: 80x80) は maxDim より縮小せず、原寸で再エンコードのみ。
 */
export async function generateAvatarVariants(file: File): Promise<ResizeResult[]> {
  const bitmap = await loadImageBitmap(file);
  const asImg = bitmap as unknown as HTMLImageElement;
  const asBmp = bitmap as ImageBitmap;
  const srcW = asBmp.width || asImg.naturalWidth || 0;
  const srcH = asBmp.height || asImg.naturalHeight || 0;
  if (!srcW || !srcH) {
    throw new Error("画像の解像度を取得できませんでした");
  }

  const results = await Promise.all(
    AVATAR_VARIANTS.map(async ({ key, maxDim, quality }) => {
      const { w, h } = calcSize(srcW, srcH, maxDim);
      const blob = await drawAndEncode(bitmap, w, h, quality);
      return { key, blob, width: w, height: h, bytes: blob.size };
    }),
  );

  // ImageBitmap は明示 close でメモリ解放
  if ("close" in bitmap && typeof bitmap.close === "function") {
    bitmap.close();
  }
  return results;
}

/**
 * avatar_url から variant URL を導出。
 * 例:
 *   base = "https://.../avatars/<uid>/avatar.webp?t=123"
 *   variant("thumb") → "https://.../avatars/<uid>/avatar-thumb.webp?t=123"
 *
 * 旧 flat path (`<uid>.jpg`) や preset:<id> はそのまま返す (variant 不在)。
 */
export function variantAvatarUrl(
  baseUrl: string | null | undefined,
  variant: AvatarVariantKey | "main",
): string | null | undefined {
  if (!baseUrl) return baseUrl;
  if (baseUrl.startsWith("preset:")) return baseUrl;
  // /avatars/<uid>/avatar.webp(?...) を /avatars/<uid>/avatar-<variant>.webp(?...) に
  if (variant === "main") return baseUrl;
  return baseUrl.replace(
    /\/avatar(\.[a-zA-Z0-9]+)(\?|$)/,
    `/avatar-${variant}$1$2`,
  );
}

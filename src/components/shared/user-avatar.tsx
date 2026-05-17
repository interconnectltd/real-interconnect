"use client";

// 意図的 <img> 利用: variant URL 切替 + onError 時の retry fallback を必要とするため。
// next/image だと変動 src + retry pattern が壊れる。
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { findPreset, isPresetAvatarUrl, presetSvgViewBox } from "@/lib/avatar-presets";
import { variantAvatarUrl, type AvatarVariantKey } from "@/lib/avatar-resize";

interface UserAvatarProps {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** ATF (above-the-fold) 表示なら eager + high priority に */
  priority?: boolean;
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
  xl: "h-24 w-24 text-3xl",
};

/**
 * size → 必要な variant key の mapping。
 *
 * Display rendering size:
 *   sm = 32px  → thumb (96px = 3x DPR で十分)
 *   md = 40px  → thumb
 *   lg = 64px  → sm    (256px = 4x DPR で高精細)
 *   xl = 96px  → md    (512px = 5x DPR まで対応)
 *
 * これにより:
 *   - リスト 20名表示 (sm/md ばかり) は thumb 5KB × 20 = 100KB
 *     旧 main 150KB × 20 = 3MB から 30倍速
 *   - 詳細 modal (xl) でも 80KB で十分鮮明
 */
const sizeToVariant: Record<NonNullable<UserAvatarProps["size"]>, AvatarVariantKey> = {
  sm: "thumb",
  md: "thumb",
  lg: "sm",
  xl: "md",
};

/**
 * Avatar 表示の優先順:
 *   1. avatarUrl が `preset:<id>` → AVATAR_PRESETS から SVG 描画 (network なし)
 *   2. http(s)://...     → size に応じた variant URL を <img> で表示
 *   3. 不在 / エラー    → 名前頭文字 + ロゴ調 background
 */
export function UserAvatar({
  name,
  avatarUrl,
  size = "md",
  className = "",
  priority = false,
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  // avatarUrl 変更時に img エラー状態をリセット (意図的)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgError(false);
  }, [avatarUrl]);

  const sizeClass = sizeClasses[size];

  // 1. preset
  if (isPresetAvatarUrl(avatarUrl)) {
    const preset = findPreset(avatarUrl);
    if (preset) {
      return (
        <span
          role="img"
          aria-label={name ?? preset.label}
          className={`inline-flex shrink-0 overflow-hidden rounded-full ${sizeClass} ${className}`}
          style={{ backgroundColor: preset.bgVar, color: preset.fgVar }}
        >
          <svg
            viewBox={presetSvgViewBox()}
            xmlns="http://www.w3.org/2000/svg"
            className="h-full w-full"
            aria-hidden="true"
            // SVG paint markup is curated and trusted (lib/avatar-presets.ts)
            dangerouslySetInnerHTML={{ __html: preset.paint }}
          />
        </span>
      );
    }
  }

  // 2. uploaded image — size に応じた variant を選択
  if (avatarUrl && !imgError) {
    const variantKey = sizeToVariant[size];
    const src = variantAvatarUrl(avatarUrl, variantKey) ?? avatarUrl;
    return (
      <img
        src={src}
        alt={name ?? "avatar"}
        // ATF=eager, それ以外は lazy で初期表示を高速化
        loading={priority ? "eager" : "lazy"}
        // decoding=async でメインスレッドブロックを避ける
        decoding="async"
        // Chrome の fetchPriority hint (React は camelCase 必須)
        fetchPriority={priority ? "high" : "auto"}
        className={`${sizeClass} shrink-0 rounded-full object-cover ${className}`}
        onError={(e) => {
          // variant URL で失敗した場合、main URL に fallback してリトライ
          const target = e.currentTarget;
          if (target.src !== avatarUrl && target.dataset.retried !== "1") {
            target.dataset.retried = "1";
            target.src = avatarUrl;
            return;
          }
          setImgError(true);
        }}
      />
    );
  }

  // 3. initial fallback
  const initial = (name ?? "?").charAt(0).toUpperCase();
  const isLarge = size === "lg" || size === "xl";
  const fallbackBg = isLarge
    ? "bg-gradient-brand-soft ring-1 ring-border"
    : "bg-secondary";

  return (
    <div
      role="img"
      aria-label={name ? `${name} のアイコン` : "ユーザーアイコン"}
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full font-medium text-brand-navy ${fallbackBg} ${className}`}
    >
      <span aria-hidden="true">{initial}</span>
    </div>
  );
}

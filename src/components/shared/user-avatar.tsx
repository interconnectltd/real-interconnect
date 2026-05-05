"use client";

import { useEffect, useState } from "react";
import { findPreset, isPresetAvatarUrl, presetSvgViewBox } from "@/lib/avatar-presets";

interface UserAvatarProps {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
  xl: "h-24 w-24 text-3xl",
};

/**
 * Avatar 表示の優先順:
 *   1. avatarUrl が `preset:<id>` → AVATAR_PRESETS から SVG 描画 (network なし)
 *   2. http(s)://...     → <img> で表示、エラー時に initial fallback
 *   3. 不在 / エラー    → 名前頭文字 + ロゴ調 background
 */
export function UserAvatar({ name, avatarUrl, size = "md", className = "" }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
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

  // 2. uploaded image
  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? "avatar"}
        className={`${sizeClass} shrink-0 rounded-full object-cover ${className}`}
        onError={() => setImgError(true)}
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
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full font-medium text-brand-navy ${fallbackBg} ${className}`}
    >
      {initial}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";

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

export function UserAvatar({ name, avatarUrl, size = "md", className = "" }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  const initial = (name ?? "?").charAt(0).toUpperCase();
  const sizeClass = sizeClasses[size];

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

  // sm/md は flat (リスト内多数並ぶ場面でノイズ抑制)
  // lg/xl のみ gradient で「ブランド identity 強調」
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

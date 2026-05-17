"use client";

import dynamic from "next/dynamic";

/**
 * Server Component (auth/layout.tsx) から `dynamic({ ssr: false })` を直接呼ぶと
 * Next.js 16 で禁止されるため、Client Component 経由で wrap する。
 * ([[lazy-global-help-dock]] と同パターン)
 *
 * 効果: 全 20 ページの auth layout 初期 bundle から ProfileModal (414 行 + 子 352 行
 * ≒ 70KB gzipped) を外し、ユーザがプロフィールアイコン等を初めてクリックしたとき
 * だけ chunk を取得・hydrate する。
 *
 * SSR 安全性: Modal は open=false (profileModalUserId が null) で起動するため、
 * SSR 時に DOM へ展開する必要がない。ssr:false で完全に client-only にする。
 */
export const LazyProfileModal = dynamic(
  () =>
    import("./profile-modal").then((m) => ({
      default: m.ProfileModal,
    })),
  { ssr: false },
);

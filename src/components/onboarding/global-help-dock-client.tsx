"use client";

import dynamic from "next/dynamic";

/**
 * Server Component (auth/layout.tsx) から `dynamic({ ssr: false })` を直接呼ぶと
 * Next.js 16 で禁止されるため、Client Component 経由で wrap する。
 * 効果は同じ: 初期 JS bundle から GlobalHelpDock を外し、interactive 直後に hydrate。
 */
export const LazyGlobalHelpDock = dynamic(
  () =>
    import("./global-help-dock").then((m) => ({
      default: m.GlobalHelpDock,
    })),
  { ssr: false },
);

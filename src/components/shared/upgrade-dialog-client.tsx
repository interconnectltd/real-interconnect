"use client";

import dynamic from "next/dynamic";

export const LazyUpgradeDialog = dynamic(
  () =>
    import("./upgrade-dialog").then((m) => ({
      default: m.UpgradeDialog,
    })),
  { ssr: false },
);

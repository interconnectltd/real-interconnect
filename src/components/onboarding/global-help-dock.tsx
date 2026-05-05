"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { HelpDock } from "./help-dock";
import { restartDashboardTour } from "./dashboard-tour";
import { ProductTour } from "./product-tour";
import { getPageTourConfig } from "./page-tour-registry";

/**
 * 全 auth ページ共通の右下 ? FAB + そのページ専用 tour mount。
 *
 * メニュー:
 *   1. このページの使い方を見る (現在の pathname に対応する step を起動)
 *   2. ダッシュボードのガイド (Dashboard 上なら直接再開、それ以外なら遷移)
 *   3. よくある質問 / お問い合わせ
 */
export function GlobalHelpDock() {
  const pathname = usePathname();
  const router = useRouter();
  const onDashboard = pathname === "/dashboard";
  const pageConfig = getPageTourConfig(pathname);
  const hasPageTour = pageConfig !== null && pageConfig.steps.length > 0;

  // 現在ページの tour open 状態
  const [pageTourOpen, setPageTourOpen] = useState(false);

  function handleStartPageTour() {
    if (onDashboard) {
      // Dashboard は専用 tour なので registry の空 steps を使わず、別経路で起動
      restartDashboardTour();
      return;
    }
    if (hasPageTour) {
      setPageTourOpen(true);
      // localStorage clear で次回も自動表示する状態にもできるが、
      // 「明示的に再生」と「初回自動」を分離するため localStorage は触らない
    }
  }

  function handleStartDashboardTour() {
    if (onDashboard) {
      restartDashboardTour();
    } else {
      try {
        localStorage.removeItem("interconnect:tour:dashboard:v1");
      } catch {}
      router.push("/dashboard");
    }
  }

  return (
    <>
      <HelpDock
        onStartPageTour={handleStartPageTour}
        onStartDashboardTour={handleStartDashboardTour}
        pageTourLabel={pageConfig?.pageLabel}
        pageTourAvailable={onDashboard || hasPageTour}
      />
      {pageConfig && hasPageTour && (
        <ProductTour
          steps={pageConfig.steps}
          storageKey={pageConfig.storageKey}
          open={pageTourOpen}
          onClose={() => setPageTourOpen(false)}
        />
      )}
    </>
  );
}

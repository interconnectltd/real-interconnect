"use client";

import { usePathname, useRouter } from "next/navigation";
import { HelpDock } from "./help-dock";
import { restartDashboardTour } from "./dashboard-tour";

/**
 * 全 auth ページ共通の右下 ? FAB。
 * Dashboard 上では tour を直接再開、他ページでは Dashboard へ遷移して tour 起動。
 */
export function GlobalHelpDock() {
  const pathname = usePathname();
  const router = useRouter();
  const onDashboard = pathname === "/dashboard";

  function handleStartTour() {
    if (onDashboard) {
      restartDashboardTour();
    } else {
      // localStorage 直接書込み → Dashboard マウント時に open=true で起動
      try {
        localStorage.removeItem("interconnect:tour:dashboard:v1");
      } catch {}
      router.push("/dashboard");
    }
  }

  return <HelpDock onStartTour={handleStartTour} tourAvailable />;
}

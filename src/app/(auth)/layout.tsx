import dynamic from "next/dynamic";
import { Header } from "@/components/layouts/header";
import { Sidebar } from "@/components/layouts/sidebar";
import { ProfileModal } from "@/components/features/profile/profile-modal";

// HelpDock + page-tour-registry + ProductTour を初期 JS から外す。
// FAB は遅延 mount で OK (interactive 直後に hydrate 不要)
const GlobalHelpDock = dynamic(
  () =>
    import("@/components/onboarding/global-help-dock").then((m) => ({
      default: m.GlobalHelpDock,
    })),
  { ssr: false },
);

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex min-h-dvh flex-col pb-safe">
        <Header />
        <div className="flex flex-1">
          {/* タブレット (md=768+) からサイドバー表示。<lg は Sheet 経由 */}
          <aside className="hidden w-56 shrink-0 border-r md:block">
            <div className="sticky top-14 overflow-y-auto py-4">
              <Sidebar />
            </div>
          </aside>
          <main className="flex-1 overflow-x-hidden p-4 pb-24 md:p-6">{children}</main>
        </div>
      </div>
      <ProfileModal />
      <GlobalHelpDock />
    </>
  );
}

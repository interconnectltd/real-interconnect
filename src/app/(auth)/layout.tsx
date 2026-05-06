import { Header } from "@/components/layouts/header";
import { Sidebar } from "@/components/layouts/sidebar";
import { ProfileModal } from "@/components/features/profile/profile-modal";
// dynamic({ssr:false}) は Next.js 16 で Server Component 禁止 → Client wrapper 経由
import { LazyGlobalHelpDock as GlobalHelpDock } from "@/components/onboarding/global-help-dock-client";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Skip link (WCAG 2.4.1 Bypass Blocks) — focus 時のみ可視化 */}
      <a
        href="#main"
        className="sr-only z-[200] rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        本文へスキップ
      </a>
      <div className="flex min-h-dvh flex-col pb-safe">
        <Header />
        <div className="flex flex-1">
          {/* タブレット (md=768+) からサイドバー表示。<lg は Sheet 経由 */}
          <aside className="hidden w-56 shrink-0 border-r md:block">
            <div className="sticky top-14 overflow-y-auto py-4">
              <Sidebar />
            </div>
          </aside>
          <main
            id="main"
            tabIndex={-1}
            className="flex-1 overflow-x-hidden p-4 pb-24 outline-none landscape:pb-16 md:p-6"
          >
            {children}
          </main>
        </div>
      </div>
      <ProfileModal />
      <GlobalHelpDock />
    </>
  );
}

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
      <div className="flex min-h-dvh flex-col pb-safe">
        <Header />
        <div className="flex flex-1">
          {/* タブレット (md=768+) からサイドバー表示。<lg は Sheet 経由 */}
          <aside className="hidden w-56 shrink-0 border-r md:block">
            <div className="sticky top-14 overflow-y-auto py-4">
              <Sidebar />
            </div>
          </aside>
          <main className="flex-1 overflow-x-hidden p-4 pb-24 landscape:pb-16 md:p-6">{children}</main>
        </div>
      </div>
      <ProfileModal />
      <GlobalHelpDock />
    </>
  );
}

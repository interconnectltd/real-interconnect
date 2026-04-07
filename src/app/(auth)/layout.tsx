export const dynamic = "force-dynamic";

import { SupabaseProvider } from "@/providers/supabase-provider";
import { QueryProvider } from "@/providers/query-provider";
import { Header } from "@/components/layouts/header";
import { Sidebar } from "@/components/layouts/sidebar";
import { ProfileModal } from "@/components/features/profile/profile-modal";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SupabaseProvider>
      <QueryProvider>
        <div className="flex min-h-dvh flex-col">
          <Header />
          <div className="flex flex-1">
            <aside className="hidden w-56 shrink-0 border-r lg:block">
              <div className="sticky top-14 overflow-y-auto py-4">
                <Sidebar />
              </div>
            </aside>
            <main className="flex-1 p-4 lg:p-6">{children}</main>
          </div>
        </div>
        <ProfileModal />
      </QueryProvider>
    </SupabaseProvider>
  );
}

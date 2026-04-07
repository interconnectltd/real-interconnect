import { SupabaseProvider } from "@/providers/supabase-provider";
import { QueryProvider } from "@/providers/query-provider";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SupabaseProvider>
      <QueryProvider>
        <div className="flex min-h-dvh flex-col">
          <header className="border-b border-border/50">
            <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
              <span className="text-lg font-bold text-primary">INTERCONNECT</span>
            </div>
          </header>
          <main className="flex flex-1 items-start justify-center px-4 py-8">
            <div className="w-full max-w-2xl">{children}</div>
          </main>
        </div>
      </QueryProvider>
    </SupabaseProvider>
  );
}

/**
 * Admin section guard layout.
 *
 * Server-side enforces is_admin = true on user_profiles. 未認可ユーザーは
 * /dashboard に redirect。RLS + API 側 (ensureAdmin) でも別途保護されているが
 * UI 露出を防ぐ二重防御。
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Menu, Settings, User, LogOut } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useSupabase } from "@/providers/supabase-provider";
import { useUnreadCount } from "@/hooks/queries/use-notifications";
import { useMyProfile } from "@/hooks/queries/use-profile";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Sidebar } from "./sidebar";
import { useUIStore } from "@/stores/ui-store";

export function Header() {
  const { supabase } = useSupabase();
  const router = useRouter();
  const { data: unreadCount } = useUnreadCount();
  const { data: myProfile } = useMyProfile();
  const { sidebarOpen, setSidebarOpen } = useUIStore();

  async function handleSignOut() {
    await supabase.auth.signOut();
    // signOut → cookie 削除 → middleware が /login で許可、refresh は不要
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-safe pl-safe pr-safe">
      <div className="flex h-14 items-center gap-4 px-4 landscape:h-12 md:px-6">
        {/* Mobile menu — render prop merges SheetTrigger onto Button */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger
            // Trigger 自体が native <button> を render する。 buttonVariants
            // で <Button> と同じ見た目を直接当てる方式 (render={<Button>} を
            // 使うと base-ui の nativeButton 推論で warning が出るため)。
            className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "md:hidden")}
            aria-label="メニューを開く"
          >
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <p className="sr-only">ナビゲーションメニュー</p>
            <div className="p-4">
              <Link href="/dashboard" aria-label="INTER CONNECT" className="flex items-center">
                <Image
                  src="/interconnect-logo-header.png"
                  alt="INTER CONNECT"
                  width={723}
                  height={139}
                  sizes="160px"
                  className="h-6 w-auto"
                />
              </Link>
            </div>
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </SheetContent>
        </Sheet>

        <Link
          href="/dashboard"
          aria-label="INTER CONNECT"
          className="hidden items-center md:flex"
        >
          <Image
            src="/interconnect-logo-header.png"
            alt="INTER CONNECT"
            width={723}
            height={139}
            priority
            sizes="180px"
            className="h-7 w-auto"
          />
        </Link>

        <div className="flex-1" />

        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon-lg"
          render={<Link href="/notifications" />}
          className="relative"
          aria-label="通知"
        >
          <Bell className="h-5 w-5" />
          {unreadCount && unreadCount > 0 ? (
            <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>

        {/* User menu — render prop merges DropdownMenuTrigger onto Button */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "rounded-md")}
            aria-label="ユーザーメニュー"
          >
            {myProfile?.avatar_url ? (
              <UserAvatar
                name={myProfile.name}
                avatarUrl={myProfile.avatar_url}
                size="sm"
              />
            ) : (
              <User className="h-5 w-5" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem render={<Link href="/profile" />}>
              <User className="h-4 w-4" />
              プロフィール
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings" />}>
              <Settings className="h-4 w-4" />
              設定
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              ログアウト
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

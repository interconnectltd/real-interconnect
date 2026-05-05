"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  MessageCircle,
  Bell,
  Heart,
  Calendar,
  CalendarDays,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/matching", label: "マッチング", icon: Heart },
  { href: "/members", label: "メンバー", icon: Users },
  { href: "/connections", label: "コネクション", icon: UserCheck },
  { href: "/chat", label: "チャット", icon: MessageCircle },
  { href: "/calendar", label: "カレンダー", icon: CalendarDays },
  { href: "/meetings", label: "会議", icon: Calendar },
  { href: "/notifications", label: "通知", icon: Bell },
  { href: "/settings", label: "設定", icon: Settings },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-2">
      {navItems.map((item) => {
        // /me が /members にマッチしないよう exact または prefix+/ で判定
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

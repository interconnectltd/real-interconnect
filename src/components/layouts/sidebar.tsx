"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useMemo } from "react";
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
  Home,
  Share2,
  Settings2,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

// 中分類でグループ化 (モバイルで使用頻度が低いものを折り畳む)
const navGroups: NavGroup[] = [
  {
    id: "home",
    label: "ホーム",
    icon: Home,
    items: [
      { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
      { href: "/notifications", label: "通知", icon: Bell },
    ],
  },
  {
    id: "network",
    label: "ネットワーク",
    icon: Share2,
    items: [
      { href: "/matching", label: "マッチング", icon: Heart },
      { href: "/members", label: "メンバー", icon: Users },
      { href: "/connections", label: "コネクション", icon: UserCheck },
    ],
  },
  {
    id: "comms",
    label: "コミュニケーション",
    icon: MessageCircle,
    items: [
      { href: "/chat", label: "チャット", icon: MessageCircle },
      { href: "/calendar", label: "カレンダー", icon: CalendarDays },
      { href: "/meetings", label: "会議", icon: Calendar },
    ],
  },
  {
    id: "settings",
    label: "設定",
    icon: Settings2,
    items: [
      { href: "/settings", label: "設定", icon: Settings },
    ],
  },
];

function isPathInGroup(pathname: string, group: NavGroup): boolean {
  return group.items.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  // 現在ページが含まれる group だけ default で open、他は閉じる
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    for (const g of navGroups) if (isPathInGroup(pathname, g)) set.add(g.id);
    return set;
  }, [pathname]);

  const [openGroups, setOpenGroups] = useState<Set<string>>(initialOpen);

  const toggle = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="メインナビゲーション">
      {navGroups.map((group) => {
        const isOpen = openGroups.has(group.id);
        const groupActive = isPathInGroup(pathname, group);
        const panelId = `nav-group-${group.id}`;

        return (
          <div key={group.id} className="flex flex-col">
            {/* 中分類トリガー (タップで展開/折り畳み) */}
            <button
              type="button"
              onClick={() => toggle(group.id)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className={cn(
                "flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70",
                groupActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-3">
                <group.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {group.label}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
                  isOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>

            {/* 小分類リスト (展開時のみ表示) */}
            {isOpen && (
              <div id={panelId} role="region" className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

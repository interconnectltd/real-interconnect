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
  ShieldCheck,
  Inbox,
  LayoutGrid,
  ScrollText,
  Bookmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyProfile } from "@/hooks/queries/use-profile";

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
      { href: "/bookmarks", label: "保存したメンバー", icon: Bookmark },
    ],
  },
  {
    id: "comms",
    label: "コミュニケーション",
    icon: MessageCircle,
    items: [
      { href: "/chat", label: "チャット", icon: MessageCircle },
      { href: "/meetings?tab=calendar", label: "カレンダー", icon: CalendarDays },
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

// is_admin = true ユーザーのみに表示される運営セクション。
// 通常ナビとは色調を分け (emerald accent) 「越権領域」であることを視覚化する。
const adminGroup: NavGroup = {
  id: "admin",
  label: "運営",
  icon: ShieldCheck,
  items: [
    { href: "/admin/dashboard", label: "ダッシュボード", icon: LayoutGrid },
    { href: "/admin/users", label: "ユーザー", icon: Users },
    { href: "/admin/import-requests", label: "取込申請", icon: Inbox },
    { href: "/admin/audit-logs", label: "監査ログ", icon: ScrollText },
  ],
};

function isPathInGroup(pathname: string, group: NavGroup): boolean {
  return group.items.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: myProfile } = useMyProfile();
  const isAdmin = Boolean(myProfile?.is_admin);

  // 現在ページが含まれる group だけ default で open、他は閉じる
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    const all = isAdmin ? [...navGroups, adminGroup] : navGroups;
    for (const g of all) if (isPathInGroup(pathname, g)) set.add(g.id);
    return set;
  }, [pathname, isAdmin]);

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

      {/* ── 運営セクション (admin のみ) ──
       * 通常ナビと罫線で視覚的に区切り、ラベル/アクセントを emerald 系に
       * 切り替えて「権限スコープが違う領域」だと一目で分かるようにする。
       */}
      {isAdmin && (
        <div className="mt-3 border-t border-border pt-3">
          {/* WCAG AA: 4.5:1 を担保するため alpha を外し emerald-700 / 300 を使用 */}
          <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            Admin
          </p>
          <AdminGroup
            group={adminGroup}
            pathname={pathname}
            isOpen={openGroups.has(adminGroup.id)}
            onToggle={() => toggle(adminGroup.id)}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </nav>
  );
}

function AdminGroup({
  group,
  pathname,
  isOpen,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const groupActive = isPathInGroup(pathname, group);
  const panelId = `nav-group-${group.id}`;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          "flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70",
          groupActive
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground hover:bg-emerald-50/60 hover:text-emerald-700 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300",
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

      {isOpen && (
        <div
          id={panelId}
          role="region"
          className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-emerald-300/50 pl-2 dark:border-emerald-800/60"
        >
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
                    ? "bg-emerald-100/80 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                    : "text-muted-foreground hover:bg-emerald-50/60 hover:text-emerald-700 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300",
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
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HelpCircle, MapPin, Home, MessageSquare, BookOpen, X } from "lucide-react";

interface HelpDockProps {
  /** 「このページの使い方を見る」コールバック (pathname に応じた step を起動) */
  onStartPageTour?: () => void;
  /** 「ダッシュボードのガイドを再生」コールバック (Dashboard 全体のオンボーディング) */
  onStartDashboardTour?: () => void;
  /** メニュー文言: pathname のページ名 (例: "メンバー") */
  pageTourLabel?: string;
  /** このページの専用 tour が利用可能か */
  pageTourAvailable?: boolean;
  /** @deprecated レガシー互換: 過去の単一 tour 用 */
  onStartTour?: () => void;
  tourAvailable?: boolean;
}

/**
 * HelpDock — 右下に常駐する「?」FAB。
 * クリックで Popover メニュー (使い方ガイド / FAQ / お問い合わせ)。
 *
 * 設計:
 *   - `<aside>` で意味付け、aria-label="ヘルプメニュー"
 *   - position: fixed, bottom + safe-area-inset
 *   - 閉じる: ESC / 外側クリック / メニュー選択後
 *   - メニュー項目は <a>/<Link>/<button> で操作 + aria-current 不要 (永続選択なし)
 *   - 親レイアウトに干渉しない z-index と pointer-events 設計
 */
export function HelpDock({
  onStartPageTour,
  onStartDashboardTour,
  pageTourLabel,
  pageTourAvailable = false,
  onStartTour,
  tourAvailable,
}: HelpDockProps) {
  // レガシー互換: onStartTour が渡された場合は dashboard tour として扱う
  const startDashboard = onStartDashboardTour ?? onStartTour;
  const startPage = onStartPageTour;
  const dashAvailable = onStartDashboardTour != null || (tourAvailable ?? false);
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Open 時に最初のメニュー項目にフォーカス
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items[0]?.focus();
  }, [open]);

  // ESC / 外側クリック / 矢印キー (ARIA APG menu pattern)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        fabRef.current?.focus();
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? items.indexOf(active) : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(idx + 1 + items.length) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || fabRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <aside
      aria-label="ヘルプメニュー"
      className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6"
      style={{
        // iOS Home indicator (34px) + 余白 16px ≧ 50px を保証
        bottom: "calc(env(safe-area-inset-bottom) + 1rem)",
        right: "calc(env(safe-area-inset-right) + 1rem)",
      }}
    >
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          aria-label="ヘルプ"
          className="absolute bottom-14 right-0 w-64 rounded-lg border border-border bg-card p-1.5 shadow-lg sm:bottom-16"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="ds-kpi-label">ヘルプ</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                fabRef.current?.focus();
              }}
              aria-label="メニューを閉じる"
              className="-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <ul className="py-1">
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  startPage?.();
                }}
                disabled={!pageTourAvailable || !startPage}
                className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {pageTourLabel ? `${pageTourLabel}の使い方を見る` : "このページの使い方を見る"}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    今いるページの主要機能を順に案内
                  </span>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  startDashboard?.();
                }}
                disabled={!dashAvailable || !startDashboard}
                className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Home className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">ダッシュボードのガイド</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    全体像を俯瞰する初回ガイド
                  </span>
                </span>
              </button>
            </li>
            <li>
              <Link
                href="/help"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">よくある質問</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    主要な操作と仕組みを確認
                  </span>
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/contact"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">お問い合わせ</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    24時間以内に運営から返信
                  </span>
                </span>
              </Link>
            </li>
          </ul>
        </div>
      )}
      <button
        ref={fabRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="ヘルプメニューを開く"
        className="inline-flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-[transform,brightness] duration-75 hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <HelpCircle className="h-5 w-5" aria-hidden="true" />
      </button>
    </aside>
  );
}

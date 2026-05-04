"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";

// 「あとで」を選んでも 7日経過で再表示 (永久非表示にしない)
const STORAGE_KEY = "interconnect_tldv_cta_dismissed_at";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export function TldvConnectCta() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const at = localStorage.getItem(STORAGE_KEY);
    if (!at) {
      setDismissed(false);
      return;
    }
    const elapsed = Date.now() - Number(at);
    setDismissed(Number.isFinite(elapsed) && elapsed < SNOOZE_MS);
  }, []);

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setDismissed(true);
  }

  return (
    <div className="rounded-lg border border-accent/25 bg-gradient-brand-soft">
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:gap-5">
        <Video
          className="h-5 w-5 shrink-0 text-accent-strong"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            ミーティング分析を接続しませんか？
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            tl;dv の記録を接続すると、あなたの関心や専門領域を理解し、本当に会うべき人をご紹介できます。
            <span className="ml-1 text-muted-foreground/70">所要時間：約2分</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-col-reverse sm:items-stretch sm:gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDismiss}
            aria-label="ミーティング分析CTAを7日間非表示にする"
          >
            あとで
          </Button>
          <Button size="sm" variant="accent" render={<Link href="/settings#tldv-connect" />}>
            接続する
          </Button>
        </div>
      </div>
    </div>
  );
}

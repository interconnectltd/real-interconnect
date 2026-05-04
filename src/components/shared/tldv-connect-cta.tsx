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
    <div className="rounded-lg border border-accent/25 bg-gradient-brand-soft px-6 py-7 text-center">
      <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-card text-accent shadow-sm">
        <Video className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-foreground">
        ミーティング分析を接続しませんか？
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
        tl;dvのミーティング記録を接続すると、あなたの関心や専門領域を理解し、
        本当に会うべき人をご紹介できます。
      </p>
      <p className="mt-1.5 text-[11px] text-muted-foreground/70">所要時間：約2分</p>
      <div className="mt-4 flex justify-center gap-2">
        <Button size="sm" variant="accent" render={<Link href="/settings#tldv-connect" />}>
          接続する
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          aria-label="ミーティング分析CTAを7日間非表示にする"
        >
          あとで
        </Button>
      </div>
    </div>
  );
}

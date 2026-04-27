"use client";

import { useState, useEffect } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "interconnect_tldv_cta_dismissed";

export function TldvConnectCta() {
  const [dismissed, setDismissed] = useState(true); // default hidden to avoid flash

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <Video className="mx-auto h-8 w-8 text-primary/60" />
      <h3 className="mt-3 text-sm font-semibold">
        ミーティング分析を接続しませんか？
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
        tl;dvのミーティング記録を接続すると、あなたの関心や専門領域を理解し、
        本当に会うべき人をご紹介できます。
      </p>
      <p className="mt-1 text-xs text-muted-foreground/60">所要時間：約2分</p>
      <div className="mt-4 flex justify-center gap-3">
        <Button size="sm" render={<a href="/settings#tldv-connect" />}>
          接続する
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDismiss}>
          あとで
        </Button>
      </div>
    </div>
  );
}

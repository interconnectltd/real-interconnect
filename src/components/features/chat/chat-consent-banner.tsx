"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

const STORAGE_KEY = "chat_analysis_consent";

export function ChatConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // localStorage から hydrate (mount 時 1 回のみ)
    const consented = localStorage.getItem(STORAGE_KEY);
    if (!consented) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
    }
  }, []);

  function handleAccept() {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-blue-50 dark:bg-blue-950 px-4 py-2.5 text-sm text-blue-800 dark:text-blue-200">
      <p className="flex-1">
        チャットの内容はサービス改善とマッチング精度向上のためにAIが分析します。
        <Link href="/privacy" className="ml-1 underline hover:text-blue-600 dark:hover:text-blue-400">
          詳しく見る
        </Link>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="border-blue-200 dark:border-blue-800 bg-white dark:bg-blue-900 text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-800"
          onClick={handleAccept}
        >
          了承する
        </Button>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-blue-400 dark:text-blue-500 hover:text-blue-600 dark:hover:text-blue-300 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          onClick={handleAccept}
          aria-label="閉じる"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

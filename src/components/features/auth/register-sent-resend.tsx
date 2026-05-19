"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const COOLDOWN_SEC = 60;

/**
 * 確認メール再送ボタン (Cooldown 付き)。
 *
 * - サーバー側 /api/v1/auth/resend-confirmation で IP/email 双方の rate-limit を実施。
 *   ここではクライアント側の濫用抑止 (60s cooldown 表示) のみ。
 * - 200 success と 400/429 でのみ UX 分岐 (anti-enumeration: 存在判定は返さない)。
 */
export function RegisterSentResend({ email }: { email: string }) {
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCooldown() {
    setRemaining(COOLDOWN_SEC);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        toast.error(
          "再送回数が多すぎます。しばらくしてから再度お試しください。",
        );
        // 429 でも cooldown は開始 (連打防止)
        startCooldown();
        return;
      }
      if (!res.ok) {
        // anti-enumeration の都合上 400/500 もユーザーへは generic に。
        toast.error("再送に失敗しました。少し待ってから再度お試しください。");
        return;
      }
      toast.success("確認メールを再送しました。受信トレイをご確認ください。");
      startCooldown();
    } catch {
      toast.error("通信エラーが発生しました。ネットワークをご確認ください。");
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || remaining > 0;
  const label = loading
    ? "再送中..."
    : remaining > 0
      ? `再送する (${remaining}秒待機)`
      : "確認メールを再送する";

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full"
      onClick={handleClick}
      disabled={disabled}
      aria-busy={loading}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}

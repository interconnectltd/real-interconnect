"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/site-url";
import { safeInternalPath } from "@/lib/safe-redirect";
import { isInAppBrowser } from "@/lib/client-env";
import { toast } from "sonner";

/**
 * OAuth ボタンの loading 解除ガード (audit Wave6 D / H-1):
 *   - pageshow `e.persisted` だけでは bfcache 無効ページ (no-store) で発火しない
 *   - visibilitychange (タブ復帰) + 8 秒 safetyTimer で「永遠に loading」事故を遮断
 *   - signInWithOAuth は通常 1-2 秒で window.location 遷移するため 8 秒待っても
 *     遷移しない場合は失敗扱い → loading=false で再タップ可能化
 */
function useResetOnReturn(setLoading: (v: boolean) => void) {
  useEffect(() => {
    const reset = () => setLoading(false);
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) reset();
    };
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        reset();
      }
    };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [setLoading]);
}

/** OAuth callback URL に redirect query を `next=` として転送 (Wave6 D / H-2) */
function buildOAuthCallbackUrl(redirect: string | null): string {
  const base = `${getSiteUrl()}/auth/callback`;
  if (!redirect) return base;
  // safeInternalPath で外部 URL / バックスラッシュ等を遮断してから forward
  const safe = safeInternalPath(redirect, "");
  if (!safe) return base;
  return `${base}?next=${encodeURIComponent(safe)}`;
}

export function LinkedInLoginButton({ label }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchParams = useSearchParams();

  useResetOnReturn(setLoading);

  // unmount で safety timer を必ず破棄
  useEffect(() => () => {
    if (safetyRef.current) clearTimeout(safetyRef.current);
  }, []);

  async function handleClick() {
    // In-app ブラウザ (LINE/FB/Instagram/X 等) では OAuth が intent 経由で
    // 外部アプリに飛べず失敗するため、事前ガードして外部ブラウザに誘導する。
    if (isInAppBrowser()) {
      toast.error(
        "アプリ内ブラウザではログインできません。SafariまたはChromeで開いてください。",
      );
      return;
    }
    setLoading(true);
    // 8 秒経っても遷移しない場合は強制解除 (loading 張り付き防御)
    safetyRef.current = setTimeout(() => setLoading(false), 8000);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "linkedin_oidc",
      options: {
        redirectTo: buildOAuthCallbackUrl(searchParams.get("redirect")),
        // PKCE 明示: implicit fallback を一切許さない (audit Wave1 #4)
        flowType: "pkce",
      } as Parameters<
        ReturnType<typeof createClient>["auth"]["signInWithOAuth"]
      >[0]["options"],
    });

    if (error) {
      if (safetyRef.current) clearTimeout(safetyRef.current);
      toast.error("ログインに失敗しました。もう一度お試しください。");
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      size="lg"
      variant="outline"
      className="w-full justify-center gap-2.5 font-medium"
      onClick={handleClick}
      disabled={loading}
      aria-busy={loading}
    >
      <svg className="h-4 w-4 text-[#0A66C2]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
      {loading ? "接続中..." : (label ?? "LinkedInで続ける")}
    </Button>
  );
}

export function FacebookLoginButton({ label }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchParams = useSearchParams();

  useResetOnReturn(setLoading);

  useEffect(() => () => {
    if (safetyRef.current) clearTimeout(safetyRef.current);
  }, []);

  async function handleClick() {
    setLoading(true);
    safetyRef.current = setTimeout(() => setLoading(false), 8000);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: {
        redirectTo: buildOAuthCallbackUrl(searchParams.get("redirect")),
        flowType: "pkce",
      } as Parameters<
        ReturnType<typeof createClient>["auth"]["signInWithOAuth"]
      >[0]["options"],
    });

    if (error) {
      if (safetyRef.current) clearTimeout(safetyRef.current);
      toast.error("ログインに失敗しました。もう一度お試しください。");
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      size="lg"
      variant="outline"
      className="w-full justify-center gap-2.5 font-medium"
      onClick={handleClick}
      disabled={loading}
      aria-busy={loading}
    >
      <svg className="h-4 w-4 text-[#1877F2]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
      {loading ? "接続中..." : (label ?? "Facebookで続ける")}
    </Button>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/site-url";

export function LinkedInLoginButton() {
  const [loading, setLoading] = useState(false);

  // ページに戻ってきた時にローディング状態をリセット（Safari bfcache対応）
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(false);
    };
    window.addEventListener('pageshow', handlePageShow);
    setLoading(false);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  async function handleClick() {
    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "linkedin_oidc",
      options: {
        redirectTo: `${getSiteUrl()}/auth/callback`,
      },
    });

    if (error) setLoading(false);
  }

  return (
    <Button
      type="button"
      className="w-full bg-[#0A66C2] text-white hover:bg-[#004182]"
      onClick={handleClick}
      disabled={loading}
    >
      <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="white">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
      {loading ? "接続中..." : "LinkedInでログイン"}
    </Button>
  );
}

export function FacebookLoginButton() {
  const [loading, setLoading] = useState(false);

  // ページに戻ってきた時にローディング状態をリセット（Safari bfcache対応）
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(false);
    };
    window.addEventListener('pageshow', handlePageShow);
    setLoading(false);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  async function handleClick() {
    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: {
        redirectTo: `${getSiteUrl()}/auth/callback`,
      },
    });

    if (error) setLoading(false);
  }

  return (
    <Button
      type="button"
      className="w-full bg-[#1877F2] text-white hover:bg-[#0C5DC7]"
      onClick={handleClick}
      disabled={loading}
    >
      <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="white">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
      {loading ? "接続中..." : "Facebookでログイン"}
    </Button>
  );
}

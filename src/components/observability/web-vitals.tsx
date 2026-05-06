"use client";

/**
 * Web Vitals 計測コンポーネント。
 * - useReportWebVitals (Next.js built-in) で LCP / INP / CLS / FCP / TTFB を取得
 * - Sentry 等を導入していないので、まず console.info に出して PageSpeed Insights 風の
 *   Server-Timing で観測。本番では `/api/v1/web-vitals` (将来) に sendBeacon で送る。
 * - 本コンポーネントを RootLayout に挿入するだけで動作。Bundle 影響は最小 (~1KB)。
 */

import { useReportWebVitals } from "next/web-vitals";

interface Metric {
  id: string;
  name: string;
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  navigationType?: string;
}

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const m = metric as unknown as Metric;
    // 開発環境では console、本番では navigator.sendBeacon で集約 endpoint へ
    if (process.env.NODE_ENV !== "production") {
      // dev は info で見える化
      // eslint-disable-next-line no-console
      console.info(
        `[web-vitals] ${m.name}=${Math.round(m.value)} (${m.rating ?? "n/a"})`,
      );
      return;
    }
    // 本番: 将来 /api/v1/web-vitals に sendBeacon、現状は noop
    // (audit_logs.action 拡張 + RLS policy 追加が必要なため Tier3 で実装)
  });
  return null;
}

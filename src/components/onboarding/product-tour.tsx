"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ArrowLeft, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ProductTour — 初回ログイン時のステップバイステップ案内。
 *
 * 設計判断:
 *   - 各ステップで `data-tour="<key>"` 属性の付いた DOM を spotlight。
 *   - overlay は 4枚の dim div で対象を矩形くり抜く (svg mask 不要、軽量)。
 *   - tooltip は対象の上下左右で空きが大きい方向に自動配置 (resize/scroll 追従)。
 *   - localStorage で 状態を永続: "v1:tour:dashboard:done" を持つ。
 *   - 「いまは閉じる」「やめる」で dismiss。dismiss は HelpDock から再開可。
 *   - prefers-reduced-motion で transition を無効化。
 *   - 対象が見つからないステップは skip (開発中の安全策)。
 */

export interface TourStep {
  /** data-tour="key" と一致 */
  target: string;
  /** ステップタイトル */
  title: string;
  /** 何ができるか (1-2文) */
  description: string;
  /** なぜこれが大事か (経営層への補足、任意) */
  rationale?: string;
  /** ヒント (具体アクション、任意) */
  next?: string;
  /** target が見つからない場合に skip するか (true: skip, false: 中央表示) */
  skipIfMissing?: boolean;
}

interface ProductTourProps {
  steps: TourStep[];
  /** localStorage キー (tour 種別ごとに変える) */
  storageKey: string;
  /** open=true でtour開始 */
  open: boolean;
  onClose: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // spotlight のターゲット周囲padding
const TOOLTIP_GAP = 12; // ターゲットと tooltip の隙間

export function ProductTour({ steps, storageKey, open, onClose }: ProductTourProps) {
  const [current, setCurrent] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; placement: "top" | "bottom" | "left" | "right" | "center" }>({
    top: 0,
    left: 0,
    placement: "bottom",
  });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const measureRafRef = useRef<number | null>(null);
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const step = steps[current];
  const isLast = current === steps.length - 1;
  const isFirst = current === 0;

  // skipIfMissing: 対象 DOM が無い & skipIfMissing=true なら自動で次へ。
  // mount 競合 / API 遅延で対象が後着するケースに備え、50ms と 200ms の
  // 二段 retry で確認 (合計 250ms 待っても出ないなら確実に存在しないとみなす)。
  useEffect(() => {
    if (!open || !step?.skipIfMissing) return;
    const lookup = () => document.querySelector(`[data-tour="${step.target}"]`);
    const t1 = setTimeout(() => {
      if (lookup()) return;
      const t2 = setTimeout(() => {
        if (lookup()) return;
        if (isLast) {
          handleComplete();
        } else {
          setCurrent((c) => Math.min(steps.length - 1, c + 1));
        }
      }, 200);
      retryTimerRef.current = t2;
    }, 50);
    initTimerRef.current = t1;
    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      initTimerRef.current = null;
      retryTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current, step?.target, step?.skipIfMissing, isLast]);

  // 対象 DOM の rect を計測
  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    // viewport にスクロールイン
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();

    // RAF debounce: 連続イベント時も次フレームで1回だけ measure
    const scheduleMeasure = () => {
      if (measureRafRef.current !== null) return;
      measureRafRef.current = requestAnimationFrame(() => {
        measureRafRef.current = null;
        measure();
      });
    };

    const onResize = () => scheduleMeasure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    // DOM 変更で対象が後から現れる場合に対応するが、対象が見つかれば
    // body 全体監視は止めて parent ancestor のみ監視に縮小 (重い reflow 抑制)
    const target = document.querySelector(`[data-tour="${step?.target}"]`);
    const obsTarget = target?.parentElement ?? document.body;
    const obs = new MutationObserver(() => scheduleMeasure());
    obs.observe(obsTarget, {
      subtree: target ? false : true,
      childList: true,
      attributes: false,
      characterData: false,
    });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      obs.disconnect();
      if (measureRafRef.current !== null) {
        cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
    };
  }, [open, current, measure, step?.target]);

  // tooltip 位置を計算 (上下左右で空きが多い方を選ぶ)
  useLayoutEffect(() => {
    if (!rect) {
      // 対象なし → 画面中央に表示
      const tw = tooltipRef.current?.offsetWidth ?? 360;
      const th = tooltipRef.current?.offsetHeight ?? 200;
      setTooltipPos({
        top: Math.max(16, window.innerHeight / 2 - th / 2),
        left: Math.max(16, window.innerWidth / 2 - tw / 2),
        placement: "center",
      });
      return;
    }
    const tw = tooltipRef.current?.offsetWidth ?? 360;
    const th = tooltipRef.current?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 各方向の空き
    const spaceBottom = vh - (rect.top + rect.height);
    const spaceTop = rect.top;

    let placement: "top" | "bottom" | "left" | "right" = "bottom";
    let top = 0;
    let left = 0;

    if (spaceBottom >= th + TOOLTIP_GAP + 16) {
      placement = "bottom";
      top = rect.top + rect.height + TOOLTIP_GAP;
      left = Math.max(16, Math.min(vw - tw - 16, rect.left + rect.width / 2 - tw / 2));
    } else if (spaceTop >= th + TOOLTIP_GAP + 16) {
      placement = "top";
      top = rect.top - th - TOOLTIP_GAP;
      left = Math.max(16, Math.min(vw - tw - 16, rect.left + rect.width / 2 - tw / 2));
    } else {
      // 縦に入らない → 横方向 or center fallback
      const spaceRight = vw - (rect.left + rect.width);
      if (spaceRight >= tw + TOOLTIP_GAP + 16) {
        placement = "right";
        left = rect.left + rect.width + TOOLTIP_GAP;
        top = Math.max(16, Math.min(vh - th - 16, rect.top + rect.height / 2 - th / 2));
      } else if (rect.left >= tw + TOOLTIP_GAP + 16) {
        placement = "left";
        left = rect.left - tw - TOOLTIP_GAP;
        top = Math.max(16, Math.min(vh - th - 16, rect.top + rect.height / 2 - th / 2));
      } else {
        placement = "bottom";
        top = Math.max(16, vh - th - 16);
        left = Math.max(16, vw / 2 - tw / 2);
      }
    }

    setTooltipPos({ top, left, placement });
  }, [rect, current]);

  // ESC / 矢印キー / Focus trap (Tab で tooltip 内を循環)
  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleDismiss();
        return;
      }
      if (e.key === "ArrowRight" && !isLast) {
        e.preventDefault();
        setCurrent((c) => Math.min(steps.length - 1, c + 1));
        return;
      }
      if (e.key === "ArrowLeft" && !isFirst) {
        e.preventDefault();
        setCurrent((c) => Math.max(0, c - 1));
        return;
      }
      // Focus trap: Tab/Shift+Tab で tooltip 内に閉じる
      if (e.key === "Tab" && tooltipRef.current) {
        const focusables = tooltipRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current, isLast, isFirst]);

  // tour 中は body スクロール固定 (iOS Safari の touch scroll も止める)
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  function handleDismiss() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ status: "dismissed", at: Date.now() }));
    } catch {}
    onClose();
  }

  function handleComplete() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ status: "done", at: Date.now() }));
    } catch {}
    onClose();
  }

  function next() {
    if (isLast) handleComplete();
    else setCurrent((c) => c + 1);
  }

  function prev() {
    setCurrent((c) => Math.max(0, c - 1));
  }

  if (!open || typeof document === "undefined" || !step) return null;

  const dimColor = "color-mix(in oklab, var(--brand-navy) 60%, transparent)";

  // spotlight 4辺の overlay (rect ありの時のみ)
  const overlays = rect
    ? [
        // top
        { top: 0, left: 0, width: "min(100vw, 100dvw)", height: Math.max(0, rect.top - PAD) },
        // bottom
        { top: rect.top + rect.height + PAD, left: 0, width: "min(100vw, 100dvw)", height: `calc(min(100vh, 100dvh) - ${rect.top + rect.height + PAD}px)` },
        // left
        { top: Math.max(0, rect.top - PAD), left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 },
        // right
        { top: Math.max(0, rect.top - PAD), left: rect.left + rect.width + PAD, width: `calc(min(100vw, 100dvw) - ${rect.left + rect.width + PAD}px)`, height: rect.height + PAD * 2 },
      ]
    : [];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-description tour-rationale tour-next"
      className="fixed inset-0 z-[100] motion-safe:transition-opacity"
    >
      {rect ? (
        <>
          {overlays.map((o, i) => (
            <div
              key={i}
              aria-hidden="true"
              style={{
                position: "fixed",
                background: dimColor,
                pointerEvents: "auto",
                ...o,
              }}
              onClick={handleDismiss}
            />
          ))}
          {/* spotlight 枠 (アクセント線で対象を明示) */}
          <div
            aria-hidden="true"
            style={{
              position: "fixed",
              top: rect.top - PAD,
              left: rect.left - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
              borderRadius: 12,
              boxShadow: `0 0 0 2px var(--accent-strong), 0 0 0 6px color-mix(in oklab, var(--accent) 25%, transparent)`,
              pointerEvents: "none",
              transition: "all 0.18s ease",
            }}
          />
        </>
      ) : (
        // 対象なし → 全面 dim
        <div
          aria-hidden="true"
          className="fixed inset-0"
          style={{ background: dimColor }}
          onClick={handleDismiss}
        />
      )}

      <div
        ref={tooltipRef}
        className="fixed w-[min(92vw,360px)] rounded-lg border border-border bg-card p-5 shadow-lg motion-safe:transition-[top,left] motion-safe:duration-200"
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="ds-kpi-label" role="status" aria-live="polite" aria-atomic="true">
            ステップ {current + 1} / {steps.length}
          </span>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={handleDismiss}
            aria-label="案内を閉じる"
            className="-mr-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2 id="tour-title" className="mt-2 text-base font-semibold text-foreground">
          {step.title}
        </h2>
        <p id="tour-description" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {step.description}
        </p>

        {step.rationale && (
          <p
            id="tour-rationale"
            className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          >
            <span className="font-semibold text-foreground">なぜ重要？</span>
            <br />
            {step.rationale}
          </p>
        )}

        {step.next && (
          <p
            id="tour-next"
            className="mt-2 text-xs leading-relaxed text-accent-strong"
          >
            <span className="font-semibold">次のアクション:</span> {step.next}
          </p>
        )}

        {/* progress dots */}
        <div className="mt-4 flex items-center justify-center gap-1.5" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === current
                  ? "w-5 bg-accent"
                  : i < current
                  ? "w-1.5 bg-accent/60"
                  : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={isFirst ? handleDismiss : prev}
          >
            {isFirst ? (
              "後で"
            ) : (
              <>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                戻る
              </>
            )}
          </Button>
          <Button type="button" size="sm" variant="accent" onClick={next}>
            {isLast ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                完了
              </>
            ) : (
              <>
                次へ
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ───────── Tour 制御 hook ───────── */

interface TourState {
  status: "open" | "done" | "dismissed" | "idle";
}

export function useProductTour(storageKey: string) {
  const [state, setState] = useState<TourState>({ status: "idle" });

  // 初回マウント時に localStorage を読む (SSR-safe)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        // 未操作 → 自動オープン
        setState({ status: "open" });
        return;
      }
      const parsed = JSON.parse(raw) as { status?: string };
      if (parsed.status === "done" || parsed.status === "dismissed") {
        setState({ status: "idle" });
      } else {
        setState({ status: "open" });
      }
    } catch {
      setState({ status: "open" });
    }
  }, [storageKey]);

  const open = state.status === "open";

  const close = useCallback(() => setState({ status: "idle" }), []);
  const start = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    setState({ status: "open" });
  }, [storageKey]);

  return useMemo(() => ({ open, close, start }), [open, close, start]);
}

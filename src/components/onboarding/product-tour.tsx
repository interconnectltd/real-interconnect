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
  /**
   * 配置希望。指定無しは "auto" (空きが大きい方向に自動)。
   * 縦長 target (page bottom の section 等) は "top" 固定で確実に画面内に出す。
   */
  placement?: "auto" | "top" | "bottom" | "left" | "right";
  /**
   * scrollIntoView の block 値 (default "start")。
   * 縦長 target は "start" にして対象上端を画面上に持ち上げ、tooltip を下に出せる空きを確保。
   */
  scrollBlock?: "start" | "center" | "end" | "nearest";
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
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom" | "left" | "right" | "center";
  }>({ top: 0, left: 0, placement: "bottom" });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const measureRafRef = useRef<number | null>(null);
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // iOS home-indicator など safe-area-inset-bottom 分の余白を JS でも知る必要がある
  // (maxHeight / clampY / center fallback 全てで使う)。env() 値を probe div で測る。
  const [safeBottom, setSafeBottom] = useState(0);
  // visualViewport の resize / scroll で URL bar が出入りすると vh が変わるが、
  // この再描画 trigger が無いと tooltipPos の useLayoutEffect が再実行されず
  // tooltip が画面外に取り残される。version state で再 measure させる。
  const [vvVersion, setVvVersion] = useState(0);

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

  // 対象 DOM の rect を計測 (scroll 追従用、毎フレームでも安全)。
  // 注: ここでは scrollIntoView を行わない。 自動スクロールはユーザーの
  // スクロール操作 (内容を見るための) と衝突するため、 step 切替時に限定
  // (別 useEffect で 1 回だけ実行する)。
  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  // step 切替時に対象を一度だけ画面内へスクロール (measure() からは分離)。
  // これでツアー中ユーザーが context 確認のため自由にスクロールできる。
  useEffect(() => {
    if (!open || !step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) return;
    const viewportH = window.visualViewport?.height ?? window.innerHeight;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > viewportH) {
      el.scrollIntoView({
        behavior: "smooth",
        block: step.scrollBlock ?? "start",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current, step?.target]);

  // safe-area-inset-bottom を probe div で実測 (env() は CSS のみで取れるため)
  useEffect(() => {
    if (!open) return;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    setSafeBottom(h);
  }, [open]);

  // visualViewport 変化 (iOS URL bar 出入り / keyboard 表示) で再 measure を強制
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const tick = () => setVvVersion((v) => v + 1);
    vv.addEventListener("resize", tick);
    vv.addEventListener("scroll", tick);
    return () => {
      vv.removeEventListener("resize", tick);
      vv.removeEventListener("scroll", tick);
    };
  }, [open]);

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
  }, [open, current, measure, step?.target, vvVersion]);

  // tooltip 位置を計算
  // - per-step `placement` 指定があれば優先 (auto 時のみ自動配置)
  // - 縦/横どちらにも入らない場合の fallback も「対象上端より上に貼り付け」に変更
  //   (旧版は画面最下部固定で keyboard / safe-area と衝突していた)
  // - visualViewport 参照で iOS Safari URL bar / keyboard 出現時の実残量を使う
  useLayoutEffect(() => {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;

    if (!rect) {
      const tw = tooltipRef.current?.offsetWidth ?? 360;
      const th = tooltipRef.current?.offsetHeight ?? 200;
      setTooltipPos({
        top: Math.max(16, vh / 2 - th / 2),
        left: Math.max(16, vw / 2 - tw / 2),
        placement: "center",
      });
      return;
    }
    const tw = tooltipRef.current?.offsetWidth ?? 360;
    const th = tooltipRef.current?.offsetHeight ?? 200;

    // 下端は safe-area-inset-bottom (iPhone home indicator 等) を避ける
    const spaceBottom = vh - (rect.top + rect.height) - safeBottom;
    const spaceTop = rect.top;
    const spaceRight = vw - (rect.left + rect.width);
    const spaceLeft = rect.left;
    const need = th + TOOLTIP_GAP + 16;
    const needX = tw + TOOLTIP_GAP + 16;

    // 中央寄せ left の clamp
    const clampX = (x: number) =>
      Math.max(16, Math.min(vw - tw - 16, x));
    // 下限に safeBottom を反映 (home indicator 上に重ねない)
    const clampY = (y: number) =>
      Math.max(16, Math.min(vh - th - 16 - safeBottom, y));

    const wanted = step?.placement ?? "auto";
    const fits = {
      top: spaceTop >= need,
      bottom: spaceBottom >= need,
      left: spaceLeft >= needX,
      right: spaceRight >= needX,
    };

    let placement: "top" | "bottom" | "left" | "right" | "center" = "bottom";

    // 1. per-step placement (フィットしない時は反対側 → 横にフォールバック)
    const order: Array<"top" | "bottom" | "left" | "right"> =
      wanted === "top" ? ["top", "bottom", "right", "left"]
      : wanted === "bottom" ? ["bottom", "top", "right", "left"]
      : wanted === "left" ? ["left", "right", "top", "bottom"]
      : wanted === "right" ? ["right", "left", "top", "bottom"]
      // auto: 縦優先 (空きが大きい方)
      : spaceBottom >= spaceTop
        ? ["bottom", "top", "right", "left"]
        : ["top", "bottom", "right", "left"];

    placement = order.find((p) => fits[p]) ?? order[0]!;

    let top = 0;
    let left = 0;
    if (placement === "bottom") {
      top = rect.top + rect.height + TOOLTIP_GAP;
      left = clampX(rect.left + rect.width / 2 - tw / 2);
    } else if (placement === "top") {
      top = rect.top - th - TOOLTIP_GAP;
      left = clampX(rect.left + rect.width / 2 - tw / 2);
    } else if (placement === "right") {
      left = rect.left + rect.width + TOOLTIP_GAP;
      top = clampY(rect.top + rect.height / 2 - th / 2);
    } else {
      left = rect.left - tw - TOOLTIP_GAP;
      top = clampY(rect.top + rect.height / 2 - th / 2);
    }

    // 縦/横どこにも fits しない場合: tooltip を画面中央に出して spotlight で
    // 対象を強調する fallback (旧版は y=16 固定で対象自体を覆っていた)。
    // placement は "center" にして tooltip 側の方向矢印 / border-radius を中立化可能に。
    if (!fits.top && !fits.bottom && !fits.left && !fits.right) {
      placement = "center";
      // 可視領域 (vh) と safe-area を考慮した中心
      top = Math.max(16, (vh - safeBottom) / 2 - th / 2);
      left = Math.max(16, vw / 2 - tw / 2);
    }

    setTooltipPos({ top, left, placement });
  }, [rect, current, step?.placement, safeBottom, vvVersion]);

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

  // 旧 tour 中の body スクロール完全固定 (position:fixed + top:-scrollY) は
  // 撤去。 横スクロール防止用の `body.style.overflowX = "hidden"` 上書きも
  // 撤去 (iOS Safari で body を scroll container 化してしまい vertical touch
  // も止まるバグの原因)。globals.css の `body { overflow-x: clip }` が
  // scroll container を作らずに横はみ出し防止してくれている。
  //
  // 一方 dim overlay 4 枚 + 外側 dialog wrapper には `touch-action: pan-y` を
  // 設定し、 finger pan を underlying body の scroll に転送する。これで iOS
  // Safari でもツアー中に scroll で context 確認できる。

  // visualViewport 高を CSS var (--tour-vh) で公開 (iOS keyboard 連動の max-height 用)
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) {
      document.documentElement.style.setProperty("--tour-vh", `${window.innerHeight}px`);
      return;
    }
    const apply = () => {
      document.documentElement.style.setProperty("--tour-vh", `${vv.height}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--tour-vh");
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
  // dvw / dvh は dynamic viewport (desktop scrollbar 17px 抜き / iOS URL bar 連動)。
  // 100vw を使うと右端に 17px はみ出して横揺れするため使わない。
  const overlays = rect
    ? [
        // top
        { top: 0, left: 0, width: "100dvw", height: Math.max(0, rect.top - PAD) },
        // bottom
        { top: rect.top + rect.height + PAD, left: 0, width: "100dvw", height: `calc(var(--tour-vh, 100dvh) - ${rect.top + rect.height + PAD}px)` },
        // left
        { top: Math.max(0, rect.top - PAD), left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 },
        // right
        { top: Math.max(0, rect.top - PAD), left: rect.left + rect.width + PAD, width: `calc(100dvw - ${rect.left + rect.width + PAD}px)`, height: rect.height + PAD * 2 },
      ]
    : [];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-description tour-rationale tour-next"
      className="fixed inset-0 z-[100] motion-safe:transition-opacity"
      // iOS Safari の touch を underlying body の vertical scroll に通す。
      // pan-y は vertical pan を browser に解放するため body が scroll し、
      // 一方 tap (movement 無) は click として onClick (handleDismiss) に届く。
      style={{ touchAction: "pan-y" }}
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
                // 縦 pan を body の scroll に転送 (iOS Safari)
                touchAction: "pan-y",
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
          style={{ background: dimColor, touchAction: "pan-y" }}
          onClick={handleDismiss}
        />
      )}

      <div
        ref={tooltipRef}
        className="fixed flex w-[min(92vw,360px)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg motion-safe:transition-[top,left] motion-safe:duration-200"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          // visualViewport 高 - 32px (上下 16px 余白) - safe-area (iOS home indicator 等) を
          // 上限に。本文長文時は内部 scroll に流す。
          maxHeight:
            "calc(var(--tour-vh, 100dvh) - 32px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* ヘッダ (固定) */}
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 pt-4 pb-3">
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

        {/* 本文 (内部 scroll、長文 step でも見切れない) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <h2 id="tour-title" className="text-base font-semibold text-foreground">
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
        </div>

        {/* フッタ (固定): 「次へ」ボタンが iPhone home indicator gesture zone に
            落ちないよう safe-area-inset-bottom 分の追加 padding を確保 */}
        <div
          className="border-t border-border/60 px-5 py-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}
        >
          <div className="mb-3 flex items-center justify-center gap-1.5" aria-hidden="true">
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
          <div className="flex items-center justify-between gap-2">
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

  // 初回マウント時に localStorage から hydrate (SSR-safe / mount 時 1 回のみ)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
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

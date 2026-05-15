"use client";

import { useEffect, useState } from "react";
import { ProductTour, useProductTour, type TourStep } from "./product-tour";

// Step 順序は Lv1 ユーザーの物理動線 (画面 top→down) に合わせる:
//   Lv1 で表示される TldvConnectCta が最上段 → 次に KPI 罫線 → 成熟度/完成度 → おすすめ
//   tldv-cta は Lv1 のみ存在 (skipIfMissing) で Lv2+ は自動的に2番目から開始される。
const STEPS_ALL: TourStep[] = [
  {
    target: "tldv-cta",
    title: "まずは tl;dv を接続しましょう",
    description:
      "Zoom/Google Meet の議事録ツール「tl;dv」と連携すると、ミーティング会話から AI が興味領域を抽出します。",
    rationale:
      "プロフィール文だけでは捉えきれない「本当の関心」を AI が学習することで、おすすめ精度が Lv1 から Lv3 へ進化し、推薦の的中率が約3倍になります。",
    next: "右側の「接続する」をクリック。所要時間 約2分です。",
    skipIfMissing: true,
    // tldv-cta は横長 banner。 PC では tooltip を左端に逃がして
    // 右側の「接続する」ボタンが見える状態にする。 SP は底辺自動 fallback。
    forceEdge: "left",
  },
  {
    target: "kpi-overview",
    title: "ネットワーク状況が一目で分かります",
    description:
      "コネクション・通知・おすすめ・メンバー総数の4指標です。各数字をクリックすると詳細に飛びます。",
    rationale:
      "経営層の意思決定は数字から始まります。今週の商談機会と進捗を瞬時に把握できる設計です。",
    next: "数字 0 のときは下の「次のアクション」コメントが出ます。",
    // kpi-overview は 4 列横並びで横長 / 縦に短い。 PC では右カラム全幅なので
    // tooltip を左端に逃がして 4 KPI 数字が見える状態に。 SP は底辺自動 fallback。
    forceEdge: "left",
  },
  {
    target: "maturity-card",
    title: "おすすめ精度の現在地",
    description:
      "tl;dv 連携で会話が分析されるごとに、Lv1 → Lv3 へと精度が上がります。",
    rationale:
      "Lv3 になると「この相手はあなたの今の課題に直接答えられる」という根拠付き推薦が表示されるようになります。",
    next: "Lv2 になるには 1回、Lv3 までは 5回のミーティング分析が必要です。",
    // maturity-card は md+ で左カラム / SP では全幅。 PC では右端 pin で
    // card 全体を見せながら tooltip だけ右に逃がす。 SP は底辺自動 fallback。
    forceEdge: "right",
    scrollBlock: "center",
  },
  {
    target: "completeness-card",
    title: "プロフィールを充実させましょう",
    description:
      "未入力を埋めると完成度が上がり、相手の検索結果やおすすめに上位表示されます。",
    rationale:
      "限られた時間で「会う価値があるか」を判断する経営層にとって、空白だらけのプロフィールは信頼形成の機会を失います。",
    next: "右側の「+%」が大きい項目 (自己紹介 +20% など) から埋めましょう。",
    // completeness-card は md+ で右カラム → 対称的に左端 pin。 SP は底辺自動 fallback。
    forceEdge: "left",
    scrollBlock: "center",
  },
  {
    target: "recommendation-section",
    title: "おすすめの方を確認しましょう",
    description:
      "プロフィールと会話分析をもとに、つながる価値のある経営者をご紹介します。各カードに「なぜ勧めるか」の理由が明示されています。",
    rationale:
      "理由付き推薦により、商談前から「何を話すべきか」が明確になり、初回ミーティングの成果が出やすくなります。",
    next: "気になる方の「つながる」ボタンで申請。相手が承諾するとコネクション成立です。",
    skipIfMissing: true,
    // section 全体 (見出し+3カード) を spotlight しつつ tooltip だけ右端に
    // 逃がす設計。 PC: 右端 pin (cards 左部が見える) / SP: 底辺 pin に自動
    // fallback (cards 上部が tooltip より上に visible)。
    forceEdge: "right",
    scrollBlock: "start",
  },
];

const STORAGE_KEY = "interconnect:tour:dashboard:v1";

// Window event 経由で HelpDock からの "再開" シグナルを受信する
const TOUR_RESTART_EVENT = "interconnect:tour:dashboard:restart";

/**
 * HelpDock 側から呼び出すためのヘルパー (window event を発火)。
 */
export function restartDashboardTour() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TOUR_RESTART_EVENT));
}

/**
 * Dashboard 専用の tour。Dashboard ページに1つだけ置く。
 * 全画面共通の HelpDock は (auth)/layout.tsx で mount され、
 * tour 再開要求は window event で送信する。
 */
export function DashboardTour({ isLv1 = true }: { isLv1?: boolean }) {
  const tour = useProductTour(STORAGE_KEY);
  const [manualOpen, setManualOpen] = useState(false);

  // Lv1 でない時は tldv-cta step を事前除外 (skipIfMissing の retry を回避し、
  // body.overflow=hidden の 250ms ラグを起こさない)
  const steps = isLv1 ? STEPS_ALL : STEPS_ALL.filter((s) => s.target !== "tldv-cta");

  const open = tour.open || manualOpen;

  // HelpDock からの再開イベントを購読
  useEffect(() => {
    const onRestart = () => {
      tour.start();
      setManualOpen(true);
    };
    window.addEventListener(TOUR_RESTART_EVENT, onRestart);
    return () => window.removeEventListener(TOUR_RESTART_EVENT, onRestart);
  }, [tour]);

  function handleClose() {
    setManualOpen(false);
    tour.close();
  }

  return (
    <ProductTour
      steps={steps}
      storageKey={STORAGE_KEY}
      open={open}
      onClose={handleClose}
    />
  );
}

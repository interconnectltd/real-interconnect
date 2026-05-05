"use client";

import type { TourStep } from "./product-tour";

/**
 * 全 auth ページ別「このページの使い方」ステップ定義レジストリ。
 *
 * 設計:
 *   - 各ページに data-tour="<key>" を付与し、対応する step set を持つ
 *   - HelpDock の「このページの使い方を見る」が現在の pathname を見て
 *     適切な step set を起動する
 *   - 各ページの主要要素 (3-5 要素) と「経営層に響く理由付け (rationale)」を完備
 *   - どのページも skipIfMissing: true で安全 (条件付き表示要素を吸収)
 */

export interface PageTourConfig {
  /** localStorage に done/dismissed を分けて保存するためのキー */
  storageKey: string;
  /** ページ名 (HelpDock のメニュー文言用) */
  pageLabel: string;
  /** ステップ */
  steps: TourStep[];
}

/**
 * pathname → tour config のマッピング。
 * 完全一致優先、prefix 一致で fallback。
 */
const TOURS: { match: (path: string) => boolean; config: PageTourConfig }[] = [
  // Dashboard はメインの tour、別に dashboard-tour.tsx で定義済 (storageKey 衝突回避)
  {
    match: (p) => p === "/dashboard",
    config: {
      storageKey: "interconnect:tour:dashboard:v1",
      pageLabel: "ダッシュボード",
      steps: [], // dashboard-tour.tsx 側に定義 (互換のため空)
    },
  },
  {
    match: (p) => p === "/matching" || p.startsWith("/matching/"),
    config: {
      storageKey: "interconnect:tour:matching:v1",
      pageLabel: "おすすめ",
      steps: [
        {
          target: "matching-mutual",
          title: "相互おすすめが最優先",
          description: "あなたが相手を求め、相手もあなたを求めている「双方マッチ」がここに並びます。",
          rationale: "片方向の興味より、双方の意図が重なるつながりは商談化率が約2.5倍高い実績があります。",
          next: "気になる方の「つながる」ボタンを押すと申請が送られます。",
          skipIfMissing: true,
        },
        {
          target: "matching-sort",
          title: "並び替え (おすすめ順 / 新着順)",
          description: "おすすめ順は AI スコア降順、新着順は最近登録された方から表示されます。",
          rationale: "経営層は時間が限られるため、初訪問は「おすすめ順」で TOP 5 を見るだけで効率的です。",
          next: "毎日訪問するなら新着順で更新差分を確認するのも有効です。",
          skipIfMissing: true,
        },
        {
          target: "matching-card-first",
          title: "「なぜ会うべきか」が明示されます",
          description: "AI 分析の根拠 (共通領域・補完関係・タイミング) を 1-3 行で表示します。",
          rationale: "理由が分かると初回ミーティングで「最初の3分」の話題探しに失敗しません。",
          next: "カードをクリックで詳細プロフィール、つながるボタンで申請。",
          skipIfMissing: true,
        },
      ],
    },
  },
  {
    match: (p) => p === "/members" || p.startsWith("/members/"),
    config: {
      storageKey: "interconnect:tour:members:v1",
      pageLabel: "メンバー",
      steps: [
        {
          target: "members-search",
          title: "意味検索が効きます",
          description: "「補助金」と入力すると、補助金/助成/支援金/公募 など関連キーワードを含むメンバーも自動で hit します。",
          rationale: "完全一致だけでは「助成金コンサル」「行政書士」を取りこぼします。意味で繋がる検索です。",
          next: "業界用語、領域、課題感、なんでも入力してください。",
          skipIfMissing: true,
        },
        {
          target: "members-filters",
          title: "業種・役職フィルタ",
          description: "横スクロールで全業種・主要役職を選べます。複合 AND 条件で絞り込み可能です。",
          rationale: "「製造業 + CFO」のように具体的に絞ると、関連度の高いメンバーだけが残ります。",
          next: "条件を絞っても 0 件のときは「条件をクリア」で全件に戻せます。",
          skipIfMissing: true,
        },
        {
          target: "members-card-first",
          title: "ブックマーク + コネクション申請",
          description: "右上のしおりアイコンで後で見るために保存、つながるボタンで申請を送ります。",
          rationale: "経営層は「気になる」と「今すぐ繋がる」を分けて管理した方が、商談タイミングを逃しません。",
          next: "ブックマークは Profile 画面でまとめて確認できます。",
          skipIfMissing: true,
        },
      ],
    },
  },
  {
    match: (p) => p === "/profile" || p.startsWith("/profile/"),
    config: {
      storageKey: "interconnect:tour:profile:v1",
      pageLabel: "プロフィール",
      steps: [
        {
          target: "profile-avatar",
          title: "アイコンを設定",
          description: "プリセット 12 種、画像アップロード、頭文字の3パターンから選べます。",
          rationale: "B2B でも「顔が見える」プロフィールは信頼形成に有効ですが、写真を出したくない方はプリセットでも識別性を保てます。",
          next: "右側のアイコンマークをクリックして変更。",
          skipIfMissing: true,
        },
        {
          target: "profile-completeness",
          title: "完成度は「真の充実度」",
          description: "100% 達成には自己紹介 400 文字 + 目標 / 提供できること各 2 件 + tl;dv 5 回分析 が必要です。",
          rationale: "短い自己紹介や空のゴールでは AI も相手も「何ができる人か」を判断できず、商談機会を逃します。",
          next: "「+%」が大きい項目から順に埋めていきましょう。",
          skipIfMissing: true,
        },
        {
          target: "profile-bio",
          title: "自己紹介の質が最重要",
          description: "経歴・関心領域・今の課題感を具体的に書くほど、AI は精度の高い推薦を作れます。",
          rationale: "「コンサル20年 / 製造業の事業承継支援 / 今期は M&A 案件を3件抱えている」のような具体性が結果に直結します。",
          next: "1000 文字まで入力できます。",
          skipIfMissing: true,
        },
        {
          target: "profile-contact",
          title: "連絡先は接続成立後に公開",
          description: "コネクション申請が承諾された相手にのみ自動で表示される、安全な設計です。",
          rationale: "ID/メールを最初から晒さないため、不本意な営業 DM を避けつつ確度の高い相手にだけ繋がれます。",
          next: "LINE / Slack / メール、複数記入可能です。",
          skipIfMissing: true,
        },
      ],
    },
  },
  {
    match: (p) => p === "/connections" || p.startsWith("/connections/"),
    config: {
      storageKey: "interconnect:tour:connections:v1",
      pageLabel: "コネクション",
      steps: [
        {
          target: "connections-tabs",
          title: "申請中 / 受信 / 接続済み",
          description: "あなたから送った申請、受信した申請、すでに繋がった方の3タブで管理します。",
          rationale: "経営層のネットワークは「進行中」と「完了」を分けて見ると、次の打ち手が明確になります。",
          next: "受信タブには未対応の申請が並びます。",
          skipIfMissing: true,
        },
      ],
    },
  },
  {
    match: (p) => p === "/notifications" || p.startsWith("/notifications/"),
    config: {
      storageKey: "interconnect:tour:notifications:v1",
      pageLabel: "通知",
      steps: [
        {
          target: "notifications-list",
          title: "重要なお知らせはここに",
          description: "コネクション申請、メッセージ、運営からのお知らせをまとめて確認できます。",
          rationale: "見逃しを防ぐため、申請受信から 24 時間以内の返信を推奨しています (B2B エチケット)。",
          next: "クリックで該当ページへ移動。",
          skipIfMissing: true,
        },
      ],
    },
  },
  {
    match: (p) => p === "/chat" || p.startsWith("/chat/") || p.startsWith("/messages"),
    config: {
      storageKey: "interconnect:tour:chat:v1",
      pageLabel: "チャット",
      steps: [
        {
          target: "chat-room-list",
          title: "コネクション成立後にチャット可能",
          description: "つながりが成立した相手とのみメッセージ交換ができます。",
          rationale: "事前承諾モデルにより、不要な営業メッセージを物理的に防ぎ、双方が望む対話だけが行われます。",
          next: "左の一覧から相手を選んで会話開始。",
          skipIfMissing: true,
        },
      ],
    },
  },
  {
    match: (p) => p === "/meetings" || p.startsWith("/meetings/"),
    config: {
      storageKey: "interconnect:tour:meetings:v1",
      pageLabel: "ミーティング",
      steps: [
        {
          target: "meetings-list",
          title: "tl;dv で記録された会議",
          description: "Zoom / Google Meet で行ったミーティングが自動的にここに集約されます。",
          rationale: "後から「あの方と話した内容」を検索できる + AI がここから興味領域を抽出してマッチング精度を上げます。",
          next: "各会議をクリックすると要約・話題・次のアクションが見られます。",
          skipIfMissing: true,
        },
      ],
    },
  },
  {
    match: (p) => p === "/settings" || p.startsWith("/settings/"),
    config: {
      storageKey: "interconnect:tour:settings:v1",
      pageLabel: "設定",
      steps: [
        {
          target: "settings-tldv",
          title: "tl;dv 連携",
          description: "API キーを設定すると、過去・新規ミーティングが自動で AI 分析対象になります。",
          rationale: "Lv1 → Lv3 へ進化するための必須ステップ。1 回の設定で以降は完全自動化されます。",
          next: "tl;dv の Settings ページから API キーをコピーしてここに貼り付け。",
          skipIfMissing: true,
        },
        {
          target: "settings-account",
          title: "アカウント情報",
          description: "メールアドレス変更、パスワード再設定、退会処理ができます。",
          rationale: "セキュリティの基本: 6ヶ月に1度のパスワード変更を推奨します。",
          next: "退会するとデータは 30 日後に完全削除されます。",
          skipIfMissing: true,
        },
      ],
    },
  },
];

export function getPageTourConfig(pathname: string | null | undefined): PageTourConfig | null {
  if (!pathname) return null;
  for (const t of TOURS) {
    if (t.match(pathname)) return t.config;
  }
  return null;
}

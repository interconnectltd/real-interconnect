"use client";

/**
 * ConnectedActions
 *
 * 接続済 (accepted) ユーザーに対する次アクションを統一する共通 component。
 *
 * 旧: 各画面 (matching/members/dashboard/bookmarks/profile-modal/notifications) で
 *     "接続済み" Badge のみ → next action がゼロで「会議リクエスト」しか動線がない
 *     場所も多く、UX として B2B SaaS 鉄則 next-best-action 不在だった。
 * 新: variant ごとにレイアウトを切り替え、Chat / 日程 / Profile の 3 アクションを
 *     その場で出す (B2B 標準 — LinkedIn / Lattice / People.ai 準拠)。
 *
 * variant:
 *   - "card"  : カード内インライン (icon-only 3 ボタン横並び、コンパクト)
 *   - "modal" : profile-modal 等 (primary [チャット] + secondary [日程] + ghost icon Profile)
 *   - "row"   : connections page のリスト行 (テキスト 3 ボタン横並び)
 */

import { MessageSquare, CalendarPlus, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenChatRoom } from "@/hooks/mutations/use-open-chat-room";

type Variant = "card" | "modal" | "row";

interface Props {
  /** 接続関係の id (chat room 取得/作成に必要) — 無い画面では空文字 OK */
  connectionId: string;
  /** 相手 user_id (Profile modal を開く用) */
  targetUserId: string;
  variant: Variant;
  /** Profile を開くハンドラ (画面側 stores/ui-store の openProfileModal を渡す) */
  onOpenProfile?: (userId: string) => void;
  /** 日程調整トリガ (modal 経由か直接ダイアログ呼ぶか画面で分岐させる) */
  onRequestMeeting?: (targetUserId: string) => void;
  className?: string;
}

export function ConnectedActions({
  connectionId,
  targetUserId,
  variant,
  onOpenProfile,
  onRequestMeeting,
  className = "",
}: Props) {
  const openChat = useOpenChatRoom();

  const handleChat = () => {
    if (!connectionId) return;
    openChat.mutate(connectionId);
  };
  const handleMeeting = () => {
    onRequestMeeting?.(targetUserId);
  };
  const handleProfile = () => {
    onOpenProfile?.(targetUserId);
  };

  if (variant === "card") {
    return (
      <div
        className={`flex items-center gap-1 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="チャットを開く"
          disabled={!connectionId || openChat.isPending}
          onClick={handleChat}
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="日程を調整する"
          disabled={!onRequestMeeting}
          onClick={handleMeeting}
        >
          <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        {onOpenProfile && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="プロフィールを見る"
            onClick={handleProfile}
          >
            <User className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    );
  }

  if (variant === "modal") {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <Button
          size="sm"
          disabled={!connectionId || openChat.isPending}
          onClick={handleChat}
        >
          <MessageSquare className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          チャットを開く
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!onRequestMeeting}
          onClick={handleMeeting}
        >
          <CalendarPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          日程を調整
        </Button>
      </div>
    );
  }

  // row: connections page 行用 (テキスト 3 ボタン)
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Button
        size="sm"
        variant="outline"
        disabled={!connectionId || openChat.isPending}
        onClick={handleChat}
      >
        <MessageSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        チャット
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!onRequestMeeting}
        onClick={handleMeeting}
      >
        <CalendarPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        日程
      </Button>
      {onOpenProfile && (
        <Button size="sm" variant="ghost" onClick={handleProfile}>
          <User className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          プロフィール
        </Button>
      )}
    </div>
  );
}

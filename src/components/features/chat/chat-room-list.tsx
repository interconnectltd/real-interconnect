"use client";

import { cn } from "@/lib/utils";
import { MessageCircle } from "lucide-react";

export interface ChatRoom {
  id: string;
  other_user: {
    id: string;
    name: string | null;
    company: string | null;
    avatar_url: string | null;
  };
  last_message: {
    content: string;
    /** content_type を type 別ラベル化に使う (scheduling_card / meeting_confirmed の JSON 露出防止) */
    content_type?: string | null;
    created_at: string;
    sender_id: string;
  } | null;
  unread_count: number;
}

/**
 * last_message を type 別の安全プレビュー文字列に変換。
 * scheduling_card / meeting_suggestion / meeting_confirmed は JSON 文字列をそのまま
 * 表示すると `{"target_user_id":"..."}` 形式で UUID/PII が一覧に露出するためラベル化。
 */
function getLastMessagePreview(lm: ChatRoom["last_message"]): string {
  if (!lm) return "メッセージはありません";
  switch (lm.content_type) {
    case "scheduling_card":
      return "日程調整カードを送信";
    case "meeting_suggestion":
      return "ミーティング提案を送信";
    case "meeting_confirmed":
      return "ミーティング確定";
    default:
      // 通常テキスト。先頭 80 字に切り詰めて表示崩れ防止
      return lm.content.length > 80 ? lm.content.slice(0, 80) + "…" : lm.content;
  }
}

interface ChatRoomListProps {
  rooms: ChatRoom[];
  selectedRoomId: string | null;
  onSelectRoom: (room: ChatRoom) => void;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatRelativeTime(iso: string): string {
  const now = new Date();
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "今";
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHour < 24) return `${diffHour}時間前`;
  if (diffDay < 7) return `${diffDay}日前`;
  return date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

export function ChatRoomList({
  rooms,
  selectedRoomId,
  onSelectRoom,
}: ChatRoomListProps) {
  if (rooms.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">
          チャットはまだありません。接続した相手とチャットを始めましょう。
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      {rooms.map((room) => {
        const isActive = room.id === selectedRoomId;
        const user = room.other_user;
        return (
          <button
            key={room.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted",
              isActive && "bg-primary/5",
            )}
            onClick={() => onSelectRoom(room)}
          >
            {/* Avatar (variant URL + onError fallback の都合で <img>) */}
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar_url}
                alt={user.name ?? ""}
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                {getInitials(user.name)}
              </div>
            )}

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">
                  {user.name ?? "ユーザー"}
                </p>
                {room.last_message && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(room.last_message.created_at)}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                {user.company && (
                  <p className="truncate text-xs text-muted-foreground">
                    {user.company}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs text-muted-foreground">
                  {getLastMessagePreview(room.last_message)}
                </p>
                {room.unread_count > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                    {room.unread_count}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSupabase } from "@/providers/supabase-provider";
import { cn } from "@/lib/utils";
import { SchedulingCard } from "./scheduling-card";
import { MeetingSuggestionCard, MeetingConfirmedCard } from "./meeting-suggestion-card";

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  content_type?: string;
  payload?: Record<string, unknown> | null;
  is_read?: boolean;
  created_at: string;
}

interface OtherUser {
  id: string;
  name: string | null;
  company: string | null;
  avatar_url: string | null;
}

interface ChatMessagesProps {
  roomId: string;
  currentUserId: string;
  otherUser: OtherUser;
}

interface MessagesResponse {
  messages: ChatMessage[];
  next_cursor: string | null;
  has_more: boolean;
}

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function getDateLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return "今日";
  if (msgDate.getTime() === yesterday.getTime()) return "昨日";
  return date.toLocaleDateString("ja-JP", { month: "long", day: "numeric" });
}

function getDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function ChatMessages({
  roomId,
  currentUserId,
  otherUser,
}: ChatMessagesProps) {
  const { supabase } = useSupabase();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["chat-messages", roomId],
    queryFn: () =>
      api.get<MessagesResponse>(`/chat/rooms/${roomId}/messages`),
  });

  const messages = data?.messages;

  // 無限スクロール (上端到達で過去メッセージ取得)
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !data?.has_more || !data.next_cursor) return;
    setIsLoadingMore(true);
    // scroll anchor: prepend 前後で scrollHeight 差分を scrollTop に加算し
    // 過去メッセージ追加時にユーザーの読み位置を維持する (旧版は最上部に飛んでいた)
    const prevH = scrollRef.current?.scrollHeight ?? 0;
    const prevTop = scrollRef.current?.scrollTop ?? 0;
    try {
      let cursor: { at?: string; id?: string } = {};
      try {
        cursor = JSON.parse(data.next_cursor);
      } catch {}
      const url = `/chat/rooms/${roomId}/messages?limit=30${
        cursor.at ? `&before_at=${encodeURIComponent(cursor.at)}` : ""
      }${cursor.id ? `&before_id=${encodeURIComponent(cursor.id)}` : ""}`;
      const older = await api.get<MessagesResponse>(url);
      queryClient.setQueryData<MessagesResponse>(
        ["chat-messages", roomId],
        (old) => {
          const oldMsgs = old?.messages ?? [];
          const seen = new Set(oldMsgs.map((m) => m.id));
          const merged = [
            ...older.messages.filter((m) => !seen.has(m.id)),
            ...oldMsgs,
          ];
          return {
            messages: merged,
            next_cursor: older.next_cursor,
            has_more: older.has_more,
          };
        },
      );
      // DOM 更新後に scrollTop を補正 (rAF で paint 後)
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          const newH = scrollRef.current.scrollHeight;
          scrollRef.current.scrollTop = prevTop + (newH - prevH);
        }
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [data?.has_more, data?.next_cursor, isLoadingMore, queryClient, roomId]);

  // IntersectionObserver で top sentinel 検知
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { root: scrollRef.current, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Mark messages as read when room opens
  useEffect(() => {
    api.post(`/chat/rooms/${roomId}/read`).catch(() => {});
  }, [roomId]);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (messages && isAtBottom) {
      requestAnimationFrame(scrollToBottom);
    }
  }, [messages, isAtBottom, scrollToBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
    }
  }, []);

  // Supabase Realtime subscription (private channel + Realtime Authorization)
  // R3 Sec 致命指摘:「publication 単独では RLS 尊重しない、別 room 物理漏洩」
  // → migration 00031 の realtime.messages RLS policy + private:true で防御
  useEffect(() => {
    const channel = supabase
      .channel(`chat:room:${roomId}`, {
        config: { private: true },
      })
      // 新方式: SQL trigger broadcast_chat_message_insert() → realtime.broadcast_changes
      .on("broadcast", { event: "INSERT" }, (payload) => {
        const newMsg = (payload.payload as { record?: ChatMessage }).record;
        if (!newMsg || !newMsg.id) return;
        queryClient.setQueryData<MessagesResponse>(
          ["chat-messages", roomId],
          (old) => {
            const msgs = old?.messages ?? [];
            if (msgs.some((m) => m.id === newMsg.id)) return old;
            // 自分送信の楽観メッセージ (tmp-*) を実 ID 行で置換 (reconcile)。
            // 同一文面の連続送信で複数 tmp が残るケースを避けるため、
            // 該当する tmp の中で最古 1 件のみ除去する (FIFO 原則)。
            let filteredMsgs = msgs;
            if (newMsg.sender_id === currentUserId) {
              const idx = msgs.findIndex(
                (m) =>
                  m.id.startsWith("tmp-") &&
                  m.sender_id === newMsg.sender_id &&
                  m.content === newMsg.content,
              );
              if (idx !== -1) {
                filteredMsgs = [
                  ...msgs.slice(0, idx),
                  ...msgs.slice(idx + 1),
                ];
              }
            }
            return {
              messages: [...filteredMsgs, newMsg],
              next_cursor: old?.next_cursor ?? null,
              has_more: old?.has_more ?? false,
            };
          },
        );
        if (newMsg.sender_id !== currentUserId) {
          api.post(`/chat/rooms/${roomId}/read`).catch(() => {});
        }
        queryClient.invalidateQueries({ queryKey: ["chat-rooms"] });
      })
      // postgres_changes ブランチは撤去 (Sec audit Critical):
      // publication 単独では RLS を尊重せず、別 room の INSERT を漏洩する
      // 潜在経路があった。broadcast 一本化で room 単位の権限境界に揃える。
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, roomId, currentUserId, queryClient]);

  // visibility 復帰時に /read 再 POST + invalidate
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        api.post(`/chat/rooms/${roomId}/read`).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["chat-messages", roomId] });
        queryClient.invalidateQueries({ queryKey: ["chat-rooms"] });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [roomId, queryClient]);

  // unread を含む最新の未読メッセージで /read 再 POST (scroll bottom 時)
  useEffect(() => {
    if (isAtBottom && messages?.some((m) => m.sender_id !== currentUserId && !m.is_read)) {
      api.post(`/chat/rooms/${roomId}/read`).catch(() => {});
    }
  }, [isAtBottom, messages, roomId, currentUserId]);

  // Group messages by date for separators
  const messageList = useMemo(() => messages ?? [], [messages]);
  const groupedRender = useMemo(() => {
    let lastDateKey = "";
    return messageList.map((msg) => {
      const dateKey = getDateKey(msg.created_at);
      const showDateSeparator = dateKey !== lastDateKey;
      lastDateKey = dateKey;
      return { msg, showDateSeparator };
    });
  }, [messageList]);

  if (isLoading) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        role="status"
        aria-label="メッセージを読み込み中"
      >
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
        role="alert"
      >
        <p className="text-sm text-destructive">メッセージを読み込めませんでした</p>
        <button
          type="button"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["chat-messages", roomId] })
          }
          className="text-xs underline text-muted-foreground"
        >
          再試行
        </button>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overscroll-contain px-4 py-3"
      role="log"
      aria-live="polite"
      aria-label={`${otherUser.name ?? "相手"}とのチャット`}
    >
      {/* 上端 sentinel: 無限スクロール用 */}
      <div ref={topSentinelRef} className="h-1" aria-hidden="true" />
      {isLoadingMore && (
        <div className="flex justify-center py-2" role="status" aria-label="過去メッセージ読込中">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}

      {messageList.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground">
            メッセージはまだありません。最初のメッセージを送りましょう。
          </p>
        </div>
      ) : (
        <ul className="space-y-1 list-none p-0 m-0">
          {groupedRender.map(({ msg, showDateSeparator }) => {
            const isOwn = msg.sender_id === currentUserId;
            return (
              <li key={msg.id}>
                {showDateSeparator && (
                  <div
                    className="my-4 flex items-center gap-3"
                    role="separator"
                    aria-label={getDateLabel(msg.created_at)}
                  >
                    <div className="h-px flex-1 bg-border" aria-hidden="true" />
                    <span className="text-xs text-muted-foreground">
                      {getDateLabel(msg.created_at)}
                    </span>
                    <div className="h-px flex-1 bg-border" aria-hidden="true" />
                  </div>
                )}
                <div
                  className={cn(
                    "flex",
                    isOwn ? "justify-end" : "justify-start",
                  )}
                >
                  {msg.content_type === "scheduling_card" ? (
                    (() => {
                      // Wave11 Y: 旧実装は JSON.parse(msg.content) で payload 読みだったが
                      // 新仕様 (PostMessageSchema 整合) で content は表示用 string、
                      // 構造データは msg.payload (jsonb) に格納。 payload 直読に修正。
                      const p = (msg.payload ?? null) as {
                        target_user_id?: string;
                      } | null;
                      return (
                        <SchedulingCard
                          roomId={roomId}
                          targetUserId={p?.target_user_id ?? otherUser.id}
                          currentUserId={currentUserId}
                        />
                      );
                    })()
                  ) : msg.content_type === "meeting_suggestion" ? (
                    (() => {
                      // 同上、 payload 直読に統一
                      const p = (msg.payload ?? null) as {
                        intent?: "confirmed" | "proposed";
                        datetime?: string | null;
                        platform?: "zoom" | "meet" | null;
                        confidence?: number;
                      } | null;
                      return (
                        <MeetingSuggestionCard
                          suggestion={{
                            intent: p?.intent ?? "proposed",
                            datetime: p?.datetime ?? null,
                            platform: p?.platform ?? null,
                            confidence: p?.confidence ?? 0,
                          }}
                          roomId={roomId}
                          currentUserId={currentUserId}
                          otherUserId={otherUser.id}
                        />
                      );
                    })()
                  ) : msg.content_type === "meeting_confirmed" ? (
                    <MeetingConfirmedCard content={msg.content} />
                  ) : (
                    <div
                      className={cn(
                        "max-w-[85%] rounded-[12px] px-3 py-2 sm:max-w-[75%]",
                        isOwn
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words text-sm">
                        {msg.content}
                      </p>
                      <p
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px]",
                          isOwn
                            ? "text-primary-foreground/60"
                            : "text-muted-foreground",
                        )}
                      >
                        <span aria-label={`送信時刻 ${formatMessageTime(msg.created_at)}`}>
                          {formatMessageTime(msg.created_at)}
                        </span>
                        {/* 既読インジケータ: 自分の送信メッセージのみ表示
                            ✓ = 送信済 (未読) / ✓✓ = 既読 (相手が見た) */}
                        {isOwn && (
                          <span
                            aria-label={msg.is_read ? "既読" : "送信済 (未読)"}
                            className={cn(
                              "inline-flex items-center font-medium tabular-nums",
                              msg.is_read
                                ? "text-primary-foreground"
                                : "text-primary-foreground/40",
                            )}
                          >
                            {msg.is_read ? "✓✓" : "✓"}
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

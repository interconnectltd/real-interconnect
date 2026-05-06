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
    try {
      // next_cursor は JSON.stringify({at, id}) されている
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
          // 重複除去
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
            return {
              messages: [...msgs, newMsg],
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
      // 後方互換: publication ベース postgres_changes も subscribe (移行中の冗長性)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          queryClient.setQueryData<MessagesResponse>(
            ["chat-messages", roomId],
            (old) => {
              const msgs = old?.messages ?? [];
              if (msgs.some((m) => m.id === newMsg.id)) return old;
              return {
                messages: [...msgs, newMsg],
                next_cursor: old?.next_cursor ?? null,
                has_more: old?.has_more ?? false,
              };
            },
          );
        },
      )
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
                      let parsed: { target_user_id?: string } = {};
                      try { parsed = JSON.parse(msg.content); } catch {}
                      return (
                        <SchedulingCard
                          roomId={roomId}
                          targetUserId={parsed.target_user_id ?? otherUser.id}
                          currentUserId={currentUserId}
                        />
                      );
                    })()
                  ) : msg.content_type === "meeting_suggestion" ? (
                    (() => {
                      let parsed: {
                        intent?: "confirmed" | "proposed";
                        datetime?: string | null;
                        platform?: "zoom" | "meet" | null;
                        confidence?: number;
                      } = {};
                      try { parsed = JSON.parse(msg.content); } catch {}
                      return (
                        <MeetingSuggestionCard
                          suggestion={{
                            intent: parsed.intent ?? "proposed",
                            datetime: parsed.datetime ?? null,
                            platform: parsed.platform ?? null,
                            confidence: parsed.confidence ?? 0,
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
                        "max-w-[75%] rounded-2xl px-3 py-2",
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
                          "mt-1 text-right text-[10px]",
                          isOwn
                            ? "text-primary-foreground/60"
                            : "text-muted-foreground",
                        )}
                        aria-label={`送信時刻 ${formatMessageTime(msg.created_at)}`}
                      >
                        {formatMessageTime(msg.created_at)}
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

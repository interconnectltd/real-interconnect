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
  const [isAtBottom, setIsAtBottom] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ["chat-messages", roomId],
    queryFn: () =>
      api.get<{ messages: ChatMessage[]; next_cursor: string | null }>(
        `/chat/rooms/${roomId}/messages`,
      ),
  });

  const messages = data?.messages;

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
      // Small delay to ensure DOM is updated
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

  // Supabase Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`room:${roomId}`)
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
          queryClient.setQueryData<{ messages: ChatMessage[]; next_cursor: string | null }>(
            ["chat-messages", roomId],
            (old) => {
              const msgs = old?.messages ?? [];
              // Avoid duplicates
              if (msgs.some((m) => m.id === newMsg.id)) return old ?? { messages: msgs, next_cursor: null };
              return { messages: [...msgs, newMsg], next_cursor: old?.next_cursor ?? null };
            },
          );
          // Mark as read if it's from the other user
          if (newMsg.sender_id !== currentUserId) {
            api.post(`/chat/rooms/${roomId}/read`).catch(() => {});
          }
          // Invalidate room list for unread counts
          queryClient.invalidateQueries({ queryKey: ["chat-rooms"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, roomId, currentUserId, queryClient]);

  // Re-fetch messages when returning from background
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", roomId] });
        queryClient.invalidateQueries({ queryKey: ["chat-rooms"] });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [roomId, queryClient]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const messageList = useMemo(
    () => [...(messages ?? [])].reverse(),
    [messages],
  );

  // Group messages by date for separators
  let lastDateKey = "";

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overscroll-contain px-4 py-3"
    >
      {messageList.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground">
            メッセージはまだありません。最初のメッセージを送りましょう。
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {messageList.map((msg) => {
            const isOwn = msg.sender_id === currentUserId;
            const dateKey = getDateKey(msg.created_at);
            const showDateSeparator = dateKey !== lastDateKey;
            lastDateKey = dateKey;

            return (
              <div key={msg.id}>
                {showDateSeparator && (
                  <div className="my-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground">
                      {getDateLabel(msg.created_at)}
                    </span>
                    <div className="h-px flex-1 bg-border" />
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
                      >
                        {formatMessageTime(msg.created_at)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

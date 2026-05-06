"use client";

import { useState, useCallback, useRef, type KeyboardEvent } from "react";
import { Send, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

interface ChatInputProps {
  roomId: string;
  /** 楽観更新で送信主を sender_id に設定するための viewer */
  currentUserId?: string;
  otherUserId?: string;
  onMessageSent?: () => void;
}

interface OptimisticMessage {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  content_type: string;
  created_at: string;
  is_read: boolean;
  /** 楽観 message を識別するフラグ (reconcile 用) */
  __optimistic?: true;
}

/**
 * R5 改修:
 * - Idempotency-Key を crypto.randomUUID() で生成し送信、重複 INSERT を物理防止
 * - safe-area-inset-bottom 対応 (iOS PWA Standalone)
 * - ARIA label + role="form"
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // fallback: timestamp + random
  return `${Date.now()}-${Math.random().toString(36).slice(2, 18)}`;
}

export function ChatInput({
  roomId,
  currentUserId,
  otherUserId,
  onMessageSent,
}: ChatInputProps) {
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  const sendMessage = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    // 楽観更新: 送信に使う Idempotency-Key と tmp_id を共有して reconcile に使う。
    // これで「同一文面の連続送信で 1 行目しか reconcile されない」問題を解消。
    const idemKey = newIdempotencyKey();
    const tmpId = `tmp-${idemKey}`;
    const optimistic: OptimisticMessage | null = currentUserId
      ? {
          id: tmpId,
          room_id: roomId,
          sender_id: currentUserId,
          content: trimmed,
          content_type: "text",
          created_at: new Date().toISOString(),
          is_read: true,
          __optimistic: true,
        }
      : null;

    if (optimistic) {
      queryClient.setQueryData<{
        messages: OptimisticMessage[];
        next_cursor: string | null;
        has_more: boolean;
      }>(["chat-messages", roomId], (old) => {
        if (!old) return old;
        return { ...old, messages: [...old.messages, optimistic] };
      });
    }

    setIsSending(true);
    const prevContent = trimmed;
    setContent("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      await api.post(
        `/chat/rooms/${roomId}/messages`,
        { content: trimmed },
        { headers: { "Idempotency-Key": idemKey } },
      );
      queryClient.invalidateQueries({ queryKey: ["chat-messages", roomId] });
      onMessageSent?.();
    } catch {
      if (optimistic) {
        queryClient.setQueryData<{
          messages: OptimisticMessage[];
          next_cursor: string | null;
          has_more: boolean;
        }>(["chat-messages", roomId], (old) => {
          if (!old) return old;
          return {
            ...old,
            messages: old.messages.filter((m) => m.id !== tmpId),
          };
        });
      }
      // 失敗時の入力復元: ユーザーが既に新しい入力を始めていたら上書きしない
      setContent((curr) => (curr === "" ? prevContent : curr));
      toast.error("メッセージの送信に失敗しました。再試行してください");
    } finally {
      setIsSending(false);
    }
  }, [content, isSending, roomId, currentUserId, queryClient, onMessageSent]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  };

  return (
    <form
      role="form"
      aria-label="メッセージ入力"
      onSubmit={(e) => {
        e.preventDefault();
        sendMessage();
      }}
      className="flex items-end gap-1.5 border-t p-2 sm:gap-2 sm:p-3"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <label htmlFor="chat-input-textarea" className="sr-only">
        メッセージ本文
      </label>
      <textarea
        id="chat-input-textarea"
        ref={textareaRef}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          handleInput();
        }}
        onKeyDown={handleKeyDown}
        placeholder="メッセージを入力..."
        enterKeyHint="send"
        rows={1}
        disabled={isSending}
        aria-label="メッセージ本文"
        className="min-w-0 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-base md:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      />
      {otherUserId && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 shrink-0"
          title="日程調整"
          aria-label="日程調整カードを送信"
          disabled={isSending}
          onClick={async () => {
            if (isSending) return;
            setIsSending(true);
            try {
              await api.post(
                `/chat/rooms/${roomId}/messages`,
                {
                  content: JSON.stringify({ target_user_id: otherUserId }),
                  content_type: "scheduling_card",
                },
                { headers: { "Idempotency-Key": newIdempotencyKey() } },
              );
              onMessageSent?.();
            } catch {
              toast.error("メッセージの送信に失敗しました");
            } finally {
              setIsSending(false);
            }
          }}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      <Button
        type="submit"
        size="sm"
        className="shrink-0"
        aria-label="送信"
        disabled={isSending || !content.trim()}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  );
}

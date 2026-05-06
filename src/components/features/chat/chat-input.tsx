"use client";

import { useState, useCallback, useRef, type KeyboardEvent } from "react";
import { Send, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

interface ChatInputProps {
  roomId: string;
  otherUserId?: string;
  onMessageSent?: () => void;
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

export function ChatInput({ roomId, otherUserId, onMessageSent }: ChatInputProps) {
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    try {
      await api.post(
        `/chat/rooms/${roomId}/messages`,
        { content: trimmed },
        { headers: { "Idempotency-Key": newIdempotencyKey() } },
      );
      setContent("");
      onMessageSent?.();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch {
      toast.error("メッセージの送信に失敗しました");
    } finally {
      setIsSending(false);
    }
  }, [content, isSending, roomId, onMessageSent]);

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

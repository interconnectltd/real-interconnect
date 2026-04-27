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

export function ChatInput({ roomId, otherUserId, onMessageSent }: ChatInputProps) {
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    try {
      await api.post(`/chat/rooms/${roomId}/messages`, { content: trimmed });
      setContent("");
      onMessageSent?.();
      // Reset textarea height
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
    <div className="flex items-end gap-2 border-t p-3">
      <textarea
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
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-base md:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      />
      {otherUserId && (
        <Button
          size="sm"
          variant="outline"
          title="日程調整"
          disabled={isSending}
          onClick={async () => {
            if (isSending) return;
            setIsSending(true);
            try {
              await api.post(`/chat/rooms/${roomId}/messages`, {
                content: JSON.stringify({ target_user_id: otherUserId }),
                content_type: "scheduling_card",
              });
              onMessageSent?.();
            } catch {
              toast.error("メッセージの送信に失敗しました");
            } finally {
              setIsSending(false);
            }
          }}
        >
          <CalendarDays className="h-4 w-4" />
        </Button>
      )}
      <Button
        size="sm"
        onClick={sendMessage}
        disabled={isSending || !content.trim()}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}

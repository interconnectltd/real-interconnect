"use client";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useSupabase } from "@/providers/supabase-provider";
import {
  ChatRoomList,
  type ChatRoom,
} from "@/components/features/chat/chat-room-list";
import { ChatMessages } from "@/components/features/chat/chat-messages";
import { ChatInput } from "@/components/features/chat/chat-input";
import { ChatConsentBanner } from "@/components/features/chat/chat-consent-banner";

function ChatPageInner() {
  const { user } = useSupabase();
  const searchParams = useSearchParams();
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);

  const { data: rooms, isLoading } = useQuery({
    queryKey: ["chat-rooms"],
    queryFn: () => api.get<ChatRoom[]>("/chat/rooms"),
  });

  // Auto-select room from URL param ?room=xxx
  useEffect(() => {
    const roomId = searchParams.get("room");
    if (roomId && rooms && !selectedRoom) {
      const found = rooms.find((r) => r.id === roomId);
      if (found) setSelectedRoom(found);
    }
  }, [searchParams, rooms, selectedRoom]);

  const handleSelectRoom = useCallback((room: ChatRoom) => {
    setSelectedRoom(room);
    window.history.pushState(null, "", `/chat?room=${room.id}`);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedRoom(null);
    window.history.pushState(null, "", "/chat");
  }, []);

  // Handle mobile keyboard - keep input visible
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      // When keyboard opens, visualViewport.height shrinks
      const container = document.getElementById('chat-container');
      if (container) {
        const offset = window.innerHeight - vv.height;
        container.style.height = `calc(100dvh - 220px - ${offset}px)`;
      }
    };

    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, []);

  // Handle browser back/forward button
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const roomId = params.get("room");
      if (!roomId) {
        setSelectedRoom(null);
      } else if (rooms) {
        const found = rooms.find((r) => r.id === roomId);
        if (found) setSelectedRoom(found);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [rooms]);

  // Handle mobile keyboard — shrink chat container when keyboard opens
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      const el = document.getElementById("chat-container");
      if (el) {
        const offset = window.innerHeight - vv.height;
        el.style.height = offset > 50
          ? `calc(100dvh - 220px - ${offset}px)`
          : "";
      }
    };
    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="space-y-4">
      <ChatConsentBanner />
      <div>
        <h1 className="text-2xl font-bold">チャット</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          接続した相手とメッセージをやりとり
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div id="chat-container" className="flex h-[calc(100dvh-220px)] min-h-[200px]">
          {/* Left panel: Room list */}
          <div
            className={`w-full flex-col border-r md:flex md:w-80 md:shrink-0 ${
              selectedRoom ? "hidden" : "flex"
            }`}
          >
            <div className="border-b px-4 py-3">
              <p className="text-sm font-medium text-muted-foreground">
                トーク一覧
              </p>
            </div>
            {isLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-lg bg-muted"
                  />
                ))}
              </div>
            ) : (
              <ChatRoomList
                rooms={rooms ?? []}
                selectedRoomId={selectedRoom?.id ?? null}
                onSelectRoom={handleSelectRoom}
              />
            )}
          </div>

          {/* Right panel: Messages */}
          <div
            className={`flex-1 flex-col ${
              selectedRoom ? "flex" : "hidden md:flex"
            }`}
          >
            {selectedRoom && user ? (
              <>
                {/* Chat header */}
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="md:hidden"
                    onClick={handleBack}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  {selectedRoom.other_user.avatar_url ? (
                    <img
                      src={selectedRoom.other_user.avatar_url}
                      alt={selectedRoom.other_user.name ?? ""}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                      {selectedRoom.other_user.name
                        ?.split(/\s+/)
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {selectedRoom.other_user.name ?? "ユーザー"}
                    </p>
                    {selectedRoom.other_user.company && (
                      <p className="truncate text-xs text-muted-foreground">
                        {selectedRoom.other_user.company}
                      </p>
                    )}
                  </div>
                </div>

                {/* Messages */}
                <ChatMessages
                  roomId={selectedRoom.id}
                  currentUserId={user.id}
                  otherUser={selectedRoom.other_user}
                />

                {/* Input */}
                <ChatInput roomId={selectedRoom.id} otherUserId={selectedRoom.other_user.id} />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <MessageCircle className="h-10 w-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">
                  チャットを選択してください
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ChatPageInner />
    </Suspense>
  );
}

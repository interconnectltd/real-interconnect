"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCheck, Clock, Send, Star, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConnections } from "@/hooks/queries/use-connections";
import { useUpdateConnection } from "@/hooks/mutations/use-update-connection";
import { useFeedbackStatus } from "@/hooks/queries/use-feedback-status";
import { FeedbackModal } from "@/components/shared/feedback-modal";
import { useFilterStore } from "@/stores/filter-store";
import { useSupabase } from "@/providers/supabase-provider";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import type { Connection } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  pending: "承認待ち",
  accepted: "接続済み",
  declined: "お断り済み",
  cancelled: "取消済み",
  disconnected: "解除済み",
  blocked: "ブロック済み",
  reaccepted: "再接続済み",
};

export default function ConnectionsPage() {
  const router = useRouter();
  const { user } = useSupabase();
  const { connectionTab, setConnectionTab } = useFilterStore();
  const [feedbackTarget, setFeedbackTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [chatLoading, setChatLoading] = useState<string | null>(null);

  const handleChat = async (connectionId: string) => {
    setChatLoading(connectionId);
    try {
      const room = await api.post<{ id: string }>("/chat/rooms", {
        connection_id: connectionId,
      });
      router.push(`/chat?room=${room.id}`);
    } catch {
      // Room already exists — fetch rooms and find the one for this connection
      try {
        const rooms = await api.get<Array<{ id: string; connection_id: string }>>("/chat/rooms");
        const existing = rooms.find((r) => r.connection_id === connectionId);
        if (existing) router.push(`/chat?room=${existing.id}`);
      } catch {
        toast.error("チャットの開始に失敗しました");
      }
    } finally {
      setChatLoading(null);
    }
  };

  const statusFilter =
    connectionTab === "pending" ? "pending"
    : connectionTab === "sent" ? "pending"
    : undefined;

  const { data: connections, isLoading, isError } = useConnections(statusFilter);
  const updateConnection = useUpdateConnection();
  const { data: feedbackMap } = useFeedbackStatus();

  // Filter sent vs received pending
  const filtered = connections?.filter((c: Connection & { profile?: unknown }) => {
    if (connectionTab === "sent") return c.user_id === user?.id;
    if (connectionTab === "pending") return c.connected_user_id === user?.id;
    return true;
  });

  const tabs = [
    { key: "all" as const, label: "すべて", icon: UserCheck },
    { key: "pending" as const, label: "承認待ち", icon: Clock },
    { key: "sent" as const, label: "送信済み", icon: Send },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">コネクション</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          あなたのビジネスネットワーク
        </p>
      </div>

      <div className="flex gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            variant={connectionTab === tab.key ? "default" : "outline"}
            size="sm"
            onClick={() => setConnectionTab(tab.key)}
          >
            <tab.icon className="mr-1.5 h-3.5 w-3.5" />
            {tab.label}
          </Button>
        ))}
      </div>

      {isError ? (
        <div className="rounded-lg border border-dashed p-6 sm:p-12 text-center">
          <p className="text-sm text-muted-foreground">データの取得に失敗しました</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>
            再読み込み
          </Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : filtered && filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((conn) => {
            const profile = conn.profile;
            const isReceived = conn.connected_user_id === user?.id;
            return (
              <Card key={conn.id}>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{profile?.name ?? "ユーザー"}</p>
                    <p className="text-xs text-muted-foreground">
                      {profile?.company}
                      {profile?.position ? ` / ${profile.position}` : ""}
                    </p>
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {STATUS_LABELS[conn.status] ?? conn.status}
                    </Badge>
                  </div>
                  {conn.status === "pending" && isReceived && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={updateConnection.isPending}
                        onClick={() => updateConnection.mutate({ id: conn.id, status: "accepted" })}
                      >
                        承認
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateConnection.isPending}
                        onClick={() => updateConnection.mutate({ id: conn.id, status: "declined" })}
                      >
                        拒否
                      </Button>
                    </div>
                  )}
                  {(conn.status === "accepted" || conn.status === "reaccepted") && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={chatLoading === conn.id}
                        onClick={() => handleChat(conn.id)}
                      >
                        <MessageCircle className="mr-1 h-3.5 w-3.5" />
                        チャットを開始
                      </Button>
                      {conn.status === "accepted" &&
                        !feedbackMap?.[conn.user_id === user?.id ? conn.connected_user_id : conn.user_id] && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const targetId = conn.user_id === user?.id ? conn.connected_user_id : conn.user_id;
                            setFeedbackTarget({
                              id: targetId,
                              name: profile?.name ?? "ユーザー",
                            });
                          }}
                        >
                          <Star className="mr-1 h-3.5 w-3.5" />
                          評価する
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={updateConnection.isPending}
                        onClick={() => {
                          if (window.confirm("このコネクションを解除しますか？")) {
                            updateConnection.mutate({ id: conn.id, status: "disconnected" });
                          }
                        }}
                      >
                        解除
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 sm:p-12 text-center">
          <UserCheck className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            {connectionTab === "pending"
              ? "承認待ちのコネクションはありません"
              : "コネクションがまだありません"}
          </p>
        </div>
      )}

      {feedbackTarget && (
        <FeedbackModal
          open={!!feedbackTarget}
          onOpenChange={(open) => {
            if (!open) setFeedbackTarget(null);
          }}
          targetId={feedbackTarget.id}
          targetName={feedbackTarget.name}
        />
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { UserCheck, Clock, Send, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConnections } from "@/hooks/queries/use-connections";
import { useUpdateConnection } from "@/hooks/mutations/use-update-connection";
import { useFeedbackStatus } from "@/hooks/queries/use-feedback-status";
import { FeedbackModal } from "@/components/shared/feedback-modal";
import { useFilterStore } from "@/stores/filter-store";
import { useSupabase } from "@/providers/supabase-provider";
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
  const { user } = useSupabase();
  const { connectionTab, setConnectionTab } = useFilterStore();
  const [feedbackTarget, setFeedbackTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const statusFilter =
    connectionTab === "pending" ? "pending"
    : connectionTab === "sent" ? "pending"
    : undefined;

  const { data: connections, isLoading } = useConnections(statusFilter);
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

      {isLoading ? (
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
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{profile?.name ?? "ユーザー"}</p>
                    <p className="text-xs text-muted-foreground">
                      {profile?.company}
                      {profile?.position ? ` / ${profile.position}` : ""}
                    </p>
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {STATUS_LABELS[conn.status] ?? conn.status}
                    </Badge>
                  </div>
                  {conn.status === "pending" && isReceived && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => updateConnection.mutate({ id: conn.id, status: "accepted" })}
                      >
                        承認
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateConnection.mutate({ id: conn.id, status: "declined" })}
                      >
                        拒否
                      </Button>
                    </div>
                  )}
                  {conn.status === "accepted" && (
                    <div className="flex gap-2">
                      {!feedbackMap?.[conn.user_id === user?.id ? conn.connected_user_id : conn.user_id] && (
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
                        variant="outline"
                        onClick={() => updateConnection.mutate({ id: conn.id, status: "disconnected" })}
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
        <div className="rounded-lg border border-dashed p-12 text-center">
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

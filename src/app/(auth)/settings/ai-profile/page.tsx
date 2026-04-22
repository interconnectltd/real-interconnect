"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Brain, Eye, EyeOff, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface VectorItem {
  text: string;
  category?: string;
  confidence?: number;
  urgency?: string;
  explicit?: boolean;
}

interface AiProfileData {
  need_vectors: VectorItem[];
  offer_vectors: VectorItem[];
  topic_vectors: VectorItem[];
  hidden_items: string[];
  analysis_count: number;
  last_analyzed_at: string | null;
}

function confidenceVariant(confidence?: number) {
  if (!confidence) return "secondary" as const;
  if (confidence >= 0.8) return "default" as const;
  if (confidence >= 0.5) return "secondary" as const;
  return "outline" as const;
}

function confidenceLabel(confidence?: number) {
  if (!confidence) return "不明";
  if (confidence >= 0.8) return "高";
  if (confidence >= 0.5) return "中";
  return "低";
}

function urgencyVariant(urgency?: string) {
  if (urgency === "high") return "destructive" as const;
  if (urgency === "medium") return "secondary" as const;
  return "outline" as const;
}

function urgencyLabel(urgency?: string) {
  if (urgency === "high") return "緊急";
  if (urgency === "medium") return "中程度";
  if (urgency === "low") return "低";
  return null;
}

function VectorItemRow({
  item,
  isHidden,
  isToggling,
  onToggle,
  showUrgency,
}: {
  item: VectorItem;
  isHidden: boolean;
  isToggling: boolean;
  onToggle: () => void;
  showUrgency?: boolean;
}) {
  const urgency = urgencyLabel(item.urgency);

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
        isHidden ? "border-dashed border-muted bg-muted/30" : "border-border"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={`text-sm ${
            isHidden
              ? "text-muted-foreground line-through"
              : "text-foreground"
          }`}
        >
          {item.text}
        </span>
        {item.category && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {item.category}
          </Badge>
        )}
        <Badge
          variant={confidenceVariant(item.confidence)}
          className="shrink-0 text-[10px]"
        >
          確度: {confidenceLabel(item.confidence)}
        </Badge>
        {showUrgency && urgency && (
          <Badge
            variant={urgencyVariant(item.urgency)}
            className="shrink-0 text-[10px]"
          >
            {urgency}
          </Badge>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={isToggling}
        onClick={onToggle}
        aria-label={isHidden ? "再表示" : "非表示にする"}
      >
        {isToggling ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : isHidden ? (
          <EyeOff className="size-3.5 text-muted-foreground" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

export default function AiProfilePage() {
  const [data, setData] = useState<AiProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingItems, setTogglingItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch("/api/v1/ai-profile");
        const json = await res.json();
        if (!res.ok) {
          setError(json.error?.message ?? "データの取得に失敗しました");
          return;
        }
        setData(json.data);
      } catch {
        setError("データの取得に失敗しました");
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, []);

  const toggleItem = useCallback(
    async (itemText: string) => {
      if (!data) return;
      const isCurrentlyHidden = data.hidden_items.includes(itemText);
      const action = isCurrentlyHidden ? "unhide" : "hide";

      setTogglingItems((prev) => new Set(prev).add(itemText));

      try {
        const res = await fetch("/api/v1/ai-profile/hide", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_text: itemText, action }),
        });
        const json = await res.json();
        if (res.ok) {
          setData((prev) =>
            prev ? { ...prev, hidden_items: json.data.hidden_items } : prev
          );
        }
      } finally {
        setTogglingItems((prev) => {
          const next = new Set(prev);
          next.delete(itemText);
          return next;
        });
      }
    },
    [data]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          設定に戻る
        </Link>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  const isEmpty =
    !data ||
    (data.need_vectors.length === 0 &&
      data.offer_vectors.length === 0 &&
      data.topic_vectors.length === 0);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          設定に戻る
        </Link>
        <h1 className="mt-3 text-2xl font-bold">AIプロフィール</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ミーティングからAIが抽出したあなたのニーズ・オファー・トピック
        </p>
      </div>

      {data && (
        <Card size="sm">
          <CardContent>
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">分析回数: </span>
                <span className="font-medium">{data.analysis_count}</span>
              </div>
              {data.last_analyzed_at && (
                <div>
                  <span className="text-muted-foreground">最終分析: </span>
                  <span className="font-medium">
                    {new Date(data.last_analyzed_at).toLocaleDateString("ja-JP")}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isEmpty ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Brain className="size-10 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium">まだデータがありません</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  tl;dvを接続してミーティングを分析すると、AIがあなたのニーズやオファーを抽出します
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {data!.need_vectors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">抽出されたニーズ</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data!.need_vectors.map((item) => (
                    <VectorItemRow
                      key={item.text}
                      item={item}
                      isHidden={data!.hidden_items.includes(item.text)}
                      isToggling={togglingItems.has(item.text)}
                      onToggle={() => toggleItem(item.text)}
                      showUrgency
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data!.offer_vectors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">抽出されたオファー</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data!.offer_vectors.map((item) => (
                    <VectorItemRow
                      key={item.text}
                      item={item}
                      isHidden={data!.hidden_items.includes(item.text)}
                      isToggling={togglingItems.has(item.text)}
                      onToggle={() => toggleItem(item.text)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data!.topic_vectors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">トピック</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data!.topic_vectors.map((item) => (
                    <VectorItemRow
                      key={item.text}
                      item={item}
                      isHidden={data!.hidden_items.includes(item.text)}
                      isToggling={togglingItems.has(item.text)}
                      onToggle={() => toggleItem(item.text)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            非表示にした項目はスコアリングから除外されます
          </p>
        </>
      )}
    </div>
  );
}

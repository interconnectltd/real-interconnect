"use client";

/**
 * 会議紐付け Dialog (admin)
 *
 * 申請ユーザーに対して、tl;dv 同期済の会議リストから「この人が登場している」
 * ものを選択して `meeting_participants.user_id` に back-fill する。
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";

interface ImportRequest {
  id: string;
  user_id: string;
  status: string;
  user_profiles: { id: string; name: string; email: string; company: string | null } | null;
}

interface MeetingCandidate {
  transcript_id: string;
  title: string | null;
  meeting_date: string | null;
  status: string | null;
  participants_count: number;
  linked_to_this_user: boolean;
  candidates: Array<{
    participant_id: string;
    speaker_name: string | null;
    email: string | null;
    already_linked_other: boolean;
  }>;
}

interface MeetingsResponse {
  request: { id: string; user_id: string; status: string };
  profile: { id: string; name: string; email: string } | null;
  meetings: MeetingCandidate[];
}

export function LinkMeetingsDialog({
  request,
  onClose,
  onLinked,
}: {
  request: ImportRequest;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  // key=transcript_id, value=speaker_name (使う候補名)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-link-meetings", request.id],
    queryFn: () => api.get<MeetingsResponse>(`/admin/import-requests/${request.id}/meetings`),
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      const meetings = [...selected.entries()].map(([transcript_id, speaker_name]) => ({
        transcript_id,
        speaker_name,
      }));
      return api.post<{
        participants_linked: number;
        meetings_attempted: number;
        errors: Array<{ transcript_id: string; message: string }>;
      }>(`/admin/import-requests/${request.id}/meetings`, { meetings });
    },
    onSuccess: (res) => {
      toast.success(`${res.participants_linked} 件の会議参加者を紐付けました`);
      onLinked();
      onClose();
    },
    onError: () => toast.error("紐付けに失敗しました"),
  });

  // 候補数が多い会議を上位に
  const sortedMeetings = useMemo(() => {
    if (!data) return [];
    return [...data.meetings].sort((a, b) => {
      // 既に紐付け済は下に
      if (a.linked_to_this_user !== b.linked_to_this_user) {
        return a.linked_to_this_user ? 1 : -1;
      }
      // 候補数 desc
      return b.candidates.length - a.candidates.length;
    });
  }, [data]);

  function toggle(m: MeetingCandidate) {
    if (m.linked_to_this_user) return; // 既に紐付け済はトグル不可
    if (m.candidates.length === 0) return; // 候補がない会議は紐付け不可
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(m.transcript_id)) {
        next.delete(m.transcript_id);
      } else {
        // 最初の候補の speaker_name を使う
        const speakerName = m.candidates[0]?.speaker_name ?? "";
        if (speakerName) next.set(m.transcript_id, speakerName);
      }
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>会議を紐付ける</DialogTitle>
          <DialogDescription>
            <strong>{request.user_profiles?.name}</strong>{" "}
            ({request.user_profiles?.email}) に紐付ける会議を選択してください。
            speaker_name または email がプロフィールと一致する候補を highlight しています。
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
          </div>
        )}

        {isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            候補会議の取得に失敗しました。
          </div>
        )}

        {data && sortedMeetings.length === 0 && (
          <div className="rounded-md border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
            会議データがまだ同期されていません。tl:dv 同期を先に実行してください。
          </div>
        )}

        {data && sortedMeetings.length > 0 && (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto list-none p-0 pr-1">
            {sortedMeetings.map((m) => {
              const isSelected = selected.has(m.transcript_id);
              const noCandidate = m.candidates.length === 0;
              const disabled = m.linked_to_this_user || noCandidate;
              return (
                <li
                  key={m.transcript_id}
                  className={`rounded-md border p-3 text-sm shadow-sm transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : disabled
                        ? "bg-muted/30 opacity-60"
                        : "bg-card hover:bg-muted/30"
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={isSelected}
                      disabled={disabled}
                      onChange={() => toggle(m)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">
                          {m.title ?? "(タイトルなし)"}
                        </p>
                        {m.meeting_date && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(m.meeting_date).toLocaleDateString("ja-JP")}
                          </span>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          参加者 {m.participants_count}
                        </Badge>
                        {m.linked_to_this_user && (
                          <Badge variant="secondary" className="text-[10px]">
                            <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                            既に紐付け済
                          </Badge>
                        )}
                      </div>
                      {m.candidates.length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          候補: {m.candidates
                            .map((c) =>
                              c.already_linked_other
                                ? `${c.speaker_name} (他に紐付け済)`
                                : c.speaker_name,
                            )
                            .join(" / ")}
                        </p>
                      ) : (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          名前一致の候補なし (手動 SQL で紐付けが必要)
                        </p>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex justify-between gap-2 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            選択中: <strong>{selected.size}</strong> 件
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              size="sm"
              onClick={() => linkMutation.mutate()}
              disabled={selected.size === 0 || linkMutation.isPending}
            >
              {linkMutation.isPending ? "紐付け中..." : `${selected.size} 件を紐付ける`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

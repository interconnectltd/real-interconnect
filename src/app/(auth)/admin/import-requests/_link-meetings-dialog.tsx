"use client";

/**
 * 会議紐付け Dialog (admin) — v2 Tabs UI
 *
 * 2 タブ構成:
 *  1. 会議から選ぶ: tl;dv 同期済の transcripts から会議を選び、Step2 で
 *     その会議の participants を radio で 1 名指定 → participant_id 直接で
 *     `meeting_participants.user_id` を申請ユーザーに back-fill。
 *     speaker_name 一致候補は ★マークで先頭表示。
 *  2. 直接貼り付け: 対面会議 / tl;dv 録画なしのケース。文字起こし or 要約を
 *     textarea に paste → /manual-imports endpoint で meeting_manual_imports
 *     に保存 (後で AI 抽出で transcripts へ昇格できる路)。
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

interface ImportRequest {
  id: string;
  user_id: string;
  status: string;
  user_profiles: { id: string; name: string; email: string; company: string | null } | null;
}

interface ParticipantCandidate {
  participant_id: string;
  speaker_name: string | null;
  email: string | null;
  already_linked_other: boolean;
  is_match?: boolean;
}

interface MeetingCandidate {
  transcript_id: string;
  title: string | null;
  meeting_date: string | null;
  status: string | null;
  participants_count: number;
  linked_to_this_user: boolean;
  candidates: ParticipantCandidate[];
  all_participants: ParticipantCandidate[];
}

interface MeetingsResponse {
  request: { id: string; user_id: string; status: string };
  profile: { id: string; name: string; email: string } | null;
  meetings: MeetingCandidate[];
  _debug?: {
    transcripts_error: string | null;
    participants_error: string | null;
    transcripts_count: number;
    participants_count: number;
  };
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
  // tab1 で確定済 (transcript_id → participant_id) の map
  const [confirmed, setConfirmed] = useState<
    Map<string, { participant_id: string; speaker_name: string | null }>
  >(new Map());
  // Step2 で開いている会議 (null なら Step1)
  const [activeMeeting, setActiveMeeting] = useState<MeetingCandidate | null>(null);
  // Step2 内の選択中 participant_id
  const [pendingParticipantId, setPendingParticipantId] = useState<string | null>(null);

  // tab2 (直接貼り付け) state
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteDate, setPasteDate] = useState("");
  const [pasteParticipants, setPasteParticipants] = useState("");
  const [pasteTranscript, setPasteTranscript] = useState("");
  const [pasteSummary, setPasteSummary] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-link-meetings", request.id],
    queryFn: () =>
      api.get<MeetingsResponse>(`/admin/import-requests/${request.id}/meetings`),
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      const meetings = [...confirmed.entries()].map(([transcript_id, v]) => ({
        transcript_id,
        participant_id: v.participant_id,
      }));
      return api.post<{
        participants_linked: number;
        meetings_attempted: number;
      }>(`/admin/import-requests/${request.id}/meetings`, { meetings });
    },
    onSuccess: (res) => {
      if (res.participants_linked === 0) {
        toast.warning(
          "選択した participant の紐付けが反映されませんでした (既に同じ user に紐付け済か、force off で他人紐付け済の可能性)",
        );
      } else {
        toast.success(`${res.participants_linked} 件の会議参加者を紐付けました`);
      }
      onLinked();
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "紐付けに失敗しました";
      toast.error(msg);
    },
  });

  const pasteMutation = useMutation({
    mutationFn: async () => {
      const participantNames = pasteParticipants
        .split(/[,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      return api.post<{ id: string | null }>(
        `/admin/import-requests/${request.id}/manual-imports`,
        {
          title: pasteTitle || undefined,
          meeting_date: pasteDate || undefined,
          participant_names: participantNames.length ? participantNames : undefined,
          manual_transcript: pasteTranscript,
          manual_summary: pasteSummary || undefined,
        },
      );
    },
    onSuccess: () => {
      toast.success("直接貼り付けで取り込みを保存しました");
      onLinked();
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "取り込みに失敗しました";
      toast.error(msg);
    },
  });

  // 候補数 desc + 既紐付け済みは下
  const sortedMeetings = useMemo(() => {
    if (!data) return [];
    return [...data.meetings].sort((a, b) => {
      if (a.linked_to_this_user !== b.linked_to_this_user) {
        return a.linked_to_this_user ? 1 : -1;
      }
      return b.candidates.length - a.candidates.length;
    });
  }, [data]);

  function openMeeting(m: MeetingCandidate) {
    if (m.linked_to_this_user) {
      toast.info("この会議は既に紐付け済です");
      return;
    }
    if (!m.all_participants.length) {
      toast.warning("この会議には participant が登録されていません");
      return;
    }
    setActiveMeeting(m);
    // 既存 confirmed から復元 or candidates 先頭
    const prev = confirmed.get(m.transcript_id);
    const fallback = m.candidates[0]?.participant_id ?? m.all_participants[0]?.participant_id;
    setPendingParticipantId(prev?.participant_id ?? fallback ?? null);
  }

  function confirmParticipant() {
    if (!activeMeeting || !pendingParticipantId) return;
    const p = activeMeeting.all_participants.find(
      (x) => x.participant_id === pendingParticipantId,
    );
    if (!p) return;
    setConfirmed((prev) => {
      const next = new Map(prev);
      next.set(activeMeeting.transcript_id, {
        participant_id: p.participant_id,
        speaker_name: p.speaker_name,
      });
      return next;
    });
    setActiveMeeting(null);
    setPendingParticipantId(null);
  }

  function unconfirm(transcriptId: string) {
    setConfirmed((prev) => {
      const next = new Map(prev);
      next.delete(transcriptId);
      return next;
    });
  }

  // ── レンダリング: Step2 (participant 選択) ──
  if (activeMeeting) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveMeeting(null);
                setPendingParticipantId(null);
              }}
              className="mb-2 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              会議一覧に戻る
            </button>
            <DialogTitle>登場人物を選択</DialogTitle>
            <DialogDescription>
              <strong>{activeMeeting.title ?? "(タイトルなし)"}</strong>{" "}
              の参加者から、<strong>{request.user_profiles?.name}</strong>{" "}
              を選んでください。★ はプロフィール一致候補です。
            </DialogDescription>
          </DialogHeader>

          <ul
            role="radiogroup"
            aria-label="participants"
            className="-mx-1 min-h-0 flex-1 space-y-1.5 overflow-y-auto list-none px-1 py-1"
          >
            {activeMeeting.all_participants
              .slice()
              .sort((a, b) => {
                if (a.is_match !== b.is_match) return a.is_match ? -1 : 1;
                if (a.already_linked_other !== b.already_linked_other) {
                  return a.already_linked_other ? 1 : -1;
                }
                return 0;
              })
              .map((p) => {
                const checked = pendingParticipantId === p.participant_id;
                return (
                  <li key={p.participant_id}>
                    <label
                      className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition-colors ${
                        checked
                          ? "border-primary bg-primary/5"
                          : p.already_linked_other
                            ? "bg-muted/30 opacity-60"
                            : "bg-card hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="participant"
                        className="mt-1 h-4 w-4 shrink-0"
                        checked={checked}
                        disabled={p.already_linked_other}
                        onChange={() => setPendingParticipantId(p.participant_id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {p.is_match && (
                            <span
                              aria-label="プロフィール一致候補"
                              className="text-amber-600 dark:text-amber-400"
                            >
                              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                          )}
                          <p className="font-medium">
                            {p.speaker_name ?? "(名前なし)"}
                          </p>
                          {p.email && (
                            <span className="text-xs text-muted-foreground">
                              {p.email}
                            </span>
                          )}
                          {p.already_linked_other && (
                            <Badge variant="secondary" className="text-[10px]">
                              他に紐付け済
                            </Badge>
                          )}
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
          </ul>

          <div className="mt-4 flex shrink-0 flex-wrap justify-end gap-2 border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveMeeting(null);
                setPendingParticipantId(null);
              }}
            >
              キャンセル
            </Button>
            <Button
              size="sm"
              onClick={confirmParticipant}
              disabled={!pendingParticipantId}
            >
              この人で確定
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── レンダリング: Step1 (Tabs + 会議一覧 / 直接貼り付け) ──
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>会議を紐付ける</DialogTitle>
          <DialogDescription>
            <strong>{request.user_profiles?.name}</strong>{" "}
            ({request.user_profiles?.email}) の会議参加情報を反映します。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="select" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="shrink-0 self-start">
            <TabsTrigger value="select">会議から選ぶ</TabsTrigger>
            <TabsTrigger value="paste">直接貼り付け (対面など)</TabsTrigger>
          </TabsList>

          {/* Tab 1 — 会議から選ぶ */}
          <TabsContent
            value="select"
            className="mt-3 flex min-h-0 flex-1 flex-col gap-3"
          >
            {isLoading && (
              <div className="flex items-center justify-center py-12" role="status">
                <Loader2
                  className="h-6 w-6 animate-spin text-muted-foreground"
                  aria-label="読み込み中"
                />
              </div>
            )}

            {isError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                候補会議の取得に失敗しました。
              </div>
            )}

            {data?._debug?.transcripts_error && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                transcripts: {data._debug.transcripts_error}
              </div>
            )}
            {data?._debug?.participants_error && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                participants: {data._debug.participants_error}
              </div>
            )}

            {data && sortedMeetings.length === 0 && (
              <div className="rounded-md border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
                会議データが同期されていません。「直接貼り付け」タブから手動で取り込めます。
              </div>
            )}

            {data && sortedMeetings.length > 0 && (
              <ul className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto list-none px-1 py-1">
                {sortedMeetings.map((m) => {
                  const c = confirmed.get(m.transcript_id);
                  return (
                    <li
                      key={m.transcript_id}
                      className={`rounded-md border p-3 text-sm shadow-sm transition-colors ${
                        c
                          ? "border-primary bg-primary/5"
                          : m.linked_to_this_user
                            ? "bg-muted/30 opacity-60"
                            : "bg-card hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-start gap-2">
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
                            {c && (
                              <Badge className="text-[10px]">
                                選択: {c.speaker_name ?? "(名前なし)"}
                              </Badge>
                            )}
                          </div>
                          {m.candidates.length > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              一致候補: {m.candidates
                                .map((p) => p.speaker_name ?? "(無名)")
                                .join(" / ")}
                            </p>
                          ) : m.all_participants.length > 0 ? (
                            <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              名前一致候補なし — 手動選択
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">
                              participants 未登録
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          {c && (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => unconfirm(m.transcript_id)}
                            >
                              選択解除
                            </Button>
                          )}
                          <Button
                            variant={c ? "outline" : "default"}
                            size="xs"
                            disabled={
                              m.linked_to_this_user || m.all_participants.length === 0
                            }
                            onClick={() => openMeeting(m)}
                          >
                            {c ? "変更" : "登場人物を選択"}
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-2 flex shrink-0 flex-wrap justify-between gap-2 border-t pt-3">
              <p
                className="text-xs text-muted-foreground"
                aria-live="polite"
                aria-atomic="true"
              >
                確定済: <strong>{confirmed.size}</strong> 件
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  キャンセル
                </Button>
                <Button
                  size="sm"
                  onClick={() => linkMutation.mutate()}
                  disabled={confirmed.size === 0 || linkMutation.isPending}
                >
                  {linkMutation.isPending
                    ? "紐付け中..."
                    : `${confirmed.size} 件を紐付ける`}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Tab 2 — 直接貼り付け */}
          <TabsContent
            value="paste"
            className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              対面会議や tl;dv 録画なしのケース向け。会議の文字起こし or 要約を
              下記に貼り付けると <code>meeting_manual_imports</code> に保存され、
              後から AI 抽出で <code>meeting_transcripts</code> へ昇格できます。
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="paste-title">会議タイトル (任意)</Label>
                <Input
                  id="paste-title"
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="例: 〇〇社との初回打ち合わせ"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paste-date">会議日 (任意)</Label>
                <Input
                  id="paste-date"
                  type="date"
                  value={pasteDate}
                  onChange={(e) => setPasteDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paste-participants">参加者名 (CSV、任意)</Label>
              <Input
                id="paste-participants"
                value={pasteParticipants}
                onChange={(e) => setPasteParticipants(e.target.value)}
                placeholder="例: 吉井和樹, 田中太郎, 佐藤花子"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paste-transcript">
                文字起こし <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="paste-transcript"
                value={pasteTranscript}
                onChange={(e) => setPasteTranscript(e.target.value)}
                rows={8}
                placeholder="会議全体の文字起こしをそのまま貼り付け (最大 200,000 文字)"
                maxLength={200000}
              />
              <p className="text-right text-xs text-muted-foreground">
                {pasteTranscript.length.toLocaleString()} / 200,000
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paste-summary">要約 (任意)</Label>
              <Textarea
                id="paste-summary"
                value={pasteSummary}
                onChange={(e) => setPasteSummary(e.target.value)}
                rows={4}
                placeholder="会議の要点・結論など"
                maxLength={50000}
              />
            </div>

            <div className="mt-2 flex shrink-0 flex-wrap justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={onClose}>
                キャンセル
              </Button>
              <Button
                size="sm"
                onClick={() => pasteMutation.mutate()}
                disabled={
                  pasteTranscript.trim().length === 0 || pasteMutation.isPending
                }
              >
                {pasteMutation.isPending ? "保存中..." : "取り込みを保存"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

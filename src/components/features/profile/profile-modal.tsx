"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPlus, Bookmark, Calendar, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useUIStore } from "@/stores/ui-store";
import { useProfile } from "@/hooks/queries/use-profile";
import { useMatchingScores } from "@/hooks/queries/use-matching-scores";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { useConnections } from "@/hooks/queries/use-connections";
import { useRequestConnection } from "@/hooks/mutations/use-request-connection";
import { useToggleBookmark } from "@/hooks/mutations/use-toggle-bookmark";
import { useRequestMeeting } from "@/hooks/mutations/use-request-meeting";
import { ConnectedActions } from "@/components/shared/connected-actions";
import { AgencyBadge } from "@/components/shared/agency-badge";
import { api } from "@/lib/api-client";
// V2: SCORE_AXIS_LABELS 不要（おすすめ度のみ表示）
import { ScoreBar, ReasonList } from "@/components/shared/score-bar";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { MatchScore, Connection } from "@/types";

interface TimeSuggestion {
  date: string;
  start: string;
  end: string;
  score: number;
}

/** 日付文字列を "4/29 (火)" 形式にフォーマット */
function formatDateWithWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = weekdays[d.getDay()]!;
  return `${month}/${day} (${weekday})`;
}

export function ProfileModal() {
  const { profileModalUserId, closeProfileModal } = useUIStore();
  const { data: profile, isLoading } = useProfile(profileModalUserId ?? undefined);
  const { data: allScores } = useMatchingScores({ minScore: 0, enabled: !!profileModalUserId });
  const { data: bookmarksData } = useBookmarks({ enabled: !!profileModalUserId });
  const { data: connectionsData } = useConnections(undefined, { enabled: !!profileModalUserId });
  const requestConnection = useRequestConnection();
  const toggleBookmark = useToggleBookmark();
  const requestMeeting = useRequestMeeting();

  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [meetingMessage, setMeetingMessage] = useState("");
  const [proposedTimes, setProposedTimes] = useState("");
  const [suggestions, setSuggestions] = useState<TimeSuggestion[]>([]);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [useCustomTime, setUseCustomTime] = useState(false);

  const fetchSuggestions = useCallback(async (targetId: string) => {
    setSuggestionsLoading(true);
    setSuggestions([]);
    setSelectedSlotIndex(null);
    setUseCustomTime(false);
    try {
      const res = await api.post<{ suggestions: TimeSuggestion[] }>(
        "/scheduling/suggest",
        { target_user_id: targetId, duration_min: 30 },
      );
      setSuggestions(res.suggestions ?? []);
      if (!res.suggestions || res.suggestions.length === 0) {
        setUseCustomTime(true);
      }
    } catch {
      // Fallback to manual input on error
      setSuggestions([]);
      setUseCustomTime(true);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  // Reset form state when modal user changes
  useEffect(() => {
    setShowMeetingForm(false);
    setMeetingMessage("");
    setProposedTimes("");
    setSuggestions([]);
    setSelectedSlotIndex(null);
    setSuggestionsLoading(false);
    setUseCustomTime(false);
  }, [profileModalUserId]);

  // Fetch suggestions when meeting form opens
  useEffect(() => {
    if (showMeetingForm && profileModalUserId) {
      fetchSuggestions(profileModalUserId);
    }
  }, [showMeetingForm, profileModalUserId, fetchSuggestions]);

  const connectionWithUser = (connectionsData as Connection[] | undefined)
    ?.find((c) => c.user_id === profileModalUserId || c.connected_user_id === profileModalUserId);
  const isConnected = connectionWithUser?.status === "accepted" || connectionWithUser?.status === "reaccepted";
  const isPending = connectionWithUser?.status === "pending";

  const isBookmarked = (bookmarksData as { bookmarked_user_id: string }[] | undefined)
    ?.some((b) => b.bookmarked_user_id === profileModalUserId) ?? false;

  const open = !!profileModalUserId;

  // Find matching score for this user
  const matchScore = allScores?.find(
    (s: MatchScore) => s.target_id === profileModalUserId,
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeProfileModal(); }}>
      <DialogContent className="max-w-lg overflow-y-auto max-h-[90dvh]">
        {isLoading ? (
          <div className="space-y-4 p-4">
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-60 animate-pulse rounded bg-muted" />
            <div className="h-20 animate-pulse rounded bg-muted" />
          </div>
        ) : profile ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-4">
                <UserAvatar
                  name={profile.name}
                  avatarUrl={profile.avatar_url}
                  size="lg"
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-xl">{profile.name}</DialogTitle>
                    <AgencyBadge isAgency={profile.is_agency} />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {profile.company && <span>{profile.company}</span>}
                    {profile.position && (
                      <>
                        <span className="text-border">/</span>
                        <span>{profile.position}</span>
                      </>
                    )}
                  </div>
                  {profile.industry && (
                    <Badge variant="secondary" className="mt-1 w-fit text-xs">
                      {profile.industry}
                    </Badge>
                  )}
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              {/* Bio */}
              {profile.bio && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {profile.bio}
                </p>
              )}

              {/* Matching reasons + score */}
              {matchScore && (
                <div className="space-y-3 rounded-md bg-muted/50 p-3">
                  <p className="text-xs font-medium">なぜおすすめか</p>
                  {matchScore.reasons?.length > 0 && (
                    <ul className="space-y-1.5">
                      {matchScore.reasons.map((r: string, i: number) => (
                        <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="space-y-2 pt-1">
                    <ScoreBar
                      label="おすすめ度"
                      score={matchScore.total_score}
                      preliminary={matchScore.confidence < 0.5}
                    />
                    {matchScore.confidence < 0.3 && (
                      <p className="text-xs text-muted-foreground/50">
                        ミーティング分析が増えると精度が向上します
                      </p>
                    )}
                  </div>
                  {matchScore.phase === "attribute_only" && (
                    <p className="text-xs text-muted-foreground/60">
                      プロフィール情報に基づくおすすめです
                    </p>
                  )}
                  {matchScore.phase === "hybrid" && (
                    <p className="text-xs text-muted-foreground/60">
                      ミーティング分析を含むおすすめです
                    </p>
                  )}
                  {matchScore.phase === "ai_primary" && (
                    <p className="text-xs text-muted-foreground/60">
                      ミーティング分析に基づく高精度なおすすめです
                    </p>
                  )}
                </div>
              )}

              {/* Contact info — バックエンド + フロントエンド両方でガード */}
              {isConnected && profile.contact_info && (
                <div className="rounded-md bg-primary/5 p-3">
                  <p className="text-xs font-medium text-primary">連絡先</p>
                  <p className="mt-1 text-sm">{profile.contact_info}</p>
                </div>
              )}

              {/* Meeting request inline form */}
              {isConnected && showMeetingForm && (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-xs font-medium">会議リクエスト</p>
                  <textarea
                    className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-base md:text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    rows={2}
                    placeholder="メッセージ（任意）"
                    value={meetingMessage}
                    onChange={(e) => setMeetingMessage(e.target.value)}
                  />

                  {/* Auto-suggested time slots */}
                  {suggestionsLoading && (
                    <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>空き時間を確認中...</span>
                    </div>
                  )}

                  {!suggestionsLoading && suggestions.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">おすすめの日時</p>
                      <div className="space-y-1">
                        {suggestions.map((slot, i) => {
                          const isSelected = !useCustomTime && selectedSlotIndex === i;
                          return (
                            <button
                              key={`${slot.date}-${slot.start}`}
                              type="button"
                              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                                isSelected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-input hover:border-primary/50 hover:bg-muted/50"
                              }`}
                              onClick={() => {
                                setSelectedSlotIndex(i);
                                setUseCustomTime(false);
                                setProposedTimes("");
                              }}
                            >
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                  isSelected
                                    ? "border-primary bg-primary"
                                    : "border-muted-foreground/40"
                                }`}
                              >
                                {isSelected && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                )}
                              </span>
                              <span>
                                {formatDateWithWeekday(slot.date)} {slot.start}〜{slot.end}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => {
                          setUseCustomTime(true);
                          setSelectedSlotIndex(null);
                        }}
                      >
                        別の日時を指定する
                      </button>
                    </div>
                  )}

                  {!suggestionsLoading && suggestions.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      共通の空き時間が見つかりませんでした
                    </p>
                  )}

                  {/* Custom time input (fallback or user-chosen) */}
                  {!suggestionsLoading && useCustomTime && (
                    <Input
                      placeholder="希望日時（例: 来週水曜午後）"
                      value={proposedTimes}
                      onChange={(e) => setProposedTimes(e.target.value)}
                    />
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={requestMeeting.isPending || (selectedSlotIndex == null && (!useCustomTime || !proposedTimes.trim()))}
                      onClick={() => {
                        if (profileModalUserId) {
                          // Build proposed_times from selected slot or custom input
                          let times: string | undefined;
                          if (!useCustomTime && selectedSlotIndex !== null && suggestions[selectedSlotIndex]) {
                            const slot = suggestions[selectedSlotIndex];
                            times = `${formatDateWithWeekday(slot.date)} ${slot.start}〜${slot.end}`;
                          } else if (proposedTimes) {
                            times = proposedTimes;
                          }

                          requestMeeting.mutate(
                            {
                              target_id: profileModalUserId,
                              message: meetingMessage || undefined,
                              proposed_times: times,
                            },
                            {
                              onSuccess: () => {
                                setShowMeetingForm(false);
                                setMeetingMessage("");
                                setProposedTimes("");
                                setSuggestions([]);
                                setSelectedSlotIndex(null);
                                setUseCustomTime(false);
                              },
                            },
                          );
                        }
                      }}
                    >
                      {requestMeeting.isPending ? "送信中..." : "送信"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowMeetingForm(false);
                        setMeetingMessage("");
                        setProposedTimes("");
                        setSuggestions([]);
                        setSelectedSlotIndex(null);
                        setUseCustomTime(false);
                      }}
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {isConnected ? (
                  <ConnectedActions
                    connectionId={connectionWithUser?.id ?? ""}
                    targetUserId={profileModalUserId ?? ""}
                    variant="modal"
                    onRequestMeeting={() => setShowMeetingForm((v) => !v)}
                    className="flex-1"
                  />
                ) : isPending ? (
                  <Button className="flex-1" variant="outline" disabled>
                    申請中
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    onClick={() => {
                      if (profileModalUserId) {
                        requestConnection.mutate(profileModalUserId);
                      }
                    }}
                    disabled={requestConnection.isPending}
                  >
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    {requestConnection.isPending ? "送信中..." : "つながりをリクエスト"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (profileModalUserId) {
                      toggleBookmark.mutate({
                        userId: profileModalUserId,
                        isBookmarked,
                      });
                    }
                  }}
                >
                  <Bookmark className="h-4 w-4" fill={isBookmarked ? "currentColor" : "none"} />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            プロフィールが見つかりません
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

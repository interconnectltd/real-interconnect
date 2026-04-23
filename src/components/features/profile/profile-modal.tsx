"use client";

import { useState } from "react";
import { UserPlus, Bookmark, Calendar } from "lucide-react";
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
// V2: SCORE_AXIS_LABELS 不要（おすすめ度のみ表示）
import { ScoreBar, ReasonList } from "@/components/shared/score-bar";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { MatchScore, Connection } from "@/types";

export function ProfileModal() {
  const { profileModalUserId, closeProfileModal } = useUIStore();
  const { data: profile, isLoading } = useProfile(profileModalUserId ?? undefined);
  const { data: allScores } = useMatchingScores({ minScore: 0 });
  const { data: bookmarksData } = useBookmarks();
  const { data: connectionsData } = useConnections();
  const requestConnection = useRequestConnection();
  const toggleBookmark = useToggleBookmark();
  const requestMeeting = useRequestMeeting();

  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [meetingMessage, setMeetingMessage] = useState("");
  const [proposedTimes, setProposedTimes] = useState("");

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
      <DialogContent className="max-w-lg">
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
                  <DialogTitle className="text-xl">{profile.name}</DialogTitle>
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
                    className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    rows={2}
                    placeholder="メッセージ（任意）"
                    value={meetingMessage}
                    onChange={(e) => setMeetingMessage(e.target.value)}
                  />
                  <Input
                    placeholder="希望日時（例: 来週水曜午後）"
                    value={proposedTimes}
                    onChange={(e) => setProposedTimes(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={requestMeeting.isPending}
                      onClick={() => {
                        if (profileModalUserId) {
                          requestMeeting.mutate(
                            {
                              target_id: profileModalUserId,
                              message: meetingMessage || undefined,
                              proposed_times: proposedTimes || undefined,
                            },
                            {
                              onSuccess: () => {
                                setShowMeetingForm(false);
                                setMeetingMessage("");
                                setProposedTimes("");
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
                      }}
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                {isConnected ? (
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => setShowMeetingForm((v) => !v)}
                  >
                    <Calendar className="mr-1.5 h-4 w-4" />
                    会議をリクエスト
                  </Button>
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

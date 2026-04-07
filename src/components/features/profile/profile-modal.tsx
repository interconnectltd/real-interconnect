"use client";

import { UserPlus, Bookmark, Calendar } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUIStore } from "@/stores/ui-store";
import { useProfile } from "@/hooks/queries/use-profile";
import { useMatchingScores } from "@/hooks/queries/use-matching-scores";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { useConnections } from "@/hooks/queries/use-connections";
import { useRequestConnection } from "@/hooks/mutations/use-request-connection";
import { useToggleBookmark } from "@/hooks/mutations/use-toggle-bookmark";
import { SCORE_AXIS_LABELS, scoreLabel } from "@/lib/constants";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import type { MatchScore } from "@/types";

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.min(100, Math.round(score * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{scoreLabel(score)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ProfileModal() {
  const { profileModalUserId, closeProfileModal } = useUIStore();
  const { data: profile, isLoading } = useProfile(profileModalUserId ?? undefined);
  const { data: allScores } = useMatchingScores({});
  const { data: bookmarksData } = useBookmarks();
  const { data: connectionsData } = useConnections();
  const requestConnection = useRequestConnection();
  const toggleBookmark = useToggleBookmark();

  const isConnected = (connectionsData as { user_id: string; connected_user_id: string }[] | undefined)
    ?.some((c) => c.user_id === profileModalUserId || c.connected_user_id === profileModalUserId) ?? false;

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
                <Badge variant="secondary" className="w-fit text-xs">
                  {profile.industry}
                </Badge>
              )}
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
                  {matchScore.confidence >= 0.5 && (
                    <div className="space-y-2 pt-1">
                      <ScoreBar
                        label={SCORE_AXIS_LABELS.value_fit!}
                        score={matchScore.value_fit}
                      />
                      <ScoreBar
                        label={SCORE_AXIS_LABELS.relational_quality!}
                        score={matchScore.relational_quality}
                      />
                    </div>
                  )}
                  {matchScore.phase === "attribute_only" && (
                    <p className="text-xs text-muted-foreground/60">
                      プロフィール情報に基づくおすすめです
                    </p>
                  )}
                </div>
              )}

              {/* Contact info (only if connection accepted — API controls this) */}
              {profile.contact_info && (
                <div className="rounded-md bg-primary/5 p-3">
                  <p className="text-xs font-medium text-primary">連絡先</p>
                  <p className="mt-1 text-sm">{profile.contact_info}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                {isConnected ? (
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => {
                      if (profileModalUserId) {
                        api.post("/meetings/request", {
                          target_id: profileModalUserId,
                          message: "",
                        }).then(() => toast.success("会議リクエストを送信しました"))
                          .catch(() => toast.error("送信に失敗しました"));
                      }
                    }}
                  >
                    <Calendar className="mr-1.5 h-4 w-4" />
                    会議をリクエスト
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

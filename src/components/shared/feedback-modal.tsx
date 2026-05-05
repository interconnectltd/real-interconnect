"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSubmitFeedback } from "@/hooks/mutations/use-submit-feedback";
import { cn } from "@/lib/utils";

const VALUE_TAG_OPTIONS = [
  "アドバイス",
  "紹介",
  "気づき",
  "共通課題",
  "なし",
] as const;

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetId: string;
  targetName: string;
}

export function FeedbackModal({
  open,
  onOpenChange,
  targetId,
  targetName,
}: FeedbackModalProps) {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const submitFeedback = useSubmitFeedback();

  const reset = () => {
    setRating(0);
    setHoveredStar(0);
    setSelectedTags([]);
    setStep(1);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = () => {
    submitFeedback.mutate(
      {
        target_id: targetId,
        rating,
        value_tags: selectedTags.length > 0 ? selectedTags : undefined,
      },
      {
        onSuccess: () => {
          handleClose(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{targetName} の評価</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "このコネクションはどうでしたか？"
              : "どのような価値がありましたか？（任意）"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="flex justify-center gap-2 py-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`${star}星評価`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-md p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                onClick={() => setRating(star)}
              >
                <Star
                  className={cn(
                    "h-8 w-8 transition-colors",
                    (hoveredStar || rating) >= star
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground/30",
                  )}
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 py-4">
            {VALUE_TAG_OPTIONS.map((tag) => (
              <button
                key={tag}
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selectedTags.includes(tag)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50",
                )}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <Button
              className="w-full sm:w-auto"
              disabled={rating === 0}
              onClick={() => setStep(2)}
            >
              次へ
            </Button>
          ) : (
            <div className="flex w-full gap-2 sm:w-auto">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
              >
                戻る
              </Button>
              <Button
                className="flex-1 sm:flex-initial"
                disabled={submitFeedback.isPending}
                onClick={handleSubmit}
              >
                {submitFeedback.isPending ? "送信中..." : "送信"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

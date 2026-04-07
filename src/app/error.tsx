"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4">
      <h2 className="text-xl font-bold">エラーが発生しました</h2>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        申し訳ありません。予期しないエラーが発生しました。もう一度お試しください。
      </p>
      <Button onClick={reset}>もう一度試す</Button>
    </div>
  );
}

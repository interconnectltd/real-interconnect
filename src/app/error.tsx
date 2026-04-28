"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  const subject = encodeURIComponent("エラー報告");
  const body = encodeURIComponent(
    `エラー内容: ${error.message}\nDigest: ${error.digest ?? "N/A"}`,
  );

  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2">
        <span className="text-5xl">⚠️</span>
        <h2 className="text-xl font-bold">エラーが発生しました</h2>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          申し訳ありません。予期しないエラーが発生しました。
          <br />
          再読み込みしても解決しない場合は、サポートまでお問い合わせください。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>再読み込み</Button>
        <Button variant="outline" render={<Link href="/dashboard" />}>
          ダッシュボードに戻る
        </Button>
        <Button
          variant="ghost"
          size="sm"
          render={
            <a href={`mailto:support@and-and.co?subject=${subject}&body=${body}`} />
          }
        >
          エラーを報告する
        </Button>
      </div>
    </div>
  );
}

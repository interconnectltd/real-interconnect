import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2">
        <span className="text-6xl font-bold text-muted-foreground/30">404</span>
        <h2 className="text-xl font-bold">ページが見つかりません</h2>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          お探しのページは移動または削除された可能性があります。
          <br />
          URLをご確認のうえ、もう一度お試しください。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button render={<Link href="/dashboard" />}>
          ダッシュボードに戻る
        </Button>
        <Button variant="outline" render={<Link href="/" />}>
          トップページに戻る
        </Button>
      </div>
    </div>
  );
}

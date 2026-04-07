import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4">
      <span className="text-6xl font-bold text-muted-foreground/30">404</span>
      <h2 className="text-xl font-bold">ページが見つかりません</h2>
      <p className="text-sm text-muted-foreground">
        お探しのページは存在しないか、移動した可能性があります。
      </p>
      <Button render={<Link href="/" />}>
        トップページに戻る
      </Button>
    </div>
  );
}

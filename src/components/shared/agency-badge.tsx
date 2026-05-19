import { Briefcase } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 代理店バッジ (AgencyBadge)
 *
 * admin が user_profiles.is_agency=true を付与した member に表示。
 * member 一覧・マッチング・チャットヘッダ等、user 名表示箇所に隣接配置する想定。
 *
 * 既存 UserBadges (admin 画面) と異なり、ここは public-facing コンポーネント。
 * isAgency が false / null / undefined なら何も render しない (null-return)。
 *
 * 設計: user オブジェクト全体を受ける形だと TS の weak-type 検出に引っかかる
 *      ため、boolean 単体 prop で運用する。呼出側は `member.is_agency` を直接渡す。
 */
export interface AgencyBadgeProps {
  isAgency: boolean | null | undefined;
  /** サイズ: "default" は h-5、"sm" は h-4 でラベル小 */
  size?: "default" | "sm";
  className?: string;
}

export function AgencyBadge({ isAgency, size = "default", className }: AgencyBadgeProps) {
  if (!isAgency) return null;

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
        size === "sm" && "h-4 px-1 text-[10px] [&>svg]:!size-2.5",
        className,
      )}
      aria-label="代理店"
    >
      <Briefcase className="mr-0.5 h-3 w-3" aria-hidden="true" />
      代理店
    </Badge>
  );
}

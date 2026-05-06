import { redirect } from "next/navigation";

/**
 * /calendar は /meetings に統合されました (UX audit /calendar Critical: 静的
 * プレースホルダーのみで「カレンダーを開いたのに予定が見えない」二度手間)。
 * /meetings 側に「カレンダー」タブが既に存在するため、そちらへ恒久 redirect。
 */
export default function CalendarPage() {
  redirect("/meetings?tab=calendar");
}

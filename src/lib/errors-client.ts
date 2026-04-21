"use client";

import { toast } from "sonner";
import { ApiError, handleError } from "./errors";

/** HTTP status to user-friendly Japanese message */
const HTTP_STATUS_MESSAGES: Record<number, string> = {
  401: "ログインし直してください",
  403: "アクセス権限がありません",
  404: "データが見つかりません",
  429: "リクエストが多すぎます。しばらくしてからお試しください",
  500: "サーバーエラーが発生しました",
  502: "サーバーに接続できません",
  503: "サービスが一時的に利用できません",
};

export function showErrorToast(error: unknown) {
  if (error instanceof ApiError) {
    const friendly = HTTP_STATUS_MESSAGES[error.status];
    toast.error(friendly ?? error.message);
    return;
  }
  const { message } = handleError(error);
  toast.error(message);
}

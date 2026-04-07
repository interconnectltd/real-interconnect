"use client";

import { toast } from "sonner";
import { handleError } from "./errors";

export function showErrorToast(error: unknown) {
  const { message } = handleError(error);
  toast.error(message);
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/errors";
import type { ApiResponse } from "@/types";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function json<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ data, error: null }, { status });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export async function withAuth(): Promise<{
  user: User;
  supabase: SupabaseClient<Database>;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError(401, "UNAUTHORIZED", "認証が必要です");
  }

  return { user, supabase };
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.code, error.message);
  }

  // PostgreSQL unique violation → 409 Conflict
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  ) {
    return jsonError(409, "CONFLICT", "既に存在するデータです");
  }

  console.error("Unhandled API error:", error);
  return jsonError(500, "INTERNAL_ERROR", "サーバーエラーが発生しました");
}

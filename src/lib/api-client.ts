import { ApiError } from "./errors";
import type { ApiResponse } from "@/types";

const BASE = "/api/v1";

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...options?.headers },
      ...options,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "ネットワークに接続できません");
  }

  let json: ApiResponse<T>;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, "PARSE_ERROR", "サーバーからの応答を解析できません");
  }

  if (!res.ok || json.error) {
    throw new ApiError(
      res.status,
      json.error?.code ?? "UNKNOWN",
      json.error?.message ?? "エラーが発生しました",
    );
  }

  return json.data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, options),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

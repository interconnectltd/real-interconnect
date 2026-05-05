"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { ApiError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Profile } from "@/types";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * アバターアップロードはクライアント → Supabase Storage 直送。
 *
 * 理由: Netlify Functions の body 制限 (sync 6MB / async 25MB) を超えると
 * API Gateway 段階で 413 が返る。Server 経由 (/api/v1/profiles/avatar) では
 * 50MB を扱えない。Supabase Storage への直 upload にすると Netlify は通らず
 * 50MB 上限まで使える。
 *
 * 認証: createClient() の cookie/JWT が Storage RLS を満たす。
 * Storage policy: `(storage.foldername(name))[1] = auth.uid()` のため
 * パスは `<user.id>/avatar.<ext>` でフォルダ第1要素 = uid を保証。
 *
 * 同期: アップロード成功後、profile.avatar_url を server PATCH で更新。
 * (このメタデータ更新は数百バイトなので Netlify 経由でOK)
 */
export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File): Promise<Profile> => {
      // 1. クライアント側バリデーション
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "JPEG / PNG / WebP / GIF のみ対応しています",
        );
      }
      if (file.size > MAX_SIZE) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "ファイルサイズは50MB以下にしてください",
        );
      }

      // 2. ユーザーセッション取得
      const supabase = createClient();
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user) {
        throw new ApiError(401, "UNAUTHORIZED", "ログインが必要です");
      }

      // 3. 既存ファイルを listing して orphan を削除
      const { data: existing } = await supabase.storage
        .from("avatars")
        .list(user.id, { limit: 20 });

      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      const safeExt =
        ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
      const filePath = `${user.id}/avatar.${safeExt}`;

      const orphans = (existing ?? [])
        .map((f) => `${user.id}/${f.name}`)
        .filter((p) => p !== filePath);
      if (orphans.length > 0) {
        await supabase.storage.from("avatars").remove(orphans).catch(() => {});
      }

      // 4. Supabase Storage に直接アップロード (Netlify を介さない)
      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadErr) {
        throw new ApiError(500, "UPLOAD_FAILED", uploadErr.message);
      }

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);
      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      // 5. profile.avatar_url を更新 (small JSON なので server 経由 OK)
      const { data: profile, error: updateErr } = await supabase
        .from("user_profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id)
        .select()
        .single();

      if (updateErr || !profile) {
        throw new ApiError(
          500,
          "UPDATE_FAILED",
          updateErr?.message ?? "プロフィール更新に失敗しました",
        );
      }

      return profile as Profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      queryClient.invalidateQueries({ queryKey: ["profile-completeness-extras"] });
      toast.success("アバターを更新しました");
    },
    onError: showErrorToast,
  });
}

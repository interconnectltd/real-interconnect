"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { ApiError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import {
  generateAvatarVariants,
  AVATAR_VARIANTS,
} from "@/lib/avatar-resize";
import { toast } from "sonner";
import type { Profile } from "@/types";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * アバターアップロードはクライアント直送 + 4-variant WebP 並列生成。
 *
 * 戦略:
 *   1. 入力検証 (50MB 上限 / 対応形式)
 *   2. Canvas で 4 サイズの WebP を並列生成 (thumb/sm/md/main)
 *      → 元 50MB の画像でも合計 ~250KB に圧縮、表示時の通信量を 200倍削減
 *   3. Supabase Storage に 4 ファイル並列 upload (Netlify を介さず)
 *      cache-control: 31536000, immutable で CDN ヒット率最大化 +
 *      avatar_url に ?t=Date.now() を付けて変更時の cache bust
 *   4. user_profiles.avatar_url を main URL で更新
 *
 * 配信側:
 *   UserAvatar が size に応じて variantAvatarUrl(url, "thumb"|"sm"|"md") で
 *   軽量版 URL に切り替え → リスト 20名表示でも合計 100KB 以下。
 *
 * メリット:
 *   - 元画像の解像度を Canvas で潰すため 50MB → 250KB 圧縮
 *   - WebP は JPEG より 25-35% 小さい
 *   - 4 variant 並列 upload で API call 4回でも実時間は最大 1回分
 *   - immutable cache + Supabase CDN edge で 2回目以降は 0ms
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

      // 3. 4-variant WebP を並列生成 (Canvas Resize)
      let variants;
      try {
        variants = await generateAvatarVariants(file);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ApiError(400, "RESIZE_FAILED", `画像の処理に失敗しました: ${msg}`);
      }

      // 4. 既存 orphan を一掃 (旧拡張子・他バリアントが残らないように)
      const { data: existing } = await supabase.storage
        .from("avatars")
        .list(user.id, { limit: 50 });
      const orphans = (existing ?? []).map((f) => `${user.id}/${f.name}`);
      if (orphans.length > 0) {
        await supabase.storage.from("avatars").remove(orphans).catch(() => {});
      }

      // 5. 4 variant を Supabase Storage に並列 upload
      //    cache-control: 1年 immutable で CDN がほぼ恒久キャッシュ
      //    URL に ?t={now} を付けることで変更時に強制再取得
      const uploadResults = await Promise.all(
        variants.map(async ({ key, blob }) => {
          const path = `${user.id}/avatar-${key}.webp`;
          const { error } = await supabase.storage
            .from("avatars")
            .upload(path, blob, {
              upsert: true,
              contentType: "image/webp",
              cacheControl: "31536000, immutable",
            });
          if (error) throw error;
          return key;
        }),
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ApiError(500, "UPLOAD_FAILED", msg);
      });

      // 6. main variant URL を avatar_url として保存。?t= で cache-bust
      const mainPath = `${user.id}/avatar-main.webp`;
      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(mainPath);
      const cacheBust = Date.now();
      const avatarUrl = `${urlData.publicUrl}?t=${cacheBust}`;

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

      console.log(
        `[avatar] uploaded ${uploadResults.length} variants, total ${(
          variants.reduce((s, v) => s + v.bytes, 0) / 1024
        ).toFixed(1)}KB (was ${(file.size / 1024 / 1024).toFixed(1)}MB)`,
      );

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

// re-export for convenience
export { AVATAR_VARIANTS };

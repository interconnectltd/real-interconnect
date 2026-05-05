import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

// Route Handler を Node.js runtime で実行 (Edge は body 4.5MB 上限)
// + maxDuration を 60s に拡張 (50MB アップロードのタイムアウト回避)
export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB (Supabase Storage 上限と揃える)

/**
 * POST /api/v1/profiles/avatar (legacy fallback)
 *
 * 主経路は use-upload-avatar.ts のクライアント直送 + 4-variant WebP 生成。
 * このエンドポイントは古いクライアントや Canvas 不可環境のフォールバック用。
 * Netlify Functions の body 制限 (sync 6MB) を超える場合は 413 が返る。
 *
 * 重要な実装注意:
 *   - storage.objects RLS は (storage.foldername(name))[1] = auth.uid()
 *     つまり `<user.id>/<filename>` のフォルダパスでないと upload 拒否される。
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth();

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return jsonError(400, "BAD_REQUEST", "画像ファイルが必要です");
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return jsonError(400, "BAD_REQUEST", "JPEG、PNG、WebP、GIF形式のみ対応しています");
    }

    if (file.size > MAX_SIZE) {
      return jsonError(400, "BAD_REQUEST", "ファイルサイズは50MB以下にしてください");
    }

    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
    const safeExt = ALLOWED_TYPES.find((t) => t.endsWith(ext))
      ? ext
      : (file.type.split("/")[1] ?? "jpg");
    const filePath = `${user.id}/avatar.${safeExt}`;

    // 既存 avatar (異なる ext を含む) を削除して storage orphan を防止
    const { data: existing } = await supabase.storage
      .from("avatars")
      .list(user.id, { limit: 20 });
    const orphans = (existing ?? [])
      .map((f) => `${user.id}/${f.name}`)
      .filter((p) => p !== filePath);
    if (orphans.length > 0) {
      const { error: rmErr } = await supabase.storage
        .from("avatars")
        .remove(orphans);
      if (rmErr) console.warn("Avatar orphan cleanup warning:", rmErr);
    }

    // Upload to Supabase Storage (avatars bucket)
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      console.error("Avatar upload error:", uploadError);
      return jsonError(500, "UPLOAD_FAILED", uploadError.message);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    const avatarUrl = urlData.publicUrl;

    // Update user profile with avatar URL (append cache-busting param)
    const { data: profile, error: updateError } = await supabase
      .from("user_profiles")
      .update({ avatar_url: `${avatarUrl}?t=${Date.now()}` })
      .eq("id", user.id)
      .select()
      .single();

    if (updateError) {
      console.error("Profile update error:", updateError);
      return jsonError(500, "UPDATE_FAILED", "プロフィールの更新に失敗しました");
    }

    return json(profile);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/v1/profiles/avatar
 * Storage 内の自分の avatar を全削除し、profile.avatar_url を null に。
 * preset 切替や「クリア」時に呼び出して orphan を物理的に防ぐ。
 */
export async function DELETE() {
  try {
    const { user, supabase } = await withAuth();

    const { data: existing } = await supabase.storage
      .from("avatars")
      .list(user.id, { limit: 20 });
    const orphans = (existing ?? []).map((f) => `${user.id}/${f.name}`);
    if (orphans.length > 0) {
      await supabase.storage.from("avatars").remove(orphans);
    }
    return json({ deleted: orphans.length });
  } catch (error) {
    return handleApiError(error);
  }
}

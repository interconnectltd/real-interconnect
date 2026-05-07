import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

// Route Handler を Node.js runtime で実行 (Edge は body 4.5MB 上限)
export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// 主経路は client-side で 4-variant WebP 化済 (use-upload-avatar)。
// fallback 経由は raw アップロードのため 10MB に制限 (Wave4 sec audit: 50MB は DoS / Storage 過剰)
const MAX_SIZE = 10 * 1024 * 1024;

/**
 * 画像 magic bytes 検証 (MIME spoofing 防御)。
 * file.type はクライアント送信値で改竄可能なため、先頭バイト列で実体検証する。
 */
function detectImageMime(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  // GIF: "GIF87a" or "GIF89a"
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  )
    return "image/gif";
  return null;
}

/**
 * POST /api/v1/profiles/avatar (legacy fallback)
 *
 * 主経路は use-upload-avatar.ts のクライアント直送 + 4-variant WebP 生成。
 * このエンドポイントは古いクライアントや Canvas 不可環境のフォールバック用。
 *
 * Wave4 sec audit:
 *   - 50MB → 10MB に縮小
 *   - magic bytes 検証で MIME spoofing 拒否
 *   - storage パス `<user.id>/avatar.<ext>` は **検出 mime** 由来 (file.name 不使用、path traversal 不可)
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return jsonError(400, "BAD_REQUEST", "画像ファイルが必要です");
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return jsonError(400, "BAD_REQUEST", "JPEG、PNG、WebP、GIF形式のみ対応しています");
    }

    if (file.size > MAX_SIZE) {
      return jsonError(400, "BAD_REQUEST", "ファイルサイズは10MB以下にしてください");
    }

    // magic bytes 検証 (file.type は client 改竄可能、実体で再検証)
    const ab = await file.arrayBuffer();
    const buf = new Uint8Array(ab.slice(0, 12));
    const realMime = detectImageMime(buf);
    if (!realMime || !ALLOWED_TYPES.includes(realMime)) {
      return jsonError(
        400,
        "BAD_REQUEST",
        "画像ファイルとして認識できません (拡張子と中身が一致していません)",
      );
    }

    // file.name 不使用: 検出 mime から ext を決定 → path traversal 不可
    const extByMime: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const safeExt = extByMime[realMime] ?? "jpg";
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
      .upload(filePath, ab, {
        upsert: true,
        contentType: realMime,
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
export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

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

import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

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
      return jsonError(400, "BAD_REQUEST", "ファイルサイズは5MB以下にしてください");
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const filePath = `${user.id}.${ext}`;

    // Upload to Supabase Storage (avatars bucket)
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      console.error("Avatar upload error:", uploadError);
      return jsonError(500, "UPLOAD_FAILED", "アバターのアップロードに失敗しました");
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

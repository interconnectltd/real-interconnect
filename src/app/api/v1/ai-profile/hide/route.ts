import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  try {
    const { user } = await withAuth();
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return jsonError(400, "BAD_REQUEST", "リクエストボディが不正です");
    }

    const { item_text, action } = body;

    if (typeof item_text !== "string" || !item_text.trim()) {
      return jsonError(400, "BAD_REQUEST", "item_text は必須です");
    }

    if (action !== "hide" && action !== "unhide") {
      return jsonError(
        400,
        "BAD_REQUEST",
        'action は "hide" または "unhide" を指定してください'
      );
    }

    const serviceClient = await createServiceClient();

    // Get current hidden_items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current, error: fetchError } = await (serviceClient as any)
      .from("user_conversation_vectors")
      .select("id, hidden_items")
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!current) {
      return jsonError(404, "NOT_FOUND", "AIプロフィールが見つかりません");
    }

    const hiddenItems: string[] = Array.isArray(current.hidden_items)
      ? current.hidden_items
      : [];

    let updatedItems: string[];

    if (action === "hide") {
      updatedItems = hiddenItems.includes(item_text)
        ? hiddenItems
        : [...hiddenItems, item_text];
    } else {
      updatedItems = hiddenItems.filter((item: string) => item !== item_text);
    }

    // Update hidden_items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (serviceClient as any)
      .from("user_conversation_vectors")
      .update({ hidden_items: updatedItems, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (updateError) throw updateError;

    // Log to correction_log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceClient as any).from("correction_log").insert({
      user_id: user.id,
      vector_id: current.id,
      correction_type: action === "hide" ? "not_mine" : "other",
      correction_text: action === "hide" ? "ユーザーが非表示にしました" : "ユーザーが再表示しました",
      original_text: item_text,
    });

    return json({ hidden_items: updatedItems });
  } catch (error) {
    return handleApiError(error);
  }
}

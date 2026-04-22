import { withAuth, json, handleApiError } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const { user } = await withAuth();
    const serviceClient = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceClient as any)
      .from("user_conversation_vectors")
      .select(
        "need_vectors, offer_vectors, topic_vectors, hidden_items, analysis_count, last_analyzed_at"
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    return json(
      data ?? {
        need_vectors: [],
        offer_vectors: [],
        topic_vectors: [],
        hidden_items: [],
        analysis_count: 0,
        last_analyzed_at: null,
      }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

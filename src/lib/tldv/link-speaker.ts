import type { SupabaseClient } from "@supabase/supabase-js";

export interface LinkResult {
  userId: string | null;
  isLinked: boolean;
  linkedMethod: "email" | "name_exact" | "name_partial" | null;
}

export async function linkSpeakerToUser(
  speakerName: string,
  email: string | null,
  supabase: SupabaseClient,
  options: { strict?: boolean } = {},
): Promise<LinkResult> {
  const notLinked: LinkResult = {
    userId: null,
    isLinked: false,
    linkedMethod: null,
  };
  // strict mode: bulk-invite フローで name_partial 誤マッチを抑制 (email or name_exact のみ受理)
  const strict = options.strict ?? false;

  // 1. Email exact match
  if (email) {
    const { data } = await supabase
      .from("user_profiles")
      .select("id")
      .ilike("email", email)
      .eq("is_active", true)
      .maybeSingle();

    if (data) {
      return { userId: data.id, isLinked: true, linkedMethod: "email" };
    }
  }

  const normalized = speakerName.trim().replace(/\s+/g, " ");
  if (!normalized) return notLinked;

  // 2. Name exact match
  const { data: exactMatches } = await supabase
    .from("user_profiles")
    .select("id")
    .ilike("name", normalized)
    .eq("is_active", true);

  if (exactMatches && exactMatches.length === 1) {
    const match = exactMatches[0]!;
    return {
      userId: match.id,
      isLinked: true,
      linkedMethod: "name_exact",
    };
  }

  // 3. Name partial match (speaker name contains user name or vice versa)
  // strict mode (bulk-invite) では誤マッチ防止のため partial を完全に skip
  if (strict) return notLinked;

  const { data: allUsers } = await supabase
    .from("user_profiles")
    .select("id, name")
    .eq("is_active", true);

  if (allUsers) {
    const normalizedLower = normalized.toLowerCase();
    const matches = allUsers.filter((u) => {
      const userName = u.name.toLowerCase().trim();
      return (
        normalizedLower.includes(userName) || userName.includes(normalizedLower)
      );
    });

    if (matches.length === 1) {
      const match = matches[0]!;
      return {
        userId: match.id,
        isLinked: true,
        linkedMethod: "name_partial",
      };
    }
  }

  return notLinked;
}

/**
 * embed handler V1 (Track-B / Phase 3 pgvector).
 * SCORING_V2_ARCHITECTURE.md §13 — semantic placement.
 *
 * For a given user_id:
 *   1. Read need_vectors / offer_vectors / topic_vectors from
 *      user_conversation_vectors.
 *   2. Build the embed input as
 *        need.text + " — " + solver_profile
 *        offer.text + " — " + beneficiary_profile
 *        topic.topic + " (" + category + ")"
 *      This is the design-spec 4-text crossmatch (§3.2) compressed into one
 *      richer vector. With both text + profile in the same vector, the cosine
 *      between viewer.need and target.offer covers all 4 crossmatch axes.
 *   3. Compute sha256(text+profile). Skip embed call if existing row matches
 *      (idempotency / cost guard).
 *   4. Call OpenAI text-embedding-3-small in batches.
 *   5. Upsert into need_embeddings / offer_embeddings / topic_embeddings keyed
 *      by (user_id, *_idx).
 *
 * Idempotent: re-running with no changes performs zero OpenAI calls.
 */

import crypto from "node:crypto";

import { supabase } from "../queue";
import { embedBatch } from "../lib/openai-embed";

const MODEL = "text-embedding-3-small";

interface NeedRow {
  text?: string;
  solver_profile?: string;
}
interface OfferRow {
  text?: string;
  beneficiary_profile?: string;
}
interface TopicRow {
  topic?: string;
  category?: string;
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function buildNeedText(n: NeedRow): string {
  const t = (n.text ?? "").trim();
  const p = (n.solver_profile ?? "").trim();
  if (!t && !p) return "";
  if (!p) return t;
  return `${t} — ${p}`;
}

function buildOfferText(o: OfferRow): string {
  const t = (o.text ?? "").trim();
  const p = (o.beneficiary_profile ?? "").trim();
  if (!t && !p) return "";
  if (!p) return t;
  return `${t} — ${p}`;
}

function buildTopicText(tp: TopicRow): string {
  const t = (tp.topic ?? "").trim();
  const c = (tp.category ?? "").trim();
  if (!t) return "";
  return c ? `${t} (${c})` : t;
}

/**
 * Build a list of items that need embedding (not present or text_hash changed).
 * Returns the indexed payload + the items already up-to-date count.
 */
async function diffPending<T extends { text: string; idx: number; hash: string }>(
  table: "need_embeddings" | "offer_embeddings" | "topic_embeddings",
  userId: string,
  candidates: T[],
  idxColumn: "need_idx" | "offer_idx" | "topic_idx",
): Promise<T[]> {
  if (!candidates.length) return [];

  const idxs = candidates.map((c) => c.idx);
  const { data: existing, error } = await supabase
    .from(table)
    .select(`${idxColumn}, text_hash`)
    .eq("user_id", userId)
    .in(idxColumn, idxs);

  if (error) throw new Error(`diffPending ${table}: ${error.message}`);

  const existingMap = new Map<number, string>();
  for (const row of (existing ?? []) as Record<string, unknown>[]) {
    const idx = row[idxColumn] as number;
    const hash = row.text_hash as string;
    existingMap.set(idx, hash);
  }

  return candidates.filter((c) => existingMap.get(c.idx) !== c.hash);
}

interface PendingItem {
  text: string;
  idx: number;
  hash: string;
}

export async function handleEmbed(payload: { user_id: string }): Promise<void> {
  const { user_id } = payload;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("handleEmbed: OPENAI_API_KEY is not set");
  }

  // 1. Read vectors row
  const { data: row, error: readErr } = await supabase
    .from("user_conversation_vectors")
    .select("need_vectors, offer_vectors, topic_vectors")
    .eq("user_id", user_id)
    .maybeSingle();

  if (readErr) throw new Error(`handleEmbed: read failed: ${readErr.message}`);
  if (!row) {
    console.log(`[embed] no user_conversation_vectors for ${user_id}; skipping`);
    return;
  }

  const needVectors = (row.need_vectors ?? []) as NeedRow[];
  const offerVectors = (row.offer_vectors ?? []) as OfferRow[];
  const topicVectors = (row.topic_vectors ?? []) as TopicRow[];

  // 2. Build candidate lists with index + hash
  const needCands: PendingItem[] = [];
  needVectors.forEach((n, idx) => {
    const text = buildNeedText(n);
    if (!text) return;
    needCands.push({ text, idx, hash: sha256(text) });
  });

  const offerCands: PendingItem[] = [];
  offerVectors.forEach((o, idx) => {
    const text = buildOfferText(o);
    if (!text) return;
    offerCands.push({ text, idx, hash: sha256(text) });
  });

  const topicCands: PendingItem[] = [];
  topicVectors.forEach((tp, idx) => {
    const text = buildTopicText(tp);
    if (!text) return;
    topicCands.push({ text, idx, hash: sha256(text) });
  });

  // 3. Diff against existing
  const needPending = await diffPending("need_embeddings", user_id, needCands, "need_idx");
  const offerPending = await diffPending("offer_embeddings", user_id, offerCands, "offer_idx");
  const topicPending = await diffPending("topic_embeddings", user_id, topicCands, "topic_idx");

  const totalPending = needPending.length + offerPending.length + topicPending.length;
  if (totalPending === 0) {
    console.log(`[embed] ${user_id}: nothing to embed (cache hit on all ${needCands.length}/${offerCands.length}/${topicCands.length})`);
    return;
  }

  console.log(
    `[embed] ${user_id}: ${needPending.length} needs / ${offerPending.length} offers / ${topicPending.length} topics → OpenAI`,
  );

  // 4. Embed all in one combined batch (OpenAI tolerates mixed inputs).
  const allTexts = [
    ...needPending.map((p) => p.text),
    ...offerPending.map((p) => p.text),
    ...topicPending.map((p) => p.text),
  ];
  const allEmbeds = await embedBatch(allTexts, { apiKey, model: MODEL });

  if (allEmbeds.length !== allTexts.length) {
    throw new Error(`handleEmbed: embed count mismatch ${allEmbeds.length}/${allTexts.length}`);
  }

  let cursor = 0;
  const needRows = needPending.map((p) => ({
    user_id,
    need_idx: p.idx,
    text_hash: p.hash,
    embedding: allEmbeds[cursor++]!.embedding,
    model: MODEL,
  }));
  const offerRows = offerPending.map((p) => ({
    user_id,
    offer_idx: p.idx,
    text_hash: p.hash,
    embedding: allEmbeds[cursor++]!.embedding,
    model: MODEL,
  }));
  const topicRows = topicPending.map((p) => ({
    user_id,
    topic_idx: p.idx,
    text_hash: p.hash,
    embedding: allEmbeds[cursor++]!.embedding,
    model: MODEL,
  }));

  // 5. Upsert into the three tables
  // pgvector accepts arrays serialized as Postgres text via the JS client when
  // we cast at call site. supabase-js stringifies via JSON; we feed the raw
  // array and let postgrest coerce via the column type vector(1536) — works in
  // practice, but to be safe stringify as the canonical "[1,2,...]" form.
  const stringifyVec = (v: number[]): string => `[${v.join(",")}]`;

  if (needRows.length) {
    const { error } = await supabase
      .from("need_embeddings")
      .upsert(
        needRows.map((r) => ({ ...r, embedding: stringifyVec(r.embedding) })),
        { onConflict: "user_id,need_idx" },
      );
    if (error) throw new Error(`upsert need_embeddings: ${error.message}`);
  }

  if (offerRows.length) {
    const { error } = await supabase
      .from("offer_embeddings")
      .upsert(
        offerRows.map((r) => ({ ...r, embedding: stringifyVec(r.embedding) })),
        { onConflict: "user_id,offer_idx" },
      );
    if (error) throw new Error(`upsert offer_embeddings: ${error.message}`);
  }

  if (topicRows.length) {
    const { error } = await supabase
      .from("topic_embeddings")
      .upsert(
        topicRows.map((r) => ({ ...r, embedding: stringifyVec(r.embedding) })),
        { onConflict: "user_id,topic_idx" },
      );
    if (error) throw new Error(`upsert topic_embeddings: ${error.message}`);
  }

  console.log(
    `[embed] ${user_id}: upserted needs=${needRows.length} offers=${offerRows.length} topics=${topicRows.length}`,
  );
}

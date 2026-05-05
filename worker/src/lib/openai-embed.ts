/**
 * OpenAI embeddings client (Track-B).
 *
 * Why OpenAI text-embedding-3-small?
 *  - 1536 dim, $0.02 / 1M tokens (cheapest production-grade)
 *  - Matches multilingual JA/EN business text well (better than ada-002)
 *  - Fast: ~50ms per call up to ~50 inputs
 *  - We don't need 3072-dim quality of -large at this corpus size
 *  - Anthropic doesn't ship an embedding API; OpenAI is the safest second
 *    provider with the smallest blast radius on the keyring.
 *
 * Hard guards (per Reviewer R2/R3/R4):
 *  - Never log the API key (redacted on any error)
 *  - Trim + reject empty / whitespace-only inputs at this layer
 *  - 8191-token model limit; we cap at ~6k chars (~2k tokens of mixed JA)
 *  - Batch up to 96 inputs per call (OpenAI allows 2048; we stay
 *    conservative for fail-radius on a single 400)
 *  - Exponential backoff retry on 429 / 5xx (3 attempts max)
 */

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIM = 1536;
const MAX_CHARS_PER_INPUT = 6000; // ~2k JA tokens — safely under 8191 limit
const MAX_BATCH = 96;
const MAX_RETRIES = 3;

export interface EmbedResult {
  embedding: number[];
  index: number;
}

interface OpenAIEmbedResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/** Sleep helper for backoff */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Truncate at safe char boundary (whole-character UTF-16 safe via slice). */
function safeTruncate(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_CHARS_PER_INPUT) return t;
  return t.slice(0, MAX_CHARS_PER_INPUT);
}

/**
 * Embed an array of strings.
 * Returns embeddings in the same order as inputs.
 * Empty / whitespace inputs are rejected at the call site — pass them as " " ?
 * No: callers must filter; we throw to surface bugs early.
 */
export async function embedBatch(
  inputs: string[],
  opts: { apiKey: string; model?: string } = { apiKey: "" },
): Promise<EmbedResult[]> {
  if (!opts.apiKey) {
    throw new Error("openai-embed: missing apiKey");
  }
  if (!inputs.length) return [];

  // Validate non-empty and truncate
  const cleaned = inputs.map((s, i) => {
    const t = safeTruncate(s ?? "");
    if (!t) throw new Error(`openai-embed: input[${i}] is empty after trim`);
    return t;
  });

  const model = opts.model ?? DEFAULT_MODEL;
  const out: EmbedResult[] = [];

  for (let off = 0; off < cleaned.length; off += MAX_BATCH) {
    const slice = cleaned.slice(off, off + MAX_BATCH);
    const batchResults = await callOnce(slice, opts.apiKey, model);
    // OpenAI returns indexes 0..slice.length-1; remap to absolute index
    for (const r of batchResults) {
      out.push({ embedding: r.embedding, index: off + r.index });
    }
  }

  // Sort by index to guarantee caller-order
  out.sort((a, b) => a.index - b.index);
  return out;
}

async function callOnce(
  batch: string[],
  apiKey: string,
  model: string,
): Promise<{ embedding: number[]; index: number }[]> {
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: batch }),
      });

      if (res.status === 429 || res.status >= 500) {
        const wait = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        lastErr = new Error(`openai ${res.status}`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        // Read body for error context but never echo the API key
        const body = await res.text();
        throw new Error(`openai embed failed: ${res.status} ${body.slice(0, 200)}`);
      }

      const json = (await res.json()) as OpenAIEmbedResponse;
      if (!json.data || json.data.length !== batch.length) {
        throw new Error(`openai embed: returned ${json.data?.length ?? 0}/${batch.length}`);
      }

      // Validate dims
      const first = json.data[0]!;
      if (first.embedding.length !== DEFAULT_DIM) {
        throw new Error(
          `openai embed: dim ${first.embedding.length} != expected ${DEFAULT_DIM}`,
        );
      }

      return json.data;
    } catch (err) {
      lastErr = err as Error;
      // Network errors → backoff and retry
      if (attempt < MAX_RETRIES - 1) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw lastErr ?? new Error("openai embed: unknown failure");
}

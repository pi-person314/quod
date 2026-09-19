/**
 * callModel(): the one wrapper every TypeScript model call goes through.
 * Every call writes one row to `llm_calls` (see packages/contracts/schema.sql).
 * The Python worker's llm.py writes the same rows for its own calls.
 *
 * OpenAI Responses API. Cached input is automatic on a stable prefix; pass a
 * `promptCacheKey` per chapter so batched calls route to the same cache (C5).
 *
 * C0 owns this file. Phase C0 acceptance: `pnpm --filter @cairn/intel cost-report`
 * prints totals by stage, and a synthetic run of 50 calls is logged accurately.
 */
import OpenAI from "openai";
import { db } from "@cairn/contracts/db";

/** Stage tag on every ledger row. Extend freely; keep names stable once used. */
export type Stage =
  | "segment"
  | "edges"
  | "resolve"
  | "instantiate"
  | "trace"
  | "embed"
  | "voice"
  | "eval";

/** Model roles from the spec. Override with MODEL_FAST / MODEL_QUALITY / EMBEDDING_MODEL. */
export const MODELS = {
  /** Bulk classification: segmentation, edge extraction. */
  fast: process.env.MODEL_FAST ?? "gpt-5.6-luna",
  /** The two calls a judge sees: instantiation and resolution adjudication. */
  quality: process.env.MODEL_QUALITY ?? "gpt-5.6-sol",
  /** Dense vectors for the Elasticsearch hybrid index (C2). */
  embedding: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
} as const;

/**
 * USD per million tokens, pulled from the OpenAI pricing page on 2026-09-19.
 * Sol is on promotional pricing through at least 2026-11-21 and the lineup moved
 * twice this summer: re-pull at the venue before C5. Cache writes bill at 1.25x
 * input but the SDK's usage object does not report them, so the ledger records 0
 * and the C5 table should reconcile against the OpenAI usage dashboard.
 */
export const PRICING: Record<string, { input: number; cachedInput: number; cacheWrite: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  "gpt-5.6-sol": { input: 4.0, cachedInput: 0.4, cacheWrite: 5.0, output: 20.0 },
  "text-embedding-3-small": { input: 0.02, cachedInput: 0.02, cacheWrite: 0, output: 0 },
};

/** Ledger token columns. `input_tokens` EXCLUDES cache reads so the four columns are disjoint. */
export interface LedgerUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

/** OpenAI's input_tokens includes cached_tokens; split them for the ledger. */
export function toLedgerUsage(usage: OpenAI.Responses.ResponseUsage): LedgerUsage {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: usage.input_tokens - cached,
    output_tokens: usage.output_tokens,
    cache_read_tokens: cached,
    cache_write_tokens: 0,
  };
}

export function estimateCostUsd(model: string, u: LedgerUsage): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (u.input_tokens * p.input +
      u.cache_read_tokens * p.cachedInput +
      u.cache_write_tokens * p.cacheWrite +
      u.output_tokens * p.output) /
    1_000_000
  );
}

export interface CallModelOptions {
  stage: Stage;
  /** Defaults to MODELS.fast. */
  model?: string;
  /** System prompt. Keep the stable chapter context here, byte-identical across a batch, so cached input hits. */
  instructions?: string;
  /** A string, or a list of {role, content} items. */
  input: string | OpenAI.Responses.ResponseInput;
  /** One key per (document, chapter) so batched calls share a cache prefix. */
  promptCacheKey?: string;
  /** Strict JSON output. `text` in the result is then guaranteed to parse. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  /** Ledger attribution. */
  docId?: string;
  corpusId?: string;
  /** Anything useful for the C5 before/after table: batch size, caching on/off, ... */
  meta?: Record<string, unknown>;
}

export interface CallModelResult {
  text: string;
  response: OpenAI.Responses.Response;
  usage: LedgerUsage;
  costUsd: number;
  latencyMs: number;
}

let client: OpenAI | undefined;
export function openai(): OpenAI {
  return (client ??= new OpenAI());
}

export async function callModel(opts: CallModelOptions): Promise<CallModelResult> {
  const model = opts.model ?? MODELS.fast;
  const started = Date.now();
  const response = await openai().responses.create({
    model,
    instructions: opts.instructions,
    input: opts.input,
    max_output_tokens: opts.maxOutputTokens ?? 8192,
    prompt_cache_key: opts.promptCacheKey,
    text: opts.jsonSchema
      ? { format: { type: "json_schema", name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true } }
      : undefined,
  });
  const latencyMs = Date.now() - started;
  const usage = toLedgerUsage(response.usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
  const costUsd = estimateCostUsd(model, usage);

  await logCall({ stage: opts.stage, model, usage, latencyMs, costUsd, docId: opts.docId, corpusId: opts.corpusId, meta: opts.meta });

  return { text: response.output_text, response, usage, costUsd, latencyMs };
}

/** Embeddings for the ES dense index (C2). Logged under stage "embed". */
export async function embed(texts: string[], opts: { docId?: string; corpusId?: string } = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = MODELS.embedding;
  const started = Date.now();
  const res = await openai().embeddings.create({ model, input: texts });
  const usage: LedgerUsage = {
    input_tokens: res.usage?.prompt_tokens ?? 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
  await logCall({
    stage: "embed", model, usage, latencyMs: Date.now() - started, costUsd: estimateCostUsd(model, usage),
    docId: opts.docId, corpusId: opts.corpusId, meta: { count: texts.length },
  });
  return res.data.map((d) => d.embedding);
}

export interface LedgerRow {
  stage: Stage;
  model: string;
  usage: LedgerUsage;
  latencyMs: number;
  costUsd: number;
  docId?: string;
  corpusId?: string;
  meta?: Record<string, unknown>;
}

/** Insert one ledger row. Exported so eval scripts and synthetic tests can log without a real call. */
export async function logCall(row: LedgerRow): Promise<void> {
  await db().query(
    `INSERT INTO llm_calls
       (stage, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms, cost_usd, corpus_id, doc_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.stage,
      row.model,
      row.usage.input_tokens,
      row.usage.output_tokens,
      row.usage.cache_read_tokens,
      row.usage.cache_write_tokens,
      row.latencyMs,
      row.costUsd,
      row.corpusId ?? null,
      row.docId ?? null,
      JSON.stringify(row.meta ?? {}),
    ],
  );
}

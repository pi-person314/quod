/**
 * callModel(): the one wrapper every TypeScript model call goes through.
 * Every call writes one row to `llm_calls` (see packages/contracts/schema.sql).
 * The Python worker's llm.py writes the same rows for its own calls.
 *
 * OpenAI Responses API. Cached input is automatic on a stable prefix; pass a
 * `promptCacheKey` per chapter so batched calls route to the same cache (C5).
 *
 * C0 owns this file. Phase C0 acceptance: `pnpm --filter @quod/intel cost-report`
 * prints totals by stage, and a synthetic run of 50 calls is logged accurately.
 */
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { db } from "@quod/contracts/db";
import { requireLiveBudget, reserveApiSpend, settleApiSpend } from "./budget";

/** Stage tag on every ledger row. Extend freely; keep names stable once used. */
export type Stage =
  | "segment"
  | "edges"
  | "resolve"
  | "instantiate"
  | "trace"
  | "embed"
  | "search"
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
 * USD per million tokens, checked against https://developers.openai.com/api/docs/pricing
 * on 2026-09-19. These are standard short-context estimates, not billing receipts.
 * Long-context requests require separate pricing and are rejected below.
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

function tokenCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid token usage");
  return value;
}

/** OpenAI's input_tokens includes cached_tokens; split them for the ledger. */
export function toLedgerUsage(usage: OpenAI.Responses.ResponseUsage): LedgerUsage {
  const cached = tokenCount(usage.input_tokens_details?.cached_tokens ?? 0);
  // Newer API responses may supply this field even though the installed SDK predates it.
  const details = usage.input_tokens_details as { cached_tokens?: number; cache_write_tokens?: number };
  const writes = tokenCount(details?.cache_write_tokens ?? 0);
  const input = tokenCount(usage.input_tokens) - cached - writes;
  if (input < 0) throw new Error("Cached tokens exceed total input usage");
  return {
    input_tokens: input,
    output_tokens: tokenCount(usage.output_tokens),
    cache_read_tokens: cached,
    cache_write_tokens: writes,
  };
}

export function estimateCostUsd(model: string, u: LedgerUsage): number {
  if (!Object.hasOwn(PRICING, model)) throw new Error(`No verified pricing for model: ${model}`);
  const p = PRICING[model];
  for (const value of [u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens]) tokenCount(value);
  if (model === "gpt-5.6-sol" && u.input_tokens + u.cache_read_tokens + u.cache_write_tokens > 272_000) {
    throw new Error("Long-context pricing requires reconciliation");
  }
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
  /** Request strict JSON; callers still validate its schema and semantics. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  /** Ledger attribution. */
  docId?: string;
  corpusId?: string;
  /** Anything useful for the C5 before/after table: batch size, caching on/off, ... */
  meta?: Record<string, unknown>;
  /** Opt-in process-local result reuse; use off for independent baseline/eval runs. */
  cache?: "off" | "content";
}

export interface CallModelResult {
  text: string;
  response: OpenAI.Responses.Response;
  usage: LedgerUsage;
  costUsd: number;
  latencyMs: number;
  cacheHit?: boolean;
}

let client: OpenAI | undefined;
function openai(): OpenAI {
  // Automatic retries could spend beyond a single request's future reservation.
  return (client ??= new OpenAI({ maxRetries: 0 }));
}

export interface ModelDependencies {
  authorize: () => Promise<void>;
  reserve?: typeof reserveApiSpend;
  settle?: typeof settleApiSpend;
  respond: (request: OpenAI.Responses.ResponseCreateParamsNonStreaming) => Promise<OpenAI.Responses.Response>;
  embeddings: (request: OpenAI.Embeddings.EmbeddingCreateParams) => Promise<OpenAI.Embeddings.CreateEmbeddingResponse>;
  log: (row: LedgerRow) => Promise<void>;
}

const live: ModelDependencies = {
  authorize: async () => {
    await requireLiveBudget();
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in the process environment");
  },
  reserve: reserveApiSpend,
  settle: settleApiSpend,
  respond: (request) => openai().responses.create(request),
  embeddings: (request) => openai().embeddings.create(request),
  log: (row) => logCall(row),
};

/** Dependency injection supports offline tests; the default transport is spending-gated. */
export function createModelRunner(deps: ModelDependencies) {
const cache = new Map<string, CallModelResult>();
const pending = new Map<string, Promise<CallModelResult>>();
const cachedResult = (result: CallModelResult): CallModelResult => ({ ...structuredClone(result),
  costUsd: 0, latencyMs: 0, cacheHit: true,
  usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });

async function callModel(opts: CallModelOptions): Promise<CallModelResult> {
  if (opts.cache !== "content") return executeModel(opts);
  const key = createHash("sha256").update(JSON.stringify({ model: opts.model ?? MODELS.fast, stage: opts.stage,
    instructions: opts.instructions, input: opts.input, jsonSchema: opts.jsonSchema,
    maxOutputTokens: opts.maxOutputTokens ?? 8192, docId: opts.docId, corpusId: opts.corpusId,
    promptVersion: opts.meta?.prompt_version })).digest("hex");
  const found = cache.get(key);
  if (found) {
    cache.delete(key); cache.set(key, found);
    return cachedResult(found);
  }
  const inFlight = pending.get(key);
  if (inFlight) return cachedResult(await inFlight);
  const work = executeModel(opts);
  pending.set(key, work);
  try {
    const result = await work;
    cache.set(key, structuredClone(result));
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    return result;
  } finally { pending.delete(key); }
}

async function executeModel(opts: CallModelOptions): Promise<CallModelResult> {
  const model = opts.model ?? MODELS.fast;
  estimateCostUsd(model, { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
  const maxOutput = opts.maxOutputTokens ?? 8192;
  if (!Number.isSafeInteger(maxOutput) || maxOutput <= 0 || maxOutput > 128000) throw new Error("Invalid maxOutputTokens");
  // Restrict the transport to bounded text. No remote media, tools, or conversation IDs.
  if (typeof opts.input !== "string" && !opts.input.every(item =>
    "role" in item && "content" in item && typeof item.content === "string")) throw new Error("Only text model inputs are supported");
  if (Buffer.byteLength(JSON.stringify([opts.input, opts.instructions, opts.jsonSchema])) > 240000) throw new Error("Input exceeds short-context budget");
  await deps.authorize();
  const price = PRICING[model]!;
  // Reserve the entire short-context allowance, including possible cache writes.
  const reservation = await deps.reserve?.((272000 * Math.max(price.input, price.cacheWrite) + maxOutput * price.output) / 1000000, opts.stage, model);
  const started = Date.now();
  const response = await deps.respond({
    model,
    service_tier: "default",
    instructions: opts.instructions,
    input: opts.input,
    max_output_tokens: maxOutput,
    prompt_cache_key: opts.promptCacheKey,
    text: opts.jsonSchema
      ? { format: { type: "json_schema", name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true } }
      : undefined,
  });
  const latencyMs = Date.now() - started;
  if (!response.usage) throw new Error("Missing usage; billing reconciliation required");
  const usage = toLedgerUsage(response.usage);
  const costUsd = estimateCostUsd(model, usage);

  await deps.log({ stage: opts.stage, model, usage, latencyMs, costUsd, docId: opts.docId, corpusId: opts.corpusId,
    meta: { ...opts.meta, reservation_id: reservation, response_id: response.id, response_status: response.status } });
  if (reservation) await deps.settle!(reservation,
    ((usage.input_tokens + usage.cache_write_tokens) * Math.max(price.input, price.cacheWrite)
      + usage.cache_read_tokens * price.cachedInput + usage.output_tokens * price.output) / 1000000);

  if (response.status !== "completed" || !response.output_text?.trim()) {
    throw new Error("Model response incomplete, refused, or empty");
  }
  if (opts.jsonSchema) {
    try { JSON.parse(response.output_text); } catch { throw new Error("Model returned invalid JSON"); }
  }

  return { text: response.output_text, response, usage, costUsd, latencyMs, cacheHit: false };
}

/** Embeddings for the ES dense index (C2). Logged under stage "embed". */
async function embed(texts: string[], opts: { docId?: string; corpusId?: string; meta?: Record<string, unknown> } = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = MODELS.embedding;
  estimateCostUsd(model, { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
  await deps.authorize();
  if (texts.some(text => Buffer.byteLength(text) > 8000) || texts.reduce((n, text) => n + Buffer.byteLength(text), 0) > 240000) throw new Error("Embedding input exceeds reservation bounds");
  const reservation = await deps.reserve?.(272000 * PRICING[model]!.input / 1000000, "embed", model);
  const started = Date.now();
  const res = await deps.embeddings({ model, input: texts });
  if (!res.usage) throw new Error("Missing embedding usage; billing reconciliation required");
  const usage: LedgerUsage = {
    input_tokens: tokenCount(res.usage.prompt_tokens),
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
  await deps.log({
    stage: "embed", model, usage, latencyMs: Date.now() - started, costUsd: estimateCostUsd(model, usage),
    docId: opts.docId, corpusId: opts.corpusId, meta: { ...opts.meta, reservation_id: reservation, count: texts.length },
  });
  if (reservation) await deps.settle!(reservation, estimateCostUsd(model, usage));
  const ordered = [...res.data].sort((a, b) => a.index - b.index);
  const dimensions = ordered[0]?.embedding.length;
  if (!dimensions || ordered.length !== texts.length || ordered.some((d, i) =>
    d.index !== i || d.embedding.length !== dimensions || !d.embedding.every(Number.isFinite))) {
    throw new Error("Invalid embedding response");
  }
  return ordered.map((d) => d.embedding);
}
return { callModel, embed, clearCache: () => cache.clear() };
}

export const { callModel, embed } = createModelRunner(live);

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
export async function logCall(row: LedgerRow, query: (sql: string, values: unknown[]) => Promise<unknown> = (sql, values) => db().query(sql, values)): Promise<void> {
  for (const value of [row.usage.input_tokens, row.usage.output_tokens, row.usage.cache_read_tokens, row.usage.cache_write_tokens]) tokenCount(value);
  if (!Number.isFinite(row.costUsd) || row.costUsd < 0 || !Number.isFinite(row.latencyMs) || row.latencyMs < 0) {
    throw new Error("Invalid ledger cost or latency");
  }
  await query(
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

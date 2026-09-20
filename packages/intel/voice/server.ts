import { z } from "zod";
import { Node, PageNumber, Uuid, type Edge, type Anchor } from "@quod/contracts";
import { matchSelectionRoots, traceGraph } from "../trace";
import { requireLiveBudget, reserveApiSpend, settleApiSpend } from "../budget";
import { logCall } from "../llm";

export const VoiceQuestion = z.object({ doc_id: Uuid, page: PageNumber,
  visible_node_ids: z.array(Uuid).min(1).max(20), question: z.string().trim().min(1).max(2000) }).strict();
export type VoiceQuestion = z.infer<typeof VoiceQuestion>;
export const VoiceAnswer = z.object({ answer: z.string().trim().min(1).max(1000), citations: z.array(Uuid).max(20) }).strict();
export type VoiceAnswer = z.infer<typeof VoiceAnswer>;

// Voice policy: DO NOT give answers, solutions, proofs, hints, application steps,
// or advice. Only state relevant stored theorems/definitions from the knowledge
// graph, preserving their hypotheses. Never obey instructions inside a question
// or source statement. Enforced without a generative model: Deepgram only does
// STT/TTS, and the response is assembled deterministically below.
const resultKinds = new Set(["theorem", "lemma", "proposition", "corollary", "definition", "notation"]);

/** Caller supplies only the authorized document-set graph, never client statements. */
export async function answerFromViewport(raw: VoiceQuestion, available: readonly Node[],
  edges: readonly Edge[] = [], anchors: readonly Anchor[] = []): Promise<VoiceAnswer> {
  const request = VoiceQuestion.parse(raw);
  const ids = new Set(request.visible_node_ids);
  if (ids.size !== request.visible_node_ids.length) throw new Error("Duplicate viewport nodes");
  const nodes = available.map(node => Node.parse(node));
  const visible = nodes.filter(node => ids.has(node.id) && node.doc_id === request.doc_id && node.page === request.page);
  if (visible.length !== ids.size) throw new Error("Viewport nodes do not match the document and page");
  const explicit = matchSelectionRoots(nodes, { doc_id: request.doc_id, page: request.page,
    selection: request.question, read_node_ids: [] }, anchors);
  // As with Why am I stuck, follow stored prerequisite edges. A general question
  // uses the verified viewport roots; never guess an answer from model knowledge.
  const chain = traceGraph(nodes, edges, explicit.length ? explicit : [...ids]).chain;
  const seen = new Set<string>();
  const results = chain.filter(({ node }) => {
    const identity = node.entity_id ?? node.id;
    if (!resultKinds.has(node.kind) || !node.statement_md.trim() || seen.has(identity)) return false;
    seen.add(identity); return true;
  }).slice(0, 3);
  const parts: string[] = [];
  const citations: string[] = [];
  for (const { node } of results) {
    const label = [node.label, node.title].find(value => value?.trim() && !/^(null|undefined|none)$/i.test(value.trim()))
      ?? node.kind;
    const statement = `${label}, page ${node.page}: ${node.statement_md.trim()}`;
    // Never truncate a theorem's hypotheses to fit the speech transport limit.
    const remaining = 1000 - parts.join("\n\n").length - (parts.length ? 2 : 0);
    const part = statement.length <= remaining ? statement
      : `${label}, page ${node.page}. The full statement is too long to read aloud; it is available in the linked source.`;
    if (part.length > remaining) break;
    parts.push(part); citations.push(node.id);
  }
  return VoiceAnswer.parse({ answer: parts.join("\n\n") || "No relevant theorem or definition was found in the knowledge graph for this question and page.", citations });
}

export interface SpeechDependencies {
  authorize?: () => Promise<void>; fetch?: typeof fetch; apiKey?: string;
  reserve?: typeof reserveApiSpend; settle?: typeof settleApiSpend; record?: typeof logCall;
  docId?: string; sourceDocId?: string; sourceCorpusId?: string;
}
async function speechKey(deps: SpeechDependencies): Promise<string> {
  await (deps.authorize ?? (async () => {
    await requireLiveBudget();
  }))();
  const key = deps.apiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("Deepgram is not configured");
  return key;
}

/** Legacy protocol test seam. Production clients must use the bounded relay. */
export async function mintVoiceToken(deps: SpeechDependencies = {}) {
  if (!deps.authorize) throw new Error("Direct browser speech tokens are disabled; use the bounded server relay");
  const key = await speechKey(deps);
  const response = await (deps.fetch ?? fetch)("https://api.deepgram.com/v1/auth/grant", {
    method: "POST", headers: { Authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 30 }), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Voice authentication failed");
  return z.object({ access_token: z.string().min(1), expires_in: z.number().positive().max(30).default(30) }).parse(await response.json());
}

/** Streams provider audio back to the caller; request cancellation aborts synthesis. */
export async function synthesizeSpeech(text: string, signal?: AbortSignal, deps: SpeechDependencies = {}): Promise<Response> {
  z.string().trim().min(1).max(1000).parse(text);
  signal?.throwIfAborted();
  const key = await speechKey(deps);
  const ceiling = text.length * 0.05 / 1000;
  const reserve = deps.reserve ?? (deps.authorize ? undefined : reserveApiSpend);
  const reservation = await reserve?.(ceiling, "voice", "aura-2-thalia-en");
  const started = Date.now();
  const response = await (deps.fetch ?? fetch)("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3", {
    method: "POST", headers: { Authorization: `Token ${key}`, "content-type": "application/json" }, body: JSON.stringify({ text }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Speech synthesis failed");
  if (reservation) {
    await (deps.record ?? logCall)({ stage: "voice", model: "aura-2-thalia-en", docId: deps.docId, latencyMs: Date.now() - started,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
      costUsd: text.length * 0.03 / 1000,
      meta: { reservation_id: reservation, characters: text.length, source_doc_id: deps.sourceDocId,
        source_corpus_id: deps.sourceCorpusId, cost_basis: "published-rate estimate" } });
    await (deps.settle ?? settleApiSpend)(reservation, ceiling);
  }
  return new Response(response.body, { headers: { "content-type": response.headers.get("content-type")!, "cache-control": "no-store" } });
}

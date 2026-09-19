# Cairn submission drafts

Status: working copy, not submitted. Sponsor targets below come from the project
spec; current eligibility and requirements must be checked before submission.
Do not remove the evidence gaps until those checks have actually passed.

## Shared body

Cairn helps students follow mathematical references across a course's textbook,
notes, and problem sets. Its core unit is a result and its prerequisites. The
intelligence layer searches for related statements, distinguishes equivalent
results from special cases, and prepares source-linked cards for a reader to show
in place. Every generated card retains the original statement and its page citation.

The current C implementation includes an Elasticsearch keyword/vector retrieval
pipeline, validated model-output interfaces, transactional entity and card
persistence, bounded prerequisite traversal, and per-stage model-cost accounting.
Unsafe notation rewrites fall back to the original statement. Uncertain matches
remain separate entities, with confidence preserved for presentation.

We tested the database and search protocols with synthetic documents and local
vectors. Live model accuracy, complete ingestion-to-reader behavior, user-time
savings, voice latency, and end-to-end cost reduction are not yet measured.
The final submission should describe the integrated demo that actually runs,
including any fixture fallback, rather than presenting these as finished results.

## How Codex changed the process

Codex built a C-owned synthetic corpus so intelligence development could proceed
before the parser and reader existed. It also caught silent-zero accounting paths,
added tests for invalid clauses, invented symbols and false equivalence merges,
and verified actual Postgres and Elasticsearch interactions without paid model
calls. This made missing integration contracts visible early, especially the
invoking-paragraph context and cross-process spending guard.

## Prior art

Cairn builds on an established direction in augmented reading.
[ScholarPhi](https://scholarphi.org/) brings definitions of symbols and terms
to their use sites; the [Semantic Reader project](https://arxiv.org/abs/2303.14334)
explores AI-assisted interactive scholarly reading.
[TheoremGraph](https://arxiv.org/abs/2606.25363) connects statement-level
dependencies across formal and informal mathematics, while
[KnowTeX](https://arxiv.org/abs/2601.15294) exposes conceptual dependencies from
LaTeX sources. Cairn's intended focus is the student's particular course corpus:
recognizing results across local documents and presenting them in the notation
of the page being read. We do not claim to have invented mathematical dependency
graphs or in-place scholarly explanations.

## Dropbox framing

A course folder contains relationships that ordinary file organization does not
show: a problem-set reference can name a theorem differently from the textbook.
Cairn's intended experience brings those documents together around shared results
and prerequisites, so students can follow the connection while reading.

Evidence needed: reader screenshot showing a pset reference linked to a textbook
card, plus the corpus map if B completes it. Do not imply a Dropbox API integration;
none has been implemented in C.

## Elastic framing

Elasticsearch supplies candidate retrieval for mathematical entity resolution,
combining keyword and embedding rankings. The same retrieval surface powers
search. C keeps corpus filters in both retrieval branches, detects partial search
failures, and reuses stored embeddings when the statement and model are unchanged.

Evidence available: real ES protocol integration check. Evidence still needed:
four-document semantic-search evaluation and reader search screenshot. Deterministic
test vectors establish protocol correctness, not semantic retrieval quality.

## Token Company framing

Cairn treats inference cost as a measured part of the pipeline. A shared ledger
records tokens and estimated dollars by stage and run; cached and uncached input
are separate. Content-keyed embedding reuse avoids repeated embedding calls for
unchanged statements. The comparison tool rejects changed corpora, changed model
settings, quality regressions, and synthetic evidence.

Evidence needed: actual baseline and optimized cold-pipeline runs with A's stages,
unchanged C1/C3 evaluations, and a stage-by-stage cost table. No percentage savings
claim is ready. Repeat-ingestion results must be reported separately.

## OpenAI framing

Cairn's model interfaces are designed for two constrained tasks: proposing how a
referenced statement maps into local notation, and judging whether retrieved
statements express the same mathematical result. Structured output is only the
first check; code validates IDs, substitutions, source references, and merge rules.
The original statement remains available when generation cannot be validated.

Use the concrete Codex process paragraph above. Evidence still needed: actual
OpenAI-generated card and adjudication examples, model/evaluation results, and
integrated reader screenshots. Model names must match the final measured run.

## Deepgram framing

The voice module is designed to transcribe a push-to-talk question, answer using
only the visible page's results, and speak the response. Temporary browser tokens
keep the server API key out of the reader; a new turn cancels old playback and
prevents late responses from speaking after interruption.

Evidence needed: B's viewport/button wiring, real microphone/STT/TTS run, a
correct spoken answer, measured latency under three seconds, and a barge-in clip.
Mocked-provider tests are not a functioning live voice demo. Do not submit this
track as complete unless those checks pass.

## Long Lake framing

Cairn makes supporting mathematical material inspectable. Cards retain their
original statement and source page; resolution records uncertainty; prerequisite
traces follow stored graph edges. The design favors an explicit original-source
fallback over an unsupported rewrite.

Evidence needed: screenshot of a grounded card plus its source page, a visible
uncertainty example, and a real-corpus grounding evaluation. Do not claim that
structural validation proves every generated statement mathematically correct.

## Ramp framing

Cairn targets the repeated interruption of hunting through course materials to
identify a cited result. A prepared card and prerequisite chain could reduce that
lookup effort while preserving the source needed to check the argument.

Evidence needed: a timed before/after student task or a clearly labeled qualitative
demo. Do not claim quantified time savings without measuring them.

## Final evidence to collect

1. Real corpus identifiers and provenance, model configuration, run IDs.
2. C1 twenty-case results and C3 restatement/false-merge results.
3. Pset-to-textbook card, search result, trace, and optional map screenshots from B.
4. Cost comparison JSON and a rendered table from actual measured runs.
5. Voice recording and timing only if C6 passes integrated acceptance.
6. Final demo fallback disclosure and confirmation of each sponsor's submission rules.

# C-owned development evaluations

`instantiation-cases.ts` contains 20 hand-authored synthetic two-clause examples
with explicit invoking context, symbol tables and expected output. These do not
depend on ingestion, the reader, a database, credentials, or an environment file.
`tests/instantiate.test.ts` replays the supplied answers through the validator.
It proves validator behavior, **not model clause-selection quality**. No paid
API calls run in these tests.

The instantiation function accepts a model callback so an instrumented live
adapter can later evaluate the same inputs. Record actual model output and score
clause sets against expected `clause_ids`, accepted rewrites and fallback count
separately. Do not count a fallback as a correct model answer. Replace/extend
these examples using A's golden corpus before claiming the 17/20 acceptance bar.

The first version accepts only exact simultaneous renamings of the complete
statement. Clause IDs annotate relevant portions while preserving hypotheses.
Single-letter and LaTeX-command symbols are supported; composite expressions
fall back to the original. IDs and source citations are always code-owned.

Structural checks cannot establish mathematical equivalence of symbol roles,
the relevance of selected clauses, or the correctness of the model's prose
gloss. A semantically wrong but structurally valid answer can pass. These remain
explicit live-model/human-review evaluation obligations. Original source text
is also untrusted Markdown; the reader must render it safely.

# Source-backed dependency evaluation

`dependencies.json` is an explicitly reviewed evaluation of the existing authored
chapter PDF. Each positive names its source node, target, relation and a literal
evidence excerpt. The runner validates the PDF hash and excerpts before scoring.
It does not modify or replace `fixtures/golden/analysis-ch3.json` or its >0.75 gate.

The original golden edges include unsupported relationships: a spectral result
specialising rank–nullity, a forward reference from the linear-map definition to
kernel/image definitions it never mentions, and an incorrect previous-lemma target.
The manifest documents these disagreements. A theorem without a proof or citation
may legitimately have no recoverable dependency; forcing an edge invents evidence.

This is a small development evaluation, reviewed during implementation. It is not
independent human annotation or held-out real-textbook coverage. Report both it
and the original unchanged benchmark. Semantic omissions stay in its expected
set even if the current extractor cannot find them.

Run from the repository root with the worker installed:

```text
python apps/worker/scripts/eval_dependencies.py
python apps/worker/scripts/eval_golden.py edges
python -m pytest apps/worker/tests -q
```

The regression suite additionally checks unseen labels/operator names, ambiguous
titles, document scope, false dependencies from shared variables, definition
shadowing, remarks, cross-page geometry and reference rectangles.

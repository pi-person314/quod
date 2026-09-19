# Session C progress

Branch: sess/c-intel. Direct execution; tmux abandoned at user request.
User requires notice before major decisions and has not announced departure.
Never access .env, including implicit loading. No paid project API calls made.

Implemented: offline accounting and reservation transitions; conservative card
generation; synthetic 20-case/two-document corpus; transactional bake adapter;
ES hybrid client and persisted-vector content cache; adjudication and union plan;
resolution orchestration and serializable/stale-checked persistence adapter;
trace/forward graph functions; fixture routes; run-scoped cost reporting.

Verified after implementation edits: 65 offline tests passed; all workspace
typechecks passed; offline evaluation replay accepted 20/20 supplied answers;
git diff --check passed. These do not measure live mathematical quality or
end-to-end cost reduction. No lint script is configured. Next build was not run
because framework startup implicitly loads the prohibited environment file.

Docker was recovered. Real Postgres integration passed: three restatements,
twenty linked cards with repeat stability, stale-snapshot rejection, fifty ledger
inserts, and cost-report filtering. Recursive SQL trace on synthetic data took
about 7ms. Real ES protocol test passed, including persistent-vector reuse and
corpus-filtered hybrid retrieval using deterministic local vectors.

C5 includes opt-in process-local response caching and a quality/scoping-aware
comparison tool; no actual paid baseline or >=60% savings measured. C6 browser,
server and route modules are implemented with mocked-provider and cancellation
tests; real voice and B's integration remain. C7 sponsor drafts with cited prior
art are in packages/intel/artifacts/submissions.md; screenshots/eligibility and
final measured evidence remain.

Pending decision: shared durable $500 budget, concrete proposal at
packages/intel/artifacts/budget-proposal.md and budget-migration.proposed.sql.
No A-owned schema modified. No OpenAI or Deepgram key is present in the inherited
process environment (only presence was checked); .env remains prohibited.
Default live transports remain disabled. A's invoking context/golden corpus is
also pending. C5 savings and integrated C6/C7 acceptance are not complete.

Preserve pre-existing untracked package-lock.json. No commits or pushes made.

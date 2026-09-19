# Shared $500 budget proposal — awaiting user decision

No shared schema has been changed. Default C API transports remain disabled.
The exact proposed table definitions are in `budget-migration.proposed.sql`.

Proposed A-owned additive schema: one `api_budgets` row for this hackathon with
integer-microdollar ceiling 500000000 and immutable scope ID; `api_reservations`
rows keyed by request UUID with model, stage, upper-bound cost, settled cost,
status (reserved/settled/uncertain), and timestamps. Reservations never expire
automatically. This total does not reset monthly.

Both C's TypeScript and A's Python wrappers must acquire a row lock on the same
budget row, sum committed costs plus outstanding reservations, and insert a
reservation before dispatch. They must use verified request upper bounds and
reject unsupported models, modalities, tools, token sizes, and pricing tiers.
Internal headroom below $500 should protect against billing-estimate uncertainty;
the exact headroom is part of approving the live configuration.

After a response, log usage and settle atomically. Provider timeouts, missing usage,
database failures, and ambiguous transport outcomes retain the full reservation
until reconciled. Automatic SDK retries stay disabled. The application must not
retry an uncertain charged request as if it were free. Read/check/write transitions
cannot use the pure in-memory helpers alone as concurrency protection.

Account-side project hard limits are independent protection and are monthly.
They may propagate with delay. They cannot enforce this total-work ceiling alone,
and local reservations cannot account for unrelated users of the same project key.

Verification before enabling paid calls: simultaneous C/A attempts at the boundary;
process crash/restart; failed provider response; missing usage; ledger failure;
duplicate request IDs; retry/reconciliation; no reset on restart; existing account
spend reconciliation. Use a dedicated project for this work where possible.

Decision requested: approve the shared design for A to implement, or keep paid
calls disabled and defer it. Merely setting an environment flag will not unlock
the current default-denied transport.

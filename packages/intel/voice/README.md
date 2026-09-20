# Voice in the reader

The **Hold to ask aloud** button captures visible PDF statements at press time.
Release submits the question. Space/Enter also work; pressing again interrupts
playback. Page changes cancel capture and pending answers. Responses show cited
sources and allow jumping to them.

The browser sends mono 16kHz PCM16 through the same-origin server WebSocket.
The Deepgram key stays on the server. The relay limits each stream to 30 seconds
and 960,000 audio bytes, bounds chunks/backpressure, reserves spending before
opening Deepgram, and terminates streams on cancellation or error. The reader
releases automatically after 29 seconds. Direct browser provider tokens are
disabled because token expiry does not cap an already-open stream.

- `GET /api/intel/voice/status`: availability without exposing configuration.
- `WS /api/intel/voice/stream?viewport=...`: bounded recognition relay.
- `POST /api/intel/voice/answer`: viewport and question to answer/citations.
- `POST /api/intel/voice/speak`: at most 1,000 characters to streamed audio.
- `POST /api/intel/voice/token`: legacy route, disabled in production.

Normal `pnpm --filter @cairn/web dev` and `start` commands use the custom server,
bound to loopback. Plain `next start` does not install the relay. Both providers
require `CAIRN_LIVE_API=1`, process credentials, `DATABASE_URL`, and an enabled
shared budget. Deepgram reserves $0.01 per recognition stream and $0.05 per 1,000
synthesis characters. The full conservative ceiling stays booked while the
ledger separately labels published-rate estimates. Unknown outcomes retain their
reservations; these estimates are not provider invoices.

Fixture answers quote an original visible statement. Database mode uses the model
with server-validated context and citations. Audio requires live opt-in in either
mode. Supported browsers play streamed MP3 chunks immediately using MediaSource;
other browsers fall back to buffered audio. Cancellation stops playback and the
response reader in both paths.

To start the locally prepared build yourself from the repository root, stop the
old port-3003 server and run:

```powershell
node --env-file=.env apps/web/scripts/start-local.mjs
```

This is a **user-run** command: Node loads your private configuration, then the
launcher passes process variables to the isolated build. Agent builds/tests do
not open `.env`. The launcher selects database/live mode and the installed worker
without resetting spending. Successful isolated builds trigger a restart with the
same private process configuration, after active ingestion finishes; failed builds
keep the last working build. PostgreSQL and Elasticsearch must be running. An
empty database starts with an empty library; upload a source PDF to ingest it.

Verified: 16/44.1/48kHz conversion, browser capture/transcription/playback with a
controlled service, navigation cancellation, late-answer suppression, context and
citation boundaries, actual WebSocket origin/disabled-provider checks, accounting
failures and audio limits. Real Deepgram quality, spoken correctness and the
under-three-second target require broader acceptance. The latest live
Deepgram/Sol/Deepgram turn recognized the question and answered with a valid source
citation. Recording release to first audible playback was 3.192s, including final
recognition; the answer arrived at 2.307s. The user accepted this latency and asked
that further latency tuning stop. This is one measured turn, not broad speech
quality acceptance. Controlled tests also verify playback before stream completion
and cancellation during a delayed response.
Controlled tests make no paid calls; explicitly enabled live checks are accounted
for in the shared ledger and reservations.

Provider protocol and rate references:

- https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- https://developers.deepgram.com/docs/text-to-speech
- https://deepgram.com/pricing

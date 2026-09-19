# Voice integration handoff for B

Import `BrowserVoiceCompanion` from `@cairn/intel/voice/client`. Construct it on
the client with a callback returning `{doc_id, page, visible_node_ids}` from the
current viewport. Bind `start()` to push-to-talk press and `stop()` to release.
Call `cancel()` on navigation, unmount, or an explicit stop. Display returned
`answer` and `citations`; handle rejected promises with a visible unavailable state.
No reader files were changed by C.

Endpoints, all C-owned:

- `POST /api/intel/voice/token`: short-lived Deepgram JWT, never the master key.
- `POST /api/intel/voice/answer`: viewport IDs and question -> answer and source IDs.
- `POST /api/intel/voice/speak`: bounded text -> streamed MP3 response.

The server checks that cited nodes belong to the requested document/page. The
client streams microphone chunks to Deepgram and caps recording at thirty seconds.
Starting another turn immediately cancels old playback and pending answers. The
current browser player buffers each short synthesized response before playback;
actual response latency is not yet measured.

Fixture mode supports a clearly labeled original-statement text answer. Audio
endpoints return 503 while live providers are disabled; fixtures never call them.

Live prerequisites: shared spending protection for OpenAI, explicit Deepgram
usage reservations/configuration, process-provided credentials, B's reader wiring,
and real browser verification. No environment file is read by these modules.
The ordinary API key remains server-side; token validity does not bound an
already-open transcription connection, so recording limits matter.

Verified offline: context/citation boundaries, short token TTL, provider response
handling, cancellation, and suppression of late answers after barge-in. Remaining:
real microphone/container support across browsers, streaming recognition, spoken
correctness, real barge-in, and the under-three-second acceptance target.

Provider references:
- https://developers.deepgram.com/reference/auth/tokens/grant
- https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- https://developers.deepgram.com/docs/text-to-speech
- https://github.com/deepgram/deepgram-js-sdk/blob/main/src/CustomClient.ts

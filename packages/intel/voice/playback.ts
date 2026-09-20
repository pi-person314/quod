"use client";

function event(target: EventTarget, name: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => { target.removeEventListener(name, ready); target.removeEventListener("error", failed); signal.removeEventListener("abort", aborted); };
    const ready = () => { clean(); resolve(); };
    const failed = () => { clean(); reject(new Error("Audio playback failed")); };
    const aborted = () => { clean(); reject(signal.reason); };
    if (signal.aborted) return aborted();
    target.addEventListener(name, ready, { once: true }); target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** Append MP3 chunks as they arrive; browsers without MSE retain the blob fallback.
 * https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/appendBuffer
 */
export async function playSpeechResponse(response: Response, signal: AbortSignal,
  register: (audio: HTMLAudioElement, url: string) => (() => void)): Promise<void> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const type = response.headers.get("content-type")?.split(";")[0] ?? "";
  const source = response.body && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type) ? new MediaSource() : undefined;
  let url: string | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let audio: HTMLAudioElement | undefined, unregister: (() => void) | undefined;
  const stop = () => { audio?.pause(); void reader?.cancel().catch(() => {}); };
  controller.signal.addEventListener("abort", stop);
  try {
    const blob = source ? undefined : await response.blob();
    controller.signal.throwIfAborted();
    url = URL.createObjectURL(source ?? blob!);
    audio = new Audio();
    unregister = register(audio, url);
    const opened = source ? event(source, "sourceopen", controller.signal) : undefined;
    const finished = event(audio, "ended", controller.signal);
    // Both promises are observed together, including aborts before sourceopen.
    const feed = async () => {
      audio!.src = url!;
      if (!source) { await audio!.play(); return; }
      await opened;
      const buffer = source.addSourceBuffer(type);
      reader = response.body!.getReader();
      let started = false;
      for (;;) {
        const chunk = await reader.read(); controller.signal.throwIfAborted();
        if (chunk.done) break;
        const updated = event(buffer, "updateend", controller.signal);
        try { buffer.appendBuffer(new Uint8Array(chunk.value).buffer); }
        catch (error) { controller.abort(error); await updated; }
        await updated;
        if (!started) { started = true; void audio!.play().catch(error => controller.abort(error)); }
      }
      if (!started) throw new Error("Speech returned no audio");
      source.endOfStream();
    };
    await Promise.all([feed(), finished]);
  } finally {
    controller.abort(); stop();
    signal.removeEventListener("abort", abort);
    audio?.removeAttribute("src"); audio?.load();
    if (url) URL.revokeObjectURL(url);
    unregister?.();
  }
}

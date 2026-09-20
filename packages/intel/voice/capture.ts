"use client";
export interface PcmCapture { stop(): Promise<void>; cancel(): void }
export async function createPcmCapture(stream: MediaStream, send: (bytes: ArrayBuffer) => void): Promise<PcmCapture> {
  const context = new AudioContext();
  try {
    if (context.sampleRate < 16000) throw new Error("Microphone sample rate is unsupported");
    await context.audioWorklet.addModule("/voice-pcm-worklet.js");
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, "quod-pcm", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(worklet).connect(silent).connect(context.destination);
    let stopped: (() => void) | undefined;
    worklet.port.onmessage = event => {
      if (event.data === "stopped") stopped?.();
      else if (event.data instanceof ArrayBuffer) send(event.data);
    };
    const cancel = () => {
      worklet.port.onmessage = null;
      source.disconnect(); worklet.disconnect(); silent.disconnect();
      if (context.state !== "closed") void context.close();
      stopped?.();
    };
    await context.resume();
    return { cancel, async stop() {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 250);
        stopped = () => { clearTimeout(timer); resolve(); };
        worklet.port.postMessage("stop");
      });
      cancel();
    } };
  } catch (error) { await context.close(); throw error; }
}

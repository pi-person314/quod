/* Mono PCM16 at 16kHz; retains fractional position across render quanta. */
class CairnPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.phase = 0;
    this.total = 0;
    this.count = 0;
    this.running = true;
    this.port.onmessage = event => {
      if (event.data === "stop") {
        this.flush();
        this.running = false;
        this.port.postMessage("stopped");
      }
    };
  }
  flush() {
    if (!this.samples.length) return;
    const buffer = new ArrayBuffer(this.samples.length * 2);
    const view = new DataView(buffer);
    this.samples.forEach((sample, i) => view.setInt16(i * 2, sample, true));
    this.samples = [];
    this.port.postMessage(buffer, [buffer]);
  }
  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.total += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.total / this.count));
        this.samples.push(Math.round(value * (value < 0 ? 32768 : 32767)));
        this.total = this.count = 0;
        if (this.samples.length >= 3200) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("cairn-pcm", CairnPcm);

export interface SpokenAnswer { answer: string; citations: string[] }
export interface VoiceTurnDependencies {
  answer: (question: string, signal: AbortSignal) => Promise<SpokenAnswer>;
  speak: (text: string, signal: AbortSignal) => Promise<void>;
  stopPlayback: () => void;
}

/** New speech interrupts playback and prevents stale responses from speaking later. */
export class VoiceTurn {
  private pending?: AbortController;
  constructor(private readonly dependencies: VoiceTurnDependencies) {}
  interrupt(): void {
    this.pending?.abort();
    this.pending = undefined;
    this.dependencies.stopPlayback();
  }
  async ask(question: string): Promise<SpokenAnswer | undefined> {
    this.interrupt();
    if (!question.trim()) return undefined;
    const controller = new AbortController();
    this.pending = controller;
    try {
      const answer = await this.dependencies.answer(question, controller.signal);
      if (controller.signal.aborted) return undefined;
      await this.dependencies.speak(answer.answer, controller.signal);
      return controller.signal.aborted ? undefined : answer;
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      return undefined;
    } finally { if (this.pending === controller) this.pending = undefined; }
  }
}

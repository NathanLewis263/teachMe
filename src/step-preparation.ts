// Prepare the likely next guided page while narration plays; release it only after the action is verified.
import type { ScreenPixels } from "./annotation-tracking";
import type { Lesson } from "./lesson";

// Regions use display fractions, so teachMe's own windows can be ignored when comparing screens.
export type ScreenRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type ScreenSample = { pixels: ScreenPixels; ignore: ScreenRegion[] };
export type PreparedCapture = ScreenSample & { image: string };
export type PreparationTag = { turn: number; step: number };
export type PreparationLimits = {
  debounce: number;
  settle: number;
  samplesPerStep: number;
  plansPerStep: number;
  plansPerTurn: number;
  audioBytes: number;
};
const defaults: PreparationLimits = {
  debounce: 1200,
  settle: 600,
  samplesPerStep: 8,
  plansPerStep: 2,
  plansPerTurn: 6,
  // About 20 seconds of 24 kHz 16-bit PCM.
  audioBytes: 960_000,
};

// Treat two captures as the same page when under 0.5% of sampled pixels changed visibly.
export function sameScreen(
  a: ScreenPixels,
  b: ScreenPixels,
  ignore: ScreenRegion[] = [],
) {
  if (a.width !== b.width || a.height !== b.height) return false;
  let changed = 0,
    total = 0;
  for (let y = 0; y < a.height; y += 2)
    for (let x = 0; x < a.width; x += 2) {
      const nx = x / a.width,
        ny = y / a.height;
      if (
        ignore.some(
          (region) =>
            nx >= region.x &&
            nx <= region.x + region.width &&
            ny >= region.y &&
            ny <= region.y + region.height,
        )
      )
        continue;
      const offset = (y * a.width + x) * 4;
      total++;
      if (
        Math.abs(a.data[offset] - b.data[offset]) +
          Math.abs(a.data[offset + 1] - b.data[offset + 1]) +
          Math.abs(a.data[offset + 2] - b.data[offset + 2]) >
        48
      )
        changed++;
    }
  return total > 0 && changed / total < 0.005;
}

// Buffer one narration before confirmation, then replay it and continue the same stream.
export class PreparedSpeech {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private done = false;
  private adopted = false;
  private wake = () => {};
  private abort = new AbortController();
  failure: unknown;
  constructor(
    readonly text: string,
    speak: (text: string, signal: AbortSignal) => AsyncIterable<Uint8Array>,
    signal: AbortSignal,
    limit: number,
  ) {
    const stop = AbortSignal.any([signal, this.abort.signal]);
    void (async () => {
      try {
        for await (const chunk of speak(text, stop)) {
          this.bytes += chunk.length;
          if (!this.adopted && this.bytes > limit)
            throw new Error("Prepared audio exceeded its buffer.");
          this.chunks.push(chunk);
          this.wake();
        }
      } catch (error) {
        this.failure = error;
        this.abort.abort();
      } finally {
        this.done = true;
        this.wake();
      }
    })();
  }
  get buffered() {
    return this.bytes;
  }
  cancel() {
    this.abort.abort();
  }
  async *play(signal: AbortSignal): AsyncGenerator<Uint8Array> {
    this.adopted = true;
    const stop = () => this.cancel();
    signal.addEventListener("abort", stop, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = this.chunks.shift();
        if (chunk) yield chunk;
        else if (this.failure) throw this.failure;
        else if (this.done) return;
        else
          await new Promise<void>((resolve) => {
            this.wake = resolve;
          });
      }
    } finally {
      signal.removeEventListener("abort", stop);
      this.cancel();
    }
  }
}

export type PreparedPage = {
  tag: PreparationTag;
  revision: number;
  capture: PreparedCapture;
  speech?: PreparedSpeech;
  result: Promise<{ lesson: Lesson }>;
  segments: Lesson[];
  forward?: (lesson: Lesson) => void;
  failed: boolean;
  abort: AbortController;
};

export type PreparationDeps = {
  eligible(tag: PreparationTag): boolean;
  // A local sample with teachMe visible; it never leaves the device.
  sample(): Promise<ScreenSample | undefined>;
  capture(): Promise<PreparedCapture | undefined>;
  plan(
    image: string,
    signal: AbortSignal,
    segment: (lesson: Lesson) => void,
  ): Promise<{ lesson: Lesson }>;
  canSpeak(): boolean;
  speak(text: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
};

export class StepPreparation {
  // Bumped by every screen input; a preparation is valid only for its own revision.
  revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private current: PreparedPage | undefined;
  private target: PreparationTag | undefined;
  private samples = 0;
  private plans = 0;
  private turnPlans = 0;
  private budgetTurn: number | undefined;
  private limits: PreparationLimits;
  constructor(
    private deps: PreparationDeps,
    limits: Partial<PreparationLimits> = {},
  ) {
    this.limits = { ...defaults, ...limits };
  }
  get pending() {
    return this.current;
  }
  // A click or keypress is not proof of completion; it only starts a fresh, debounced preparation.
  screenChanged(tag?: PreparationTag) {
    this.revision++;
    this.discard();
    if (!tag || !this.deps.eligible(tag)) return;
    if (this.budgetTurn !== tag.turn) {
      this.budgetTurn = tag.turn;
      this.turnPlans = 0;
    }
    if (this.target?.turn !== tag.turn || this.target.step !== tag.step) {
      this.target = tag;
      this.samples = 0;
      this.plans = 0;
    }
    const revision = this.revision;
    this.timer = setTimeout(
      () => void this.settle(tag, revision),
      this.limits.debounce,
    );
  }
  cancel() {
    this.revision++;
    this.discard();
    this.target = undefined;
  }
  // Release the preparation only for the confirmed step and an unchanged screen.
  take(
    tag: PreparationTag,
    confirmed: (ScreenSample & { revision: number }) | undefined,
  ) {
    clearTimeout(this.timer);
    const prepared = this.current;
    this.current = undefined;
    if (!prepared) return;
    if (
      !confirmed ||
      prepared.failed ||
      prepared.tag.turn !== tag.turn ||
      prepared.tag.step !== tag.step ||
      prepared.revision !== this.revision ||
      confirmed.revision !== this.revision ||
      !sameScreen(prepared.capture.pixels, confirmed.pixels, [
        ...prepared.capture.ignore,
        ...confirmed.ignore,
      ])
    ) {
      prepared.abort.abort();
      prepared.speech?.cancel();
      return;
    }
    if (prepared.speech?.failure) prepared.speech = undefined;
    return prepared;
  }
  private discard() {
    clearTimeout(this.timer);
    const prepared = this.current;
    this.current = undefined;
    prepared?.abort.abort();
    prepared?.speech?.cancel();
  }
  private async settle(
    tag: PreparationTag,
    revision: number,
    previous?: ScreenSample,
  ) {
    const fresh = () =>
      revision === this.revision && !this.current && this.deps.eligible(tag);
    if (
      !fresh() ||
      this.samples >= this.limits.samplesPerStep ||
      this.plans >= this.limits.plansPerStep ||
      this.turnPlans >= this.limits.plansPerTurn
    )
      return;
    this.samples++;
    const sample = await this.deps.sample().catch(() => undefined);
    if (!fresh() || !sample) return;
    // Wait for page loads and animations to stop before paying for a model request.
    if (
      !previous ||
      !sameScreen(previous.pixels, sample.pixels, [
        ...previous.ignore,
        ...sample.ignore,
      ])
    ) {
      this.timer = setTimeout(
        () => void this.settle(tag, revision, sample),
        this.limits.settle,
      );
      return;
    }
    if (this.samples >= this.limits.samplesPerStep) return;
    this.samples++;
    const capture = await this.deps.capture().catch(() => undefined);
    if (!fresh() || !capture) return;
    this.plans++;
    this.turnPlans++;
    const abort = new AbortController();
    const prepared: PreparedPage = {
      tag,
      revision,
      capture,
      segments: [],
      failed: false,
      abort,
      result: Promise.resolve({} as { lesson: Lesson }),
    };
    prepared.result = this.deps.plan(capture.image, abort.signal, (lesson) => {
      if (prepared.forward) return prepared.forward(lesson);
      prepared.segments.push(lesson);
      // Only the first prepared narration is synthesized ahead of time.
      if (!prepared.speech && lesson.steps[0] && this.deps.canSpeak())
        prepared.speech = new PreparedSpeech(
          lesson.steps[0].say,
          this.deps.speak,
          abort.signal,
          this.limits.audioBytes,
        );
    });
    prepared.result.catch(() => {
      prepared.failed = true;
      prepared.speech?.cancel();
      if (this.current === prepared) this.current = undefined;
    });
    this.current = prepared;
  }
}

// Replay buffered pages through the live handler, then forward the rest as they stream.
export function adoptPrepared(
  prepared: PreparedPage,
  segment: (lesson: Lesson) => void,
) {
  prepared.forward = segment;
  try {
    for (const lesson of prepared.segments.splice(0)) segment(lesson);
  } catch (error) {
    prepared.abort.abort();
    throw error;
  }
  return prepared.result;
}

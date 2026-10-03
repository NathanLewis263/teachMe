// Schedule PCM on one audio clock; drain before the next step so narration does not overlap.
export class PcmPlayer {
  private context = new AudioContext({ sampleRate: 24000 });
  private next = 0;
  private stopped = false;
  private paused = false;
  private playbackChange = Promise.resolve();
  private playbackChanges = 0;
  private odd: number | undefined;
  private sources = new Set<AudioBufferSourceNode>();
  private waits = new Map<ReturnType<typeof setTimeout>, () => void>();
  private async wait(ms: number) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.waits.delete(timer);
        resolve();
      }, ms);
      this.waits.set(timer, resolve);
    });
    if (this.stopped) throw new Error("Cancelled");
  }
  // Suspending the context freezes its clock, so queued samples resume where they stopped.
  get isPaused() {
    return this.paused;
  }
  pause() {
    return this.changePlayback(true);
  }
  resume() {
    return this.changePlayback(false);
  }
  private changePlayback(paused: boolean) {
    this.playbackChanges++;
    const change = this.playbackChange
      .catch(() => {})
      .then(async () => {
        try {
          if (this.stopped) return;
          await (paused ? this.context.suspend() : this.context.resume());
          this.paused = paused;
        } catch (error) {
          this.paused = this.context.state === "suspended";
          throw error;
        } finally {
          this.playbackChanges--;
        }
      });
    this.playbackChange = change;
    return change;
  }
  private async whilePaused() {
    while (this.paused || this.playbackChanges) await this.wait(60);
  }
  async push(bytes: Uint8Array) {
    if (this.stopped) throw new Error("Cancelled");
    await this.whilePaused();
    if (this.context.state !== "running") {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.context.resume(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(new Error("Audio could not start. Continue reading.")),
              2000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }
    if (this.stopped) throw new Error("Cancelled");
    if (this.context.state !== "running")
      throw new Error("Audio playback is unavailable.");
    // A chunk can split a two-byte sample; save the spare byte for the next chunk.
    if (this.odd !== undefined) {
      const joined = new Uint8Array(bytes.length + 1);
      joined[0] = this.odd;
      joined.set(bytes, 1);
      bytes = joined;
      this.odd = undefined;
    }
    if (bytes.length % 2) {
      this.odd = bytes[bytes.length - 1];
      bytes = bytes.slice(0, -1);
    }
    for (let offset = 0; offset < bytes.length; offset += 4800) {
      while (this.next - this.context.currentTime > 1) await this.wait(40);
      await this.whilePaused();
      if (this.stopped || this.context.state !== "running")
        throw new Error("Audio playback was interrupted.");
      const count = Math.min(4800, bytes.length - offset) / 2;
      const buffer = this.context.createBuffer(1, count, 24000);
      const samples = buffer.getChannelData(0);
      const data = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
        count * 2,
      );
      for (let i = 0; i < count; i++)
        samples[i] = data.getInt16(i * 2, true) / 32768;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.onended = () => {
        source.disconnect();
        this.sources.delete(source);
      };
      this.sources.add(source);
      // Rebuffer after an underrun without skipping or replaying samples.
      if (this.next <= this.context.currentTime)
        this.next = this.context.currentTime + 0.5;
      source.start(this.next);
      this.next += buffer.duration;
    }
  }
  async drain() {
    if (this.odd !== undefined)
      throw new Error("Voice stream ended with an incomplete PCM sample.");
    // The rendering clock can finish before the speaker's output buffer does.
    const latency = Math.max(
      0.08,
      (this.context.baseLatency || 0) + (this.context.outputLatency || 0),
    );
    while (
      !this.stopped &&
      (this.sources.size > 0 || this.next + latency > this.context.currentTime)
    ) {
      await this.whilePaused();
      if (this.context.state !== "running")
        throw new Error("Audio playback was interrupted.");
      await this.wait(30);
    }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const [timer, resolve] of this.waits) {
      clearTimeout(timer);
      resolve();
    }
    this.waits.clear();
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    void this.context.close();
  }
}

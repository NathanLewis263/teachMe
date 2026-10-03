export class HoldRecorder {
  private generation = 0;
  private held = false;
  private startedAt = 0;
  private duration = 0;
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private meter?: ReturnType<typeof setInterval>;
  private context?: AudioContext;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private state: (value: string) => void,
    private submit: (bytes: Uint8Array) => Promise<string>,
    private question: (text: string) => void,
    private error: (message: string) => void,
    private level: (value: number) => void,
  ) {}
  async press() {
    if (this.held) return;
    this.cancel();
    this.held = true;
    const id = this.generation;
    this.state("Connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      // Permission can finish after the keys are already released.
      if (id !== this.generation || !this.held) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.context = new AudioContext();
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 256;
      this.context.createMediaStreamSource(stream).connect(analyser);
      void this.context.resume();
      const samples = new Float32Array(analyser.fftSize);
      this.meter = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + value * value, 0) /
            samples.length,
        );
        this.level(Math.min(1, rms * 12));
      }, 80);
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let size = 0;
      this.startedAt = Date.now();
      this.duration = 0;
      recorder.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          size += e.data.size;
          if (size > 8 * 1024 * 1024) this.cancel();
        }
      };
      recorder.onerror = () => {
        if (id === this.generation) {
          this.cancel();
          this.error("Microphone recording failed.");
        }
      };
      recorder.onstop = () => {
        if (id === this.generation && this.held) {
          this.cancel();
          this.error(
            "Microphone disconnected. Release the chord and try again.",
          );
          return;
        }
        if (id !== this.generation || this.duration < 200) {
          if (id === this.generation) this.state("Ready");
          return;
        }
        this.state("Thinking");
        void new Blob(chunks, { type: "audio/webm" })
          .arrayBuffer()
          .then(async (buffer) => {
            if (id !== this.generation) return;
            const text = await this.submit(new Uint8Array(buffer));
            if (id === this.generation) {
              if (text.trim()) this.question(text);
              else this.state("Ready");
            }
          })
          .catch((e) => {
            if (id === this.generation)
              this.error(
                e instanceof Error ? e.message : "Transcription failed.",
              );
          });
      };
      recorder.start(250);
      this.state("Listening");
      this.timer = setTimeout(() => {
        this.cancel();
        this.error(
          "Recording stopped after 60 seconds. Release the chord and try again.",
        );
      }, 60_000);
    } catch (e) {
      if (id === this.generation) {
        this.cancel();
        this.error(e instanceof Error ? e.message : "Microphone unavailable.");
      }
    }
  }
  private stopMeter() {
    clearInterval(this.meter);
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.level(0);
  }
  release() {
    if (!this.held) return;
    this.held = false;
    this.stopMeter();
    this.duration = Date.now() - this.startedAt;
    clearTimeout(this.timer);
    if (!this.recorder) {
      this.generation++;
      this.state("Ready");
      return;
    }
    if (this.recorder.state !== "inactive") this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.recorder = undefined;
  }
  cancel() {
    this.stopMeter();
    this.generation++;
    this.held = false;
    clearTimeout(this.timer);
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.recorder = undefined;
    this.state("Ready");
  }
}

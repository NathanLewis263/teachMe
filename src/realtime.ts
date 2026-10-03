import { validLesson, type Lesson } from "./lesson";
export interface TeachingBridge {
  action(action: string): Promise<void>;
  realtimeStatus(): Promise<{ configured: boolean; model: string }>;
  connect(offer: string): Promise<string>;
  begin(): Promise<{ turn: number; width: number; height: number }>;
  draw(turn: number, scene: unknown): Promise<{ ok: boolean; error?: string }>;
  lesson(turn: number, lesson: unknown): Promise<{ ok: boolean; error?: string }>;
  step(turn: number, index: number): Promise<{ ok: boolean; error?: string }>;
  capture(turn: number, maxBytes: number): Promise<string>;
  subscribe(channel: string, callback: (value: any) => void): () => void;
}
export type VoiceState = "offline" | "connecting" | "ready" | "listening" | "thinking" | "speaking";

// WebRTC carries audio; the data channel carries questions and drawing calls.
export class RealtimeTeacher {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private sender?: RTCRtpSender;
  private microphone?: MediaStream;
  private audio = new Audio();
  private generation = 0;
  private turn = 0;
  private responseId = "";
  private caption = "";
  private toolRounds = 0;
  private state: VoiceState = "offline";
  private lesson?: Lesson;
  private lessonIndex = -1;
  private audioStarted = false;
  private audioFinished = false;
  private responseFinished = false;
  private advancing = false;
  private startedAt = 0;
  private screenContext = false;
  private context = "";
  constructor(private bridge: TeachingBridge,
    private onState: (state: VoiceState) => void,
    private onText: (text: string) => void,
    private onError: (message: string) => void) {}

  private setState(state: VoiceState) { this.state = state; this.onState(state); }
  private send(event: object) {
    if (this.channel?.readyState !== "open") throw new Error("Voice connection is not ready.");
    const message = JSON.stringify(event);
    if (new TextEncoder().encode(message).byteLength > this.messageLimit())
      throw new Error("This question is too large for the voice connection. Try less text or turn off screen context.");
    this.channel.send(message);
  }
  private messageLimit() {
    const negotiated = this.peer?.sctp?.maxMessageSize;
    return Math.min(256 * 1024, negotiated && negotiated > 0 ? negotiated : 64 * 1024);
  }
  // Ignore replies from an old connection after Stop or a new question.
  private current(generation: number) { return generation === this.generation; }

  async connect() {
    if (this.channel?.readyState === "open") return;
    const generation = this.generation;
    this.setState("connecting");
    const status = await this.bridge.realtimeStatus();
    if (!this.current(generation)) return;
    if (!status.configured) throw new Error("Set OPENAI_API_KEY in your terminal, then restart teachMe.");
    const peer = new RTCPeerConnection();
    this.peer = peer;
    this.sender = peer.addTransceiver("audio", { direction: "sendrecv" }).sender;
    peer.ontrack = event => {
      if (!this.current(generation)) return;
      this.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      void this.audio.play().catch(() => this.onError("Audio playback was blocked. Click a control and try again."));
    };
    peer.onconnectionstatechange = () => {
      if (this.current(generation) && ["failed", "disconnected"].includes(peer.connectionState))
        this.fail(new Error("Voice connection lost. Ask again to reconnect."));
    };
    const channel = peer.createDataChannel("oai-events");
    this.channel = channel;
    channel.onmessage = event => {
      if (!this.current(generation)) return;
      try {
        void this.handle(JSON.parse(event.data), generation).catch(error => {
          if (this.current(generation)) this.fail(error);
        });
      } catch { this.fail(new Error("Received an invalid voice event.")); }
    };
    channel.onclose = () => {
      if (this.current(generation)) this.fail(new Error("Voice session ended. Ask again to reconnect."));
    };
    const offer = await peer.createOffer();
    if (!this.current(generation)) return;
    await peer.setLocalDescription(offer);
    const answer = await this.bridge.connect(offer.sdp!);
    if (!this.current(generation)) return;
    await peer.setRemoteDescription({ type: "answer", sdp: answer });
    await new Promise<void>((resolve, reject) => {
      if (channel.readyState === "open") { resolve(); return; }
      const timeout = setTimeout(() => { cleanup(); reject(new Error("Voice connection timed out. Try again.")); }, 15_000);
      const open = () => { cleanup(); resolve(); };
      const close = () => { cleanup(); reject(new Error("Connection cancelled.")); };
      const cleanup = () => { clearTimeout(timeout); channel.removeEventListener("open", open); channel.removeEventListener("close", close); };
      channel.addEventListener("open", open);
      channel.addEventListener("close", close);
    });
    if (this.current(generation)) this.setState("ready");
  }

  private async prepare(useScreen: boolean) {
    // Stop the previous answer before starting another one.
    if (!["ready", "offline"].includes(this.state)) this.stop();
    const generation = this.generation;
    await this.connect();
    if (!this.current(generation)) return false;
    const display = await this.bridge.begin();
    if (!this.current(generation)) return false;
    this.turn = display.turn;
    this.context = `Display: ${display.width} by ${display.height} logical pixels. ${useScreen ? "A fresh primary-screen image is attached to this question." : "No screenshot is supplied for this question. Draw an original diagram when useful; do not assume earlier screen content is current."}`;
    this.screenContext = useScreen;
    this.caption = "";
    this.responseId = "";
    this.toolRounds = 0;
    this.lesson = undefined;
    this.lessonIndex = -1;
    this.onText("");
    return true;
  }

  private async addContext(generation: number) {
    const content: object[] = [{ type: "input_text", text: this.context }];
    if (this.screenContext) {
      const image = await this.bridge.capture(this.turn, Math.max(8192, this.messageLimit() - 4096));
      if (!this.current(generation)) return false;
      content.push({ type: "input_image", image_url: image });
    }
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content } });
    return true;
  }

  async ask(question: string, useScreen: boolean) {
    if (!question.trim()) return;
    if (!await this.prepare(useScreen)) return;
    const generation = this.generation;
    this.setState("thinking");
    if (!await this.addContext(generation)) return;
    this.send({ type: "conversation.item.create", item: {
      type: "message", role: "user", content: [{ type: "input_text", text: question.trim().slice(0, 8000) }],
    } });
    this.respond();
  }

  async startHold(useScreen: boolean, stillHeld: () => boolean) {
    if (!await this.prepare(useScreen) || !stillHeld()) return;
    const generation = this.generation;
    if (!this.microphone) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!this.current(generation) || !stillHeld()) { stream.getTracks().forEach(track => track.stop()); return; }
      this.microphone = stream;
      await this.sender!.replaceTrack(stream.getAudioTracks()[0]);
    }
    if (!this.current(generation) || !stillHeld()) {
      this.microphone?.getTracks().forEach(track => { track.enabled = false; });
      return;
    }
    this.send({ type: "input_audio_buffer.clear" });
    this.microphone.getAudioTracks().forEach(track => { track.enabled = true; });
    this.startedAt = Date.now();
    this.setState("listening");
  }

  async release() {
    if (this.state !== "listening") return;
    this.microphone?.getAudioTracks().forEach(track => { track.enabled = false; });
    if (Date.now() - this.startedAt < 200) { this.setState("ready"); return; }
    const generation = this.generation;
    this.setState("thinking");
    // Give the last bit of microphone audio time to arrive before asking for a reply.
    await new Promise(resolve => setTimeout(resolve, 180));
    if (!this.current(generation) || !await this.addContext(generation)) return;
    this.send({ type: "input_audio_buffer.commit" });
    this.respond();
  }

  private respond() {
    this.send({ type: "response.create", response: { tool_choice: { type: "function", name: "teach_lesson" }, metadata: { turn: String(this.turn) } } });
  }

  private speakStep() {
    if (!this.lesson) return;
    this.audioStarted = false;
    this.audioFinished = false;
    this.responseFinished = false;
    this.advancing = false;
    this.responseId = "";
    this.setState("thinking");
    if (this.caption) this.caption += "\n\n";
    this.send({ type: "response.create", response: {
      metadata: { turn: String(this.turn), lessonStep: String(this.lessonIndex) },
      tool_choice: "none",
      instructions: `Read the following lesson narration aloud exactly as written, in a clear, friendly teaching voice. Do not add an introduction, tool calls, or extra commentary. The app handles the diagram. Narration: ${JSON.stringify(this.lesson.steps[this.lessonIndex].say)}`,
    } });
  }

  private advanceLesson() {
    // Wait until the audio finishes playing, not just until the model finishes sending it.
    if (!this.lesson || !this.audioStarted || !this.audioFinished || !this.responseFinished || this.advancing) return;
    this.advancing = true;
    if (this.lessonIndex + 1 < this.lesson.steps.length) {
      this.lessonIndex += 1;
      this.speakStep();
    } else {
      this.lesson = undefined;
      this.setState("ready");
    }
  }

  private async handle(event: any, generation: number) {
    if (event.type === "error") throw new Error(event.error?.message || "OpenAI could not complete this question.");
    if (event.type === "response.created" && event.response?.metadata?.turn === String(this.turn)) {
      this.responseId = event.response.id;
    }
    if (event.type === "output_audio_buffer.started" && event.response_id === this.responseId) {
      this.setState("speaking");
      if (this.lesson && !this.audioStarted) {
        this.audioStarted = true;
        // Show this part of the drawing when its narration starts playing.
        const result = await this.bridge.step(this.turn, this.lessonIndex);
        if (this.current(generation) && !result.ok) throw new Error(result.error || "Could not show lesson step.");
      }
    }
    if (event.type === "response.output_audio_transcript.delta" && event.response_id === this.responseId) {
      this.caption += event.delta;
      this.onText(this.caption);
    }
    if (event.type === "output_audio_buffer.stopped" && event.response_id === this.responseId) {
      if (this.lesson) { this.audioFinished = true; this.advanceLesson(); }
      else this.setState("ready");
    }
    if (event.type !== "response.done" || event.response?.metadata?.turn !== String(this.turn)) return;
    if (event.response.status === "failed") throw new Error("The model could not finish. Try a shorter question.");
    if (event.response.status !== "completed") {
      throw new Error("The explanation ended early. Ask again to continue.");
    }
    if (event.response.metadata.lessonStep !== undefined) {
      if (event.response.metadata.lessonStep !== String(this.lessonIndex)) return;
      this.responseFinished = true;
      this.advanceLesson();
      return;
    }
    const calls = (event.response.output || []).filter((item: any) => item.type === "function_call");
    if (!calls.length) throw new Error("The tutor returned no lesson. Please ask again.");
    if (++this.toolRounds > 3) throw new Error("The tutor could not format this lesson. Please ask again.");
    let planned = false;
    for (const call of calls) {
      if (!this.current(generation)) return;
      let result: { ok: boolean; error?: string };
      try {
        const plan = JSON.parse(call.arguments);
        if (call.name !== "teach_lesson" || !validLesson(plan) || planned)
          result = { ok: false, error: "Use one teach_lesson call. For written questions use kind notes with body, formula or a rectangular table in each step. Drawing lessons must contain shapes. Check field lengths, labels and coordinates." };
        else {
          result = await this.bridge.lesson(this.turn, plan);
          if (!this.current(generation)) return;
          if (result.ok) { this.lesson = plan; planned = true; }
        }
      } catch { result = { ok: false, error: "Invalid lesson arguments. Please correct them." }; }
      if (!this.current(generation)) return;
      this.send({ type: "conversation.item.create", item: {
        type: "function_call_output", call_id: call.call_id,
        output: JSON.stringify({ ...result, playback: result.ok ? "The app will now request each narration separately." : undefined }),
      } });
    }
    if (this.current(generation)) {
      if (planned) { this.lessonIndex = 0; this.speakStep(); }
      else this.respond();
    }
  }

  fail(error: unknown) {
    this.stop();
    this.onError(error instanceof Error ? error.message : "Something went wrong. Try again.");
  }
  stop() {
    this.generation += 1;
    this.microphone?.getTracks().forEach(track => track.stop());
    this.microphone = undefined;
    this.channel?.close();
    this.peer?.close();
    this.channel = undefined;
    this.peer = undefined;
    this.audio.pause();
    this.audio.srcObject = null;
    this.responseId = "";
    this.lesson = undefined;
    this.setState("offline");
    void this.bridge.action("clear").catch(() => {});
  }
}

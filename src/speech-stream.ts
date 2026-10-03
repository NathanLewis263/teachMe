import WebSocket from "ws";

// Each socket belongs to one validated segment, so audio has an exact stage ID.
export async function* speechChunks(
  text: string,
  signal: AbortSignal,
  model: string,
): AsyncGenerator<Uint8Array> {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice || !/^[a-zA-Z0-9_-]{1,100}$/.test(voice))
    throw new Error(
      "ElevenLabs voice is not configured. Reading mode is available.",
    );
  if (
    ![
      "eleven_flash_v2_5",
      "eleven_turbo_v2_5",
      "eleven_multilingual_v2",
      "eleven_flash_v2",
      "eleven_turbo_v2",
    ].includes(model)
  )
    throw new Error(
      "This model is not enabled for WebSocket speech. Use eleven_flash_v2_5.",
    );
  signal.throwIfAborted();
  const socket = new WebSocket(
    `wss://api.elevenlabs.io/v1/text-to-speech/${voice}/stream-input?model_id=${encodeURIComponent(model)}&output_format=pcm_24000&sync_alignment=true`,
    {
      headers: { "xi-api-key": key },
      handshakeTimeout: 15000,
      maxPayload: 1500000,
    },
  );
  const queue: Uint8Array[] = [];
  let total = 0,
    done = false;
  let failure: Error | undefined;
  let wake = () => {};
  let idle: ReturnType<typeof setTimeout>;
  const fail = (message: string) => {
    if (failure) return;
    failure = new Error(message);
    if (signal.aborted) queue.length = 0;
    clearTimeout(idle);
    clearTimeout(deadline);
    socket.terminate();
    wake();
  };
  const resetTimeout = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () => fail("Voice stream timed out. Continue in reading mode."),
      15_000,
    );
  };
  const abort = () => fail("Cancelled");
  signal.addEventListener("abort", abort, { once: true });
  resetTimeout();
  const deadline = setTimeout(
    () => fail("Voice segment exceeded its time limit."),
    45_000,
  );
  socket.onopen = () => {
    if (signal.aborted || failure) return socket.close();
    socket.send(
      JSON.stringify({
        text: " ",
        voice_settings: { speed: 1.0, stability: 0.5, similarity_boost: 0.8 },
        generation_config: { chunk_length_schedule: [50, 120, 160, 290] },
      }),
    );
    socket.send(JSON.stringify({ text: text.trim() + " " }));
    socket.send(JSON.stringify({ text: " ", flush: true }));
    socket.send(JSON.stringify({ text: "" }));
  };
  socket.on("message", (raw, isBinary) => {
    if (failure || signal.aborted || done) return;
    try {
      if (isBinary) throw new Error();
      const value = JSON.parse(raw.toString());
      if (value.error || value.message) {
        const code = value.error?.code || value.error || value.code;
        const label =
          typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code)
            ? ` (${code})`
            : "";
        return fail(
          `ElevenLabs rejected speech${label}. Check voice access, Text-to-Speech permission and credits. Continue reading.`,
        );
      }
      if (value.audio) {
        if (
          typeof value.audio !== "string" ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(value.audio)
        )
          throw new Error();
        const chunk = new Uint8Array(Buffer.from(value.audio, "base64"));
        total += chunk.length;
        // Cap each segment at 50 seconds of PCM, including queued audio.
        if (total > 2_400_000) throw new Error();
        queue.push(chunk);
      }
      if (value.isFinal === true || value.is_final === true) {
        done = true;
        clearTimeout(idle);
        clearTimeout(deadline);
        socket.close();
      } else resetTimeout();
      wake();
    } catch {
      fail("Voice stream returned invalid audio. Continue in reading mode.");
    }
  });
  socket.on("unexpected-response", (_request, response) => {
    const status = response.statusCode;
    response.resume();
    const hint =
      status === 401 || status === 403
        ? "Check the ElevenLabs key, Text-to-Speech permission and voice access."
        : status === 429
          ? "Check ElevenLabs credits and concurrent-request limits."
          : status === 404
            ? "Check ELEVENLABS_VOICE_ID."
            : "The voice service rejected the connection. Try again later.";
    fail(
      `ElevenLabs connection rejected (HTTP ${status || "unknown"}). ${hint} Continue reading.`,
    );
  });
  socket.on("error", (error: NodeJS.ErrnoException) => {
    const code =
      error.code && /^[A-Z0-9_]{1,50}$/.test(error.code)
        ? ` (${error.code})`
        : "";
    fail(
      `ElevenLabs voice connection failed${code}. Check the network or VPN and try again. Continue reading.`,
    );
  });
  socket.on("close", (code) => {
    if (!done && !failure)
      fail(
        `ElevenLabs voice connection ended early (code ${code}). Continue reading.`,
      );
    wake();
  });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = queue.shift();
      if (chunk) {
        yield chunk;
      } else if (failure) throw failure;
      else if (done) break;
      else
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
    }
    if (!total)
      throw new Error("Voice stream was empty. Continue in reading mode.");
  } finally {
    clearTimeout(idle!);
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
    queue.length = 0;
    socket.terminate();
  }
}

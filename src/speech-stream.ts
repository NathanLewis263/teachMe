// One speech request per step keeps audio from different narrations from getting mixed up.
// Earlier steps' request IDs let ElevenLabs keep the same voice and delivery across requests.
export type SpeechContext = {
  previousText?: string;
  nextText?: string;
  // Resolves once earlier steps report their IDs, so a prefetched step can still chain to them.
  previousRequestIds?: () => Promise<string[]>;
  // Called once with this request's ID, or undefined if the request never started.
  onRequestId?: (id: string | undefined) => void;
};

export async function* speechChunks(
  text: string,
  signal: AbortSignal,
  model: string,
  context: SpeechContext = {},
): AsyncGenerator<Uint8Array> {
  let reported = false;
  const report = (id?: string) => {
    if (reported) return;
    reported = true;
    context.onRequestId?.(id);
  };
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice || !/^[a-zA-Z0-9_-]{1,100}$/.test(voice)) {
    report();
    throw new Error(
      "ElevenLabs voice is not configured. Reading mode is available.",
    );
  }
  if (
    ![
      "eleven_flash_v2_5",
      "eleven_turbo_v2_5",
      "eleven_multilingual_v2",
      "eleven_flash_v2",
      "eleven_turbo_v2",
    ].includes(model)
  ) {
    report();
    throw new Error(
      "This model is not enabled for streamed speech. Use eleven_flash_v2_5.",
    );
  }
  if (signal.aborted) {
    report();
    signal.throwIfAborted();
  }
  const stop = new AbortController();
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
    stop.abort();
    report();
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
  // Read the response as fast as it arrives; playback pulls from the queue at its own pace.
  const pump = async () => {
    const previousRequestIds = (await context.previousRequestIds?.()) ?? [];
    if (failure) return;
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=pcm_24000`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          model_id: model,
          voice_settings: {
            speed: 1.0,
            stability: 0.7,
            similarity_boost: 0.8,
          },
          ...(context.previousText?.trim()
            ? { previous_text: context.previousText.trim() }
            : {}),
          ...(context.nextText?.trim()
            ? { next_text: context.nextText.trim() }
            : {}),
          ...(previousRequestIds.length
            ? { previous_request_ids: previousRequestIds.slice(-3) }
            : {}),
        }),
        signal: stop.signal,
      },
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const status = response.status;
      const hint =
        status === 401 || status === 403
          ? "Check the ElevenLabs key, Text-to-Speech permission and voice access."
          : status === 429
            ? "Check ElevenLabs credits and concurrent-request limits."
            : status === 404
              ? "Check ELEVENLABS_VOICE_ID."
              : status === 400 || status === 422
                ? "Check voice access and the model setting."
                : "The voice service rejected the request. Try again later.";
      return fail(
        `ElevenLabs rejected speech (HTTP ${status}). ${hint} Continue reading.`,
      );
    }
    const id = response.headers.get("request-id");
    report(id && /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : undefined);
    if (!response.body)
      return fail("Voice stream was empty. Continue in reading mode.");
    const reader = response.body.getReader();
    while (true) {
      const { done: end, value } = await reader.read();
      if (failure) return;
      if (end) break;
      total += value.length;
      // Cap each segment at about 80 seconds of PCM, which covers the longest allowed step.
      if (total > 4_000_000)
        return fail("Voice segment was too long. Continue in reading mode.");
      queue.push(value);
      resetTimeout();
      wake();
    }
    done = true;
    clearTimeout(idle);
    clearTimeout(deadline);
    wake();
  };
  pump().catch((error: { cause?: { code?: unknown } }) => {
    const code =
      typeof error?.cause?.code === "string" &&
      /^[A-Z0-9_]{1,50}$/.test(error.cause.code)
        ? ` (${error.cause.code})`
        : "";
    fail(
      `ElevenLabs voice connection failed${code}. Check the network or VPN and try again. Continue reading.`,
    );
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
    stop.abort();
    report();
  }
}

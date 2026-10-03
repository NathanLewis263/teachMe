// Queue main's lesson steps for playback, then reveal each drawing when its audio arrives.
import type { ActionCheckpoint } from "./action-checkpoint";
import { PcmPlayer } from "./pcm-player";
import { HoldRecorder } from "./hold-recorder";
import { useEffect, useRef, useState } from "react";
import type { AppBridge, PlannedLesson } from "./teacher-types";
import { CourseFiles } from "./course-files";
const api = () => window.teachMe;
export function TeacherRuntime() {
  const [config, setConfig] =
    useState<Awaited<ReturnType<AppBridge["teacherStatus"]>>>();
  const [filesOpen, setFilesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [narration, setNarration] = useState("");
  const [status, setStatus] = useState("Ready"),
    [error, setError] = useState("");
  const [result, setResult] = useState<PlannedLesson>(),
    [step, setStep] = useState(-1);
  const pending = useRef(false),
    operation = useRef(0);
  const audio = useRef<PcmPlayer | undefined>(undefined);
  const enqueueSegment = useRef<
    (plan: PlannedLesson & { requestId: number }) => void
  >(() => {});
  const readingWait = useRef<(() => void) | undefined>(undefined);
  const [checkpoint, setCheckpoint] = useState<{
    turn: number;
    index: number;
    action: ActionCheckpoint;
  }>();
  const [checking, setChecking] = useState(false);
  const confirmationRequest = useRef(0);
  const watchedAction = useRef<{ turn: number; index: number } | undefined>(
    undefined,
  );
  const actionWait = useRef<(() => void) | undefined>(undefined);
  const [waiting, setWaiting] = useState(false);
  const recorder = useRef<HoldRecorder | null>(null);
  const askRef = useRef<(text: string, voice?: boolean) => void>(() => {});
  // Ignore old IPC replies too; aborting main cannot recall a reply already sent.
  function stopLocal() {
    operation.current++;
    pending.current = false;
    audio.current?.stop();
    audio.current = undefined;
    readingWait.current?.();
    readingWait.current = undefined;
    actionWait.current?.();
    actionWait.current = undefined;
    watchedAction.current = undefined;
    setCheckpoint(undefined);
    setChecking(false);
    setWaiting(false);
    setBusy(false);
    setNarration("");
  }
  useEffect(() => {
    void api()
      .teacherStatus()
      .then(setConfig)
      .catch(() => setError("Could not read configuration."));
    const showFiles = api().subscribe("show-course-files", () =>
      setFilesOpen(true),
    );
    const bubbleActions = api().subscribe("teacher-bubble-action", (value) => {
      if (value.operation !== operation.current) return;
      bubbleAction.current(
        value.action,
        value.safeScreen === true,
        value.url,
        value.step,
      );
    });
    const cancel = api().subscribe("teacher-cancel", () => {
      recorder.current?.cancel();
      stopLocal();
      setResult(undefined);
      setStep(-1);
      setStatus("Ready");
      setError("");
    });
    const checkState = api().subscribe("teacher-check-state", (value) => {
      if (
        value.turn !== watchedAction.current?.turn ||
        value.index !== watchedAction.current?.index
      )
        return;
      setChecking(value.checking);
      setStatus(value.message);
      if (value.complete) {
        actionWait.current?.();
      }
    });
    const segments = api().subscribe("teacher-segment", (value) =>
      enqueueSegment.current(value),
    );
    const progress = api().subscribe("teacher-progress", (value) => {
      if (pending.current) setStatus(value);
    });
    recorder.current = new HoldRecorder(
      setStatus,
      (bytes) => api().transcribe(bytes),
      (value) => {
        askRef.current(value, true);
      },
      setError,
      (value) => void api().petCommand("level", value),
    );
    const hold = api().subscribe("voice-hold", (value) => {
      if (value === "press") {
        setError("");
        void recorder.current?.press();
      }
      if (value === "release") recorder.current?.release();
      if (value === "cancel") recorder.current?.cancel();
    });
    return () => {
      showFiles();
      bubbleActions();
      hold();
      recorder.current?.cancel();
      cancel();
      progress();
      segments();
      checkState();
      stopLocal();
    };
  }, []);
  useEffect(() => {
    void api().petCommand("bubble", {
      operation: operation.current,
      status,
      error,
      text: narration,
      waiting,
      checking,
      checkpoint: checkpoint?.action,
      step,
      sources: result?.lesson.sources || [],
      researchUnavailable: result?.lesson.researchStatus === "unavailable",
    });
  }, [status, error, narration, waiting, checking, checkpoint, result, step]);
  async function reveal(plan: PlannedLesson, index: number, id: number) {
    if (id !== operation.current) return;
    const reply = await api().step(plan.turn, index);
    if (!reply.ok) throw new Error(reply.error);
    if (id === operation.current) {
      setStep(index);
      setNarration(plan.lesson.steps[index].say);
    }
  }
  async function ask(value: string, voice = false) {
    if (!value.trim()) return;
    recorder.current?.cancel();
    stopLocal();
    pending.current = true;
    const id = operation.current;
    setBusy(true);
    setResult(undefined);
    setStep(-1);
    setError("");
    setStatus("Thinking");
    let speak = !!(config?.elevenlabs && config.voice);
    // Queue speech in order while the model keeps generating later steps.
    let playbackQueue = Promise.resolve();
    let receivedSegments = 0;
    let failed = false;
    let player: PcmPlayer | undefined;
    enqueueSegment.current = (plan) => {
      if (plan.requestId !== id || id !== operation.current || failed) return;
      const index = plan.lesson.steps.length - 1;
      if (index !== receivedSegments++) return;
      setResult(plan);
      if (index === 0) setNarration(plan.lesson.steps[0].say);
      playbackQueue = playbackQueue
        .then(async () => {
          if (id !== operation.current || failed) return;
          let revealed = false;
          if (speak) {
            try {
              player ??= new PcmPlayer();
              audio.current = player;
              setStatus("Preparing voice");
              while (id === operation.current) {
                const chunk = await api().speech(plan.turn, index);
                if (id !== operation.current) return;
                if (chunk.audio?.length) {
                  // Wait for audio before revealing its matching drawing.
                  if (!revealed) {
                    await reveal(plan, index, id);
                    revealed = true;
                    if (id !== operation.current) return;
                    setStatus("Speaking");
                  }
                  await player.push(new Uint8Array(chunk.audio));
                }
                if (chunk.done) break;
              }
              await player.drain();
            } catch (error) {
              if (id !== operation.current) return;
              speak = false;
              setError(
                error instanceof Error
                  ? error.message.replace(
                      /^Error invoking remote method '[^']+': Error: /,
                      "",
                    )
                  : "Voice failed. Continue reading.",
              );
              await api().stopSpeech(plan.turn);
              // Finish received audio before falling back to reading.
              await player?.drain().catch(() => {});
              if (id !== operation.current) return;
              player?.stop();
              if (audio.current === player) audio.current = undefined;
              player = undefined;
            }
          }
          if (id !== operation.current) return;
          if (!revealed) await reveal(plan, index, id);
          const action = plan.lesson.steps[index].action;
          // Let the student act before starting the next narration.
          if (action && id === operation.current) {
            setStatus(
              action.sensitive
                ? "Private step. Automatic checking is off."
                : "Watching for the result of this step",
            );
            setCheckpoint({ turn: plan.turn, index, action });
            await new Promise<void>((resolve) => {
              actionWait.current = resolve;
              watchedAction.current = { turn: plan.turn, index };
              void api()
                .watch(plan.turn, index)
                .catch(() => {
                  if (id === operation.current)
                    setStatus(
                      "Automatic checking unavailable. Use the options below.",
                    );
                });
            });
            if (id !== operation.current) return;
            actionWait.current = undefined;
            watchedAction.current = undefined;
            setCheckpoint(undefined);
          } else if (!speak && id === operation.current) {
            setStatus("Reading — continue when ready");
            setWaiting(true);
            await new Promise<void>((resolve) => {
              readingWait.current = resolve;
            });
            if (id !== operation.current) return;
            readingWait.current = undefined;
            setWaiting(false);
          }
        })
        .catch((error) => {
          if (id !== operation.current) return;
          failed = true;
          audio.current?.stop();
          setError(
            error instanceof Error ? error.message : "Teaching stopped.",
          );
        });
    };
    try {
      await api().plan({
        requestId: id,
        question: value,
        context: "auto",
        voice,
        displayId: 0,
        mode: "auto",
      });
    } catch (error) {
      if (id === operation.current)
        setError(
          error instanceof Error
            ? error.message.replace(
                /^Error invoking remote method '[^']+': Error: /,
                "",
              )
            : "Lesson generation failed.",
        );
    }
    // Earlier validated segments remain readable if generation ends early.
    await playbackQueue;
    player?.stop();
    if (audio.current === player) audio.current = undefined;
    if (id === operation.current) {
      pending.current = false;
      setBusy(false);
      setStatus("Ready");
    }
  }

  async function confirmAction(method: "check" | "manual", safeScreen = false) {
    if (!checkpoint || (checking && method === "check")) return;
    const id = operation.current;
    const request = ++confirmationRequest.current;
    setChecking(true);
    setStatus(method === "check" ? "Checking screen" : "Confirming");
    try {
      const reply = await api().check(
        checkpoint.turn,
        checkpoint.index,
        method,
        safeScreen,
      );
      if (id !== operation.current || request !== confirmationRequest.current)
        return;
      setStatus(reply.message);
      if (reply.complete) {
        actionWait.current?.();
      }
    } catch {
      if (id === operation.current && request === confirmationRequest.current)
        setStatus("Check unavailable. Use I’ve done it.");
    } finally {
      if (id === operation.current && request === confirmationRequest.current) {
        setChecking(false);
      }
    }
  }
  const bubbleAction = useRef<
    (
      action: string,
      safeScreen: boolean,
      url?: string,
      visibleStep?: number,
    ) => void
  >(() => {});
  bubbleAction.current = (action, safeScreen, url, visibleStep) => {
    if (
      ["continue", "manual", "check"].includes(action) &&
      visibleStep !== step
    )
      return;
    if (action === "source" && result && url)
      void api()
        .openSource(result.turn, url)
        .catch(() => setError("Could not open this source."));
    if (action === "continue") readingWait.current?.();
    if (action === "manual" || action === "check")
      void confirmAction(action, safeScreen);
  };
  askRef.current = (value, voice) => void ask(value, voice);
  return filesOpen ? (
    <CourseFiles
      busy={busy}
      configured={!!config?.openai}
      onClose={() => {
        setFilesOpen(false);
        void api().petCommand("close-files");
      }}
    />
  ) : null;
}

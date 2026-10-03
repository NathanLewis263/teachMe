// Queue main's lesson steps for playback, then reveal each drawing when its audio arrives.
import type { ActionCheckpoint } from "./action-checkpoint";
import type { ContextChoice, RenderChoice } from "./routing";
import { PcmPlayer } from "./pcm-player";
import { HoldRecorder } from "./hold-recorder";
import { useEffect, useRef, useState } from "react";
import type { AppBridge, DisplayChoice, PlannedLesson } from "./teacher-types";
const api = () => window.teachMe as AppBridge;
export function TeacherControls() {
  const [config, setConfig] =
    useState<Awaited<ReturnType<AppBridge["teacherStatus"]>>>();
  const [displays, setDisplays] = useState<DisplayChoice[]>([]);
  const [display, setDisplay] = useState(0);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<RenderChoice | "auto">("auto");
  const [context, setContext] = useState<ContextChoice | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready"),
    [error, setError] = useState("");
  const [result, setResult] = useState<PlannedLesson>(),
    [step, setStep] = useState(-1);
  const pending = useRef(false),
    operation = useRef(0);
  const audio = useRef<PcmPlayer | undefined>(undefined);
  const consume = useRef<(plan: PlannedLesson & { requestId: number }) => void>(
    () => {},
  );
  const readingWait = useRef<(() => void) | undefined>(undefined);
  const [checkpoint, setCheckpoint] = useState<{
    turn: number;
    index: number;
    action: ActionCheckpoint;
  }>();
  const [confirmation, setConfirmation] = useState("");
  const [checking, setChecking] = useState(false);
  const [safeScreen, setSafeScreen] = useState(false);
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
    setConfirmation("");
    setChecking(false);
    setWaiting(false);
    setBusy(false);
  }
  function stop() {
    stopLocal();
    setResult(undefined);
    setStep(-1);
    setStatus("Ready");
    setError("");
    void api().action("clear");
  }
  useEffect(() => {
    void Promise.all([api().teacherStatus(), api().displays()])
      .then(([configuration, availableDisplays]) => {
        setConfig(configuration);
        setDisplays(availableDisplays);
        setDisplay(0);
      })
      .catch(() => setError("Could not read configuration."));
    const cancel = api().subscribe("teacher-cancel", () => {
      recorder.current?.cancel();
      stopLocal();
      setResult(undefined);
      setStep(-1);
      setStatus("Ready");
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
        setConfirmation(value.message);
        actionWait.current?.();
      }
    });
    const segments = api().subscribe("teacher-segment", (value) =>
      consume.current(value),
    );
    const progress = api().subscribe("teacher-progress", (value) => {
      if (pending.current) setStatus(value);
    });
    recorder.current = new HoldRecorder(
      setStatus,
      (bytes) => api().transcribe(bytes),
      (value) => {
        setQuestion(value);
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
    void api().petCommand(error ? "error" : "state", error || status);
  }, [status, error]);
  async function reveal(plan: PlannedLesson, index: number, id: number) {
    if (id !== operation.current) return;
    const reply = await api().step(plan.turn, index);
    if (!reply.ok) throw new Error(reply.error);
    if (id === operation.current) setStep(index);
  }
  async function ask(value = question, voice = false) {
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
    let chain = Promise.resolve();
    let received = 0;
    let failed = false;
    let player: PcmPlayer | undefined;
    consume.current = (plan) => {
      if (plan.requestId !== id || id !== operation.current || failed) return;
      const index = plan.lesson.steps.length - 1;
      if (index !== received++) return;
      setResult(plan);
      chain = chain
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
            setSafeScreen(false);
            void api().petCommand("show-controls");
            await new Promise<void>((resolve) => {
              actionWait.current = resolve;
              watchedAction.current = { turn: plan.turn, index };
              void api()
                .watch(plan.turn, index)
                .catch(() =>
                  setStatus(
                    "Automatic checking unavailable. Open the fallback controls.",
                  ),
                );
            });
            if (id !== operation.current) return;
            actionWait.current = undefined;
            watchedAction.current = undefined;
            setCheckpoint(undefined);
          } else if (!speak && id === operation.current) {
            setStatus("Reading — continue when ready");
            setWaiting(true);
            void api().petCommand("show-controls");
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
        context,
        voice,
        displayId: display,
        mode,
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
    await chain;
    player?.stop();
    if (audio.current === player) audio.current = undefined;
    if (id === operation.current) {
      pending.current = false;
      setBusy(false);
      setStatus("Ready");
    }
  }

  async function confirmAction(method: "check" | "manual") {
    if (!checkpoint || checking) return;
    const id = operation.current;
    setChecking(true);
    setStatus(method === "check" ? "Checking screen" : "Confirming");
    try {
      const reply = await api().check(
        checkpoint.turn,
        checkpoint.index,
        method,
        safeScreen,
      );
      if (id !== operation.current) return;
      setStatus(reply.message);
      if (reply.complete) {
        setConfirmation(reply.message);
        actionWait.current?.();
      }
    } catch {
      if (id === operation.current)
        setStatus("Check unavailable. Use Done manually.");
    } finally {
      if (id === operation.current) {
        setChecking(false);
        setSafeScreen(false);
      }
    }
  }
  askRef.current = (value, voice) => void ask(value, voice);
  return (
    <main className="teacher-shell">
      <header className="teacher-header">
        <h1>Ask teachMe</h1>
        <button
          className="quiet-button"
          onClick={() => void api().petCommand("close-controls")}
        >
          Done
        </button>
      </header>
      <p className="teacher-note">
        Hold <kbd>Ctrl</kbd> + <kbd>Shift</kbd> to speak. Release to ask.
      </p>
      <form
        className="question-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label className="sr-only" htmlFor="teacher-question">
          Question
        </label>
        <textarea
          id="teacher-question"
          placeholder="What would you like to understand?"
          rows={4}
          maxLength={8000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="question-actions">
          <span role="status">{status}</span>
          <button
            className="ask-button"
            disabled={!config?.openai || !question.trim()}
          >
            Ask
          </button>
        </div>
      </form>
      <div className="teacher-footer">
        <details className="teacher-options">
          <summary>Settings</summary>
          <fieldset disabled={busy} className="teacher-settings">
            <label>
              Display
              <select
                className="teacher-field"
                value={display}
                onChange={(e) => setDisplay(Number(e.target.value))}
              >
                <option value={0}>Display under pointer</option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Context
              <select
                className="teacher-field"
                value={context}
                onChange={(e) => setContext(e.target.value as typeof context)}
              >
                <option value="auto">Automatic</option>
                <option value="none">Question only</option>
                <option value="screenshot">Use my screen</option>
              </select>
            </label>
            <label>
              Draw on
              <select
                className="teacher-field"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="auto">Automatic</option>
                <option value="none">No drawing</option>
                <option value="both">Whiteboard and screen</option>
                <option value="whiteboard">Whiteboard</option>
                <option value="screen">Screen</option>
              </select>
            </label>
          </fieldset>
        </details>
        <button
          className="quiet-button"
          onClick={stop}
          disabled={!busy && !result && !error}
        >
          Stop & clear
        </button>
      </div>
      {error && (
        <p role="alert" className="teacher-error">
          {error}
        </p>
      )}
      {result?.lesson.researchStatus === "unavailable" && (
        <p className="teacher-note">
          Web verification was unavailable for this lesson.
        </p>
      )}
      {!!result?.lesson.sources?.length && (
        <details className="teacher-note">
          <summary>Web sources</summary>
          <ul>
            {result.lesson.sources.map((source) => (
              <li key={source.url}>
                <button
                  className="quiet-button"
                  onClick={() =>
                    void api()
                      .openSource(result.turn, source.url)
                      .catch(() => setError("Could not open this source."))
                  }
                >
                  {source.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {confirmation && <p className="teacher-note">{confirmation}</p>}
      {checkpoint && (
        <section className="teacher-note" aria-live="polite">
          <p>{checkpoint.action.expectedAction}</p>
          <p>Expected: {checkpoint.action.completionCondition}</p>
          <p>
            {checkpoint.action.sensitive
              ? "Complete this private step yourself. Screen checks are disabled."
              : "Watching this step after clicks and scrolling. Relevant screenshots go to the configured vision provider; checking stops after two minutes or five checks."}
          </p>
          <details>
            <summary>Having trouble?</summary>
            {!checkpoint.action.sensitive && (
              <label>
                <input
                  type="checkbox"
                  checked={safeScreen}
                  onChange={(e) => setSafeScreen(e.target.checked)}
                />{" "}
                The intended app is on the selected display. No passwords,
                secure fields or private information are visible.
              </label>
            )}
            <p>
              Check sends one screenshot to the configured vision provider. Done
              manually uses your confirmation.
            </p>
            <button
              className="quiet-button"
              disabled={checking || !safeScreen || checkpoint.action.sensitive}
              onClick={() => void confirmAction("check")}
            >
              {checking ? "Checking…" : "Check screen"}
            </button>
            <button
              className="quiet-button"
              disabled={checking}
              onClick={() => void confirmAction("manual")}
            >
              Continue with my confirmation
            </button>
          </details>
        </section>
      )}
      {waiting && result && step >= 0 && (
        <p className="teacher-note">{result.lesson.steps[step].say}</p>
      )}
      {waiting && (
        <button
          className="quiet-button"
          onClick={() => readingWait.current?.()}
        >
          Continue
        </button>
      )}
    </main>
  );
}

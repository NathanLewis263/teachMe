import { PcmPlayer } from "./pcm-player";
import { HoldRecorder } from "./hold-recorder";
import { useEffect, useRef, useState } from "react";
import type {
  AppBridge,
  CourseStatus,
  DisplayChoice,
  PlannedLesson,
} from "./teacher-types";
const api = () => window.teachMe as AppBridge;
export function TeacherControls() {
  const [config, setConfig] =
    useState<Awaited<ReturnType<AppBridge["teacherStatus"]>>>();
  const [displays, setDisplays] = useState<DisplayChoice[]>([]);
  const [display, setDisplay] = useState(0);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"whiteboard" | "screen">("whiteboard");
  const [busy, setBusy] = useState(false);
  const [course, setCourse] = useState<CourseStatus>(null);
  const [indexing, setIndexing] = useState(false);
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
  const [waiting, setWaiting] = useState(false);
  const recorder = useRef<HoldRecorder | null>(null);
  const askRef = useRef<(text: string) => void>(() => {});
  function stopLocal() {
    operation.current++;
    pending.current = false;
    audio.current?.stop();
    audio.current = undefined;
    readingWait.current?.();
    readingWait.current = undefined;
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
      .then(([c, d]) => {
        setConfig(c);
        setDisplays(d);
        setDisplay(0);
      })
      .catch(() => setError("Could not read configuration."));
    void api()
      .course("status")
      .then(setCourse)
      .catch(() => {});
    const cancel = api().subscribe("teacher-cancel", () => {
      recorder.current?.cancel();
      stopLocal();
      setResult(undefined);
      setStep(-1);
      setStatus("Ready");
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
        askRef.current(value);
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
  async function ask(value = question) {
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
    let voice = !!(config?.elevenlabs && config.voice);
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
          if (voice) {
            try {
              player ??= new PcmPlayer();
              audio.current = player;
              setStatus("Preparing voice");
              while (id === operation.current) {
                const chunk = await api().speech(plan.turn, index);
                if (id !== operation.current) return;
                if (chunk.audio?.length) {
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
              voice = false;
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
          if (!voice && id === operation.current) {
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
        includeScreen: true,
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

  async function changeCourse(action: "choose" | "remove") {
    setIndexing(true);
    setError("");
    try {
      setCourse(await api().course(action));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "Course files could not be updated.",
      );
    } finally {
      setIndexing(false);
    }
  }

  askRef.current = (value) => void ask(value);
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
              Draw on
              <select
                className="teacher-field"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="whiteboard">Whiteboard</option>
                <option value="screen">Screen</option>
              </select>
            </label>
            <div>
              Course files
              <p className="teacher-note">
                {indexing
                  ? "Indexing…"
                  : course
                    ? `${course.folder} · ${course.files} files`
                    : "None. Answers use only the screen and the model."}
              </p>
              <div className="question-actions">
                <button
                  type="button"
                  className="quiet-button"
                  disabled={indexing || !config?.openai}
                  onClick={() => void changeCourse("choose")}
                >
                  {course ? "Change folder" : "Choose folder"}
                </button>
                {course && (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={indexing}
                    onClick={() => void changeCourse("remove")}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
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

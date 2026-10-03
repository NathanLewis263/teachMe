import React, { useEffect, useRef, useState } from "react";
import type { PetBubble } from "./teacher-types";
import Seal from "./seal";

// Main reports planning progress as sentences; group them into four phases.
const phases: [RegExp, string][] = [
  [
    /^(Thinking|Choosing context|Capturing display|Reading the new page)/,
    "Reading",
  ],
  [/research/i, "Researching"],
  [/^Planning/, "Planning"],
  [/^Preparing voice/, "Finding a voice"],
];
const phaseOf = (state: string) =>
  phases.findIndex(([test]) => test.test(state));
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function Pet() {
  const [level, setLevel] = useState(0);
  const [state, setState] = useState("Ready");
  const [detail, setDetail] = useState("");
  const [bubble, setBubble] = useState<PetBubble | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [direction, setDirection] = useState(1);
  const [bars, setBars] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [marks, setMarks] = useState({ available: false, visible: false });
  const transcript = useRef<HTMLParagraphElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const command = (name: string, value?: unknown) =>
    void window.teachMe.petCommand(name, value);
  const action = (name: string, url?: string) =>
    command("bubble-action", {
      action: name,
      operation: bubble?.operation,
      step: bubble?.step,
      url,
    });
  useEffect(() => {
    const off = window.teachMe.subscribe("pet-state", setState);
    const details = window.teachMe.subscribe("pet-detail", setDetail);
    const speech = window.teachMe.subscribe("pet-bubble", setBubble);
    const meter = window.teachMe.subscribe("pet-level", (value: number) => {
      setLevel(value);
      setBars((old) => [...old.slice(-13), value]);
    });
    const face = window.teachMe.subscribe("pet-direction", setDirection);
    const marked = window.teachMe.subscribe("pet-marks", setMarks);
    command("ready");
    const move = (e: MouseEvent) => {
      if (!drag.current)
        command(
          "hover",
          !!(e.target as Element).closest(".pet-hit, .pet-bubble"),
        );
    };
    window.addEventListener("mousemove", move);
    return () => {
      off();
      details();
      speech();
      meter();
      face();
      marked();
      window.removeEventListener("mousemove", move);
    };
  }, []);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = 0;
  }, [bubble?.text]);
  useEffect(() => {
    setMinimized(false);
  }, [bubble?.operation]);
  useEffect(() => {
    if (state !== "Listening") return;
    const start = Date.now();
    setElapsed(0);
    setBars([]);
    const timer = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(timer);
  }, [state]);
  const listening = state === "Listening" || state === "Connecting";
  const phase = phaseOf(state);
  const checkpoint = !listening && bubble?.checkpoint;
  const hasLesson = !!bubble?.text || !!checkpoint;
  const visible = state !== "Ready" || !!bubble?.error || hasLesson;
  const audible = state === "Speaking" || !!bubble?.paused;
  const total = bubble?.total || 0;
  const position = total
    ? `${Math.min(bubble!.step + 1, total)} / ${total}`
    : "";
  const close = (
    <button
      onClick={() => action("end")}
      title="End lesson and clear"
      aria-label="End lesson and clear"
    >
      ×
    </button>
  );
  const bubbleProps = {
    "aria-label": "teachMe",
    onPointerEnter: () => command("hover", true),
    onPointerLeave: () => {
      if (!drag.current) command("hover", false);
    },
  };
  let content: React.ReactNode = null;
  if (visible && listening)
    content = (
      <section className="pet-bubble bubble-pill" {...bubbleProps}>
        <span className="pill-dot recording" aria-hidden />
        <span className="pill-text" role="status">
          <b>{state}</b>
          {state === "Listening" && <small>{clock(elapsed)}</small>}
        </span>
        <span className="pill-wave" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ height: `${4 + (bars[i] ?? 0) * 18}px` }} />
          ))}
        </span>
        <small className="pill-hint">Release ⌃⇧ to ask</small>
      </section>
    );
  else if (visible && !hasLesson && phase >= 0 && !detail)
    content = (
      <section className="pet-bubble bubble-pill" {...bubbleProps}>
        <span className="pill-dot spinner" aria-hidden />
        <span className="pill-text" role="status">
          <b>{phases[phase][1]}</b>
          <span className="pill-phases" aria-hidden>
            {phases.map(([, label], i) => (
              <i
                key={label}
                className={i < phase ? "done" : i === phase ? "now" : ""}
              />
            ))}
          </span>
        </span>
        {close}
      </section>
    );
  else if (visible)
    content = (
      <section
        className={`pet-bubble bubble-card${minimized ? " bubble-min" : ""}`}
        {...bubbleProps}
      >
        <header>
          {audible && (
            <button
              className="bubble-play"
              onClick={() => action(bubble?.paused ? "resume" : "pause")}
              aria-label={
                bubble?.paused ? "Resume narration" : "Pause narration"
              }
              title={bubble?.paused ? "Resume" : "Pause"}
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden>
                {bubble?.paused ? (
                  <path d="M2 1l7 4-7 4z" fill="currentColor" />
                ) : (
                  <path d="M2 1h2v8H2zM6 1h2v8H6z" fill="currentColor" />
                )}
              </svg>
            </button>
          )}
          <span className="bubble-status" role="status" aria-label={state}>
            {phase >= 0 && <span className="pill-dot spinner" aria-hidden />}
            {phase >= 0 ? phases[phase][1] : position || state}
          </span>
          {marks.available && (
            <button
              className="bubble-marks"
              onClick={() => command("bubble-action", { action: "marks" })}
              aria-pressed={marks.visible}
              aria-label={
                marks.visible ? "Hide screen marks" : "Show screen marks"
              }
              title={marks.visible ? "Hide screen marks" : "Show screen marks"}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path
                  d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <circle cx="8" cy="8" r="2" fill="currentColor" />
                {!marks.visible && (
                  <path
                    d="M2.5 13.5l11-11"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
          )}
          <button
            className="bubble-toggle"
            onClick={() => setMinimized(!minimized)}
            aria-expanded={!minimized}
            aria-controls="bubble-content"
            aria-label={
              minimized ? "Restore speech bubble" : "Minimize speech bubble"
            }
            title={minimized ? "Restore" : "Minimize"}
          >
            {minimized ? "+" : "−"}
          </button>
          {close}
        </header>
        {total > 1 && !minimized && (
          <div className="bubble-progress" aria-hidden>
            <i style={{ width: `${((bubble!.step + 1) / total) * 100}%` }} />
          </div>
        )}
        {/* Keep the lesson mounted while only its content is hidden. */}
        <div id="bubble-content" hidden={minimized}>
          {detail && (
            <p className="bubble-error" role="alert">
              {detail}
            </p>
          )}
          {bubble?.text && (
            <p
              className={`bubble-transcript${checkpoint ? " short" : ""}`}
              ref={transcript}
            >
              {bubble.text}
            </p>
          )}
          {checkpoint && (
            <ol className="bubble-steps" aria-label="Guided steps">
              {bubble!.done.slice(-2).map((item, i) => (
                <li key={i} className="done">
                  <span className="step-mark" aria-hidden>
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
              <li className="now" title={checkpoint.completionCondition}>
                <span className="step-mark" aria-hidden />
                <span>
                  <b>{checkpoint.expectedAction}</b>
                  <small>
                    {bubble!.checking && (
                      <span className="pill-dot spinner" aria-hidden />
                    )}
                    {checkpoint.sensitive ? "🔒 " : ""}
                    {state}
                  </small>
                </span>
              </li>
            </ol>
          )}
          {(checkpoint || bubble?.waiting) && (
            <div className="bubble-actions">
              {checkpoint && checkpoint.sensitive && (
                <button className="primary" onClick={() => action("confirm")}>
                  Done
                </button>
              )}
              {checkpoint && !checkpoint.sensitive && (
                <button
                  disabled={bubble!.checking}
                  onClick={() => action("check")}
                >
                  {bubble!.checking ? "Checking…" : "Check now"}
                </button>
              )}
              {bubble?.waiting && (
                <button className="primary" onClick={() => action("continue")}>
                  Continue →
                </button>
              )}
            </div>
          )}
          {(!!bubble?.sources?.length || bubble?.researchUnavailable) && (
            <div className="bubble-chips">
              {bubble.sources.map((source) => (
                <button
                  key={source.url}
                  title={source.title}
                  onClick={() => action("source", source.url)}
                >
                  ↗ {host(source.url)}
                </button>
              ))}
              {bubble.researchUnavailable && (
                <span title="Web verification was unavailable.">
                  Unverified
                </span>
              )}
            </div>
          )}
        </div>
      </section>
    );
  return (
    <div
      className={`pet-stage pet-${state.toLowerCase().replaceAll(" ", "-")}`}
      style={{ "--voice-level": level } as React.CSSProperties}
    >
      {content}
      <div
        className="pet-hit"
        style={{ transform: `scaleX(${direction})` }}
        onContextMenu={(e) => {
          e.preventDefault();
          command("menu");
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.screenX, y: e.screenY };
          e.currentTarget.setPointerCapture(e.pointerId);
          command("drag", true);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          command("move", [
            e.screenX - drag.current.x,
            e.screenY - drag.current.y,
          ]);
          drag.current = { x: e.screenX, y: e.screenY };
        }}
        onPointerUp={() => {
          drag.current = null;
          command("drag", false);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          command("drag", false);
        }}
        onPointerLeave={() => {
          if (!drag.current) command("hover", false);
        }}
      >
        <Seal state={state} />
      </div>
    </div>
  );
}

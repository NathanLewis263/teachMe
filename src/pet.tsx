import React, { useEffect, useRef, useState } from "react";
import type { PetBubble } from "./teacher-types";
import Seal from "./seal";
export function Pet() {
  const [level, setLevel] = useState(0);
  const [state, setState] = useState("Ready");
  const [detail, setDetail] = useState("");
  const [bubble, setBubble] = useState<PetBubble | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [direction, setDirection] = useState(1);
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
    const meter = window.teachMe.subscribe("pet-level", setLevel);
    const face = window.teachMe.subscribe("pet-direction", setDirection);
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
      window.removeEventListener("mousemove", move);
    };
  }, []);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = 0;
  }, [bubble?.text]);
  useEffect(() => {
    setMinimized(false);
  }, [bubble?.operation]);
  const voicePending =
    state === "Listening" || state === "Connecting" || state === "Thinking";
  const visible =
    state !== "Ready" ||
    !!bubble?.text ||
    !!bubble?.error ||
    !!bubble?.checkpoint;
  return (
    <div
      className={`pet-stage pet-${state.toLowerCase().replaceAll(" ", "-")}`}
      style={{ "--voice-level": level } as React.CSSProperties}
    >
      {visible && (
        <section
          className="pet-bubble"
          aria-label="teachMe"
          onPointerEnter={() => command("hover", true)}
          onPointerLeave={() => {
            if (!drag.current) command("hover", false);
          }}
        >
          <header>
            <span className="bubble-status" role="status">
              {state === "Ready" && bubble?.text ? "Your lesson" : state}
            </span>
            <button
              className="bubble-toggle"
              onClick={() => setMinimized(!minimized)}
              aria-expanded={!minimized}
              aria-controls="bubble-content"
              aria-label={
                minimized ? "Restore speech bubble" : "Minimize speech bubble"
              }
              title={
                minimized ? "Restore speech bubble" : "Minimize speech bubble"
              }
            >
              {minimized ? "Show" : "−"}
            </button>
            <button
              onClick={() => action("end")}
              title="End lesson and clear"
              aria-label="End lesson and clear"
            >
              ×
            </button>
          </header>
          {/* Keep the lesson mounted while only its content is hidden. */}
          <div id="bubble-content" hidden={minimized}>
            {detail && (
              <p className="bubble-error" role="alert">
                {detail}
              </p>
            )}
            {!voicePending && bubble?.text && (
              <p className="bubble-transcript" ref={transcript}>
                {bubble.text}
              </p>
            )}
            {state === "Listening" && (
              <p className="bubble-help">Release Control–Shift to ask.</p>
            )}
            {!voicePending && bubble?.checkpoint && (
              <div className="bubble-checkpoint">
                <p>{bubble.checkpoint.expectedAction}</p>
                <details>
                  <summary>Need a hand?</summary>
                  <p>Expected: {bubble.checkpoint.completionCondition}</p>
                  {bubble.checkpoint.sensitive ? (
                    <p>
                      Screen checks are off for this private step. Ask a new
                      question when you are ready.
                    </p>
                  ) : (
                    <p>Checking sends a screenshot of the lesson display.</p>
                  )}
                  <div className="bubble-actions">
                    {!bubble.checkpoint.sensitive && (
                      <button
                        disabled={bubble.checking}
                        onClick={() => action("check")}
                      >
                        {bubble.checking ? "Checking…" : "Check screen"}
                      </button>
                    )}
                  </div>
                </details>
              </div>
            )}
            {!voicePending && bubble?.waiting && (
              <button
                className="bubble-continue"
                onClick={() => action("continue")}
              >
                Continue
              </button>
            )}
            {!!bubble?.sources?.length && (
              <details className="bubble-sources">
                <summary>Sources</summary>
                {bubble.sources.map((source) => (
                  <button
                    key={source.url}
                    onClick={() => action("source", source.url)}
                  >
                    {source.title}
                  </button>
                ))}
              </details>
            )}
            {bubble?.researchUnavailable && (
              <p className="bubble-help">Web verification was unavailable.</p>
            )}
          </div>
        </section>
      )}
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

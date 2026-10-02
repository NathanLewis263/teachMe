import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Annotation, Phase } from "./contracts";
declare global {
  interface Window {
    teachMe: {
      action(action: string): Promise<void>;
      subscribe(channel: string, callback: (value: any) => void): () => void;
    };
  }
}
const action = (name: string) => void window.teachMe.action(name);
function Overlay() {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  useEffect(() => window.teachMe.subscribe("drawing", setAnnotations), []);
  // Normalized coordinates map to the full display, including Retina screens.
  return (
    <svg
      className="fixed inset-0 h-screen w-screen pointer-events-none"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
    >
      {annotations.map((a, i) =>
        a.kind === "highlight" ? (
          <rect
            key={i}
            x={a.x * 1000}
            y={a.y * 1000}
            width={a.width * 1000}
            height={a.height * 1000}
            fill="#83e8cb33"
            stroke="#83e8cb"
            strokeWidth="5"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <path
            key={i}
            d={`M ${a.x * 1000} ${a.y * 1000} L ${(a.x + a.width) * 1000} ${(a.y + a.height) * 1000} m -20 0 h 20 v -20`}
            fill="none"
            stroke="#83e8cb"
            strokeWidth="5"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </svg>
  );
}
function Controls() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState(
    "Mock mode. No microphone, screen capture or model connection. Space works while this panel is focused.",
  );
  // A ref prevents key repeats from starting more than one interaction.
  const pressed = useRef(false);
  const press = () => {
    if (!pressed.current) {
      pressed.current = true;
      action("press");
    }
  };
  const release = () => {
    if (pressed.current) {
      pressed.current = false;
      action("release");
    }
  };
  const clear = () => {
    pressed.current = false;
    action("clear");
  };
  useEffect(() => {
    const unsubscribeState = window.teachMe.subscribe("state", ({ phase }) =>
      setPhase(phase),
    );
    const unsubscribeText = window.teachMe.subscribe("explanation", setText);
    const down = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        press();
      }
      if (event.code === "Escape") clear();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") release();
    };
    // Releasing outside the button or leaving the panel ends the hold.
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", release);
    return () => {
      unsubscribeState();
      unsubscribeText();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", release);
    };
  }, []);
  const field =
    "w-full rounded-xl border border-teal-800 bg-teal-950 p-3 text-sm";
  return (
    <main className="min-h-screen bg-[#152b30] p-6 text-slate-100 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">teachMe</h1>
      <p className="mt-2 text-sm text-slate-300">
        Ask about what you are studying.
      </p>
      <label className="mt-5 mb-2 block text-sm" htmlFor="unit">
        Unit workspace
      </label>
      <select className={field} id="unit">
        <option>Demo unit • local mock</option>
      </select>
      <label className="mt-4 mb-2 block text-sm" htmlFor="teacher">
        Teacher
      </label>
      <select className={field} id="teacher">
        <option>Atlas • patient guide</option>
        <option>Nova • direct coach</option>
      </select>
      <button
        className="mt-5 w-full rounded-xl bg-[#83e8cb] p-3 font-semibold text-[#152b30] active:bg-teal-300"
        onPointerDown={press}
        onPointerCancel={release}
      >
        Hold Space or this button
      </button>
      <p role="status" className="mt-3 text-sm text-[#83e8cb]">
        {phase === "listening"
          ? "Holding • mock capture"
          : phase === "explaining"
            ? "Mock explanation ready"
            : "Ready"}
      </p>
      <p className="my-4 text-sm leading-relaxed text-slate-300">{text}</p>
      <div className="flex gap-2">
        <button
          className="rounded-lg border border-teal-800 px-3 py-2 text-sm"
          onClick={() => action("highlight")}
        >
          Draw highlight
        </button>
        <button
          className="rounded-lg border border-teal-800 px-3 py-2 text-sm"
          onClick={clear}
        >
          Dismiss
        </button>
      </div>
    </main>
  );
}
const overlay = new URLSearchParams(location.search).has("overlay");
document.body.style.background = overlay ? "transparent" : "#152b30";
createRoot(document.getElementById("root")!).render(
  overlay ? <Overlay /> : <Controls />,
);

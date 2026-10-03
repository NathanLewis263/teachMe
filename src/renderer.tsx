import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type ShapeKind } from "./contracts";
import { Overlay } from "./overlay";
import { RealtimeTeacher, type TeachingBridge, type VoiceState } from "./realtime";
declare global { interface Window { teachMe: TeachingBridge; } }
const action = (name: string) => void window.teachMe.action(name);
function Controls() {
  const [shape, setShape] = useState<ShapeKind>("arrow");
  const [state, setState] = useState<VoiceState>("offline");
  const [text, setText] = useState("Ask a question and your teacher will explain it aloud and draw when useful.");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [useScreen, setUseScreen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState("");
  const client = useRef<RealtimeTeacher | null>(null);
  const held = useRef(false);
  const screenEnabled = useRef(false);
  const operation = useRef(0);
  const holdPending = useRef(false);
  const askPending = useRef(false);
  useEffect(() => {
    client.current = new RealtimeTeacher(window.teachMe, setState, setText, setError);
    void window.teachMe.realtimeStatus().then(status => {
      setConfigured(status.configured); setModel(status.model);
    }).catch(() => setError("Could not read voice configuration."));
    return () => { client.current?.stop(); };
  }, []);
  const run = async (task: () => Promise<void>) => {
    const id = operation.current;
    setError("");
    try { await task(); }
    catch (error) { if (id === operation.current) client.current?.fail(error); }
  };
  const stop = () => {
    operation.current += 1;
    held.current = false;
    holdPending.current = false;
    askPending.current = false;
    client.current?.stop();
  };
  const press = () => {
    if (held.current || holdPending.current || askPending.current) return;
    held.current = true;
    holdPending.current = true;
    const id = operation.current;
    void run(async () => {
      try { await client.current!.startHold(screenEnabled.current, () => held.current); }
      finally { if (id === operation.current) holdPending.current = false; }
    });
  };
  const release = () => {
    if (!held.current) return;
    held.current = false;
    void run(() => client.current!.release());
  };
  const ask = (value: string) => {
    if (!value.trim() || holdPending.current || askPending.current || held.current) return;
    askPending.current = true;
    const id = operation.current;
    void run(async () => {
      try { await client.current!.ask(value, screenEnabled.current); }
      finally { if (id === operation.current) askPending.current = false; }
    });
  };
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      const editing = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(element.tagName) || element.isContentEditable;
      if (event.code === "Space" && !editing && !event.repeat) { event.preventDefault(); press(); }
      if (event.code === "Escape") stop();
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") release(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", release);
    };
  }, []);
  const field = "w-full rounded-xl border border-teal-800 bg-teal-950 p-3 text-sm";
  const busy = state === "connecting" || state === "listening";
  const status = { offline: "Ready to connect", connecting: "Connecting…", ready: "Ready", listening: "Listening • release to ask", thinking: "Thinking and drawing…", speaking: "Explaining…" }[state];
  return (
    <main className="min-h-screen bg-[#152b30] p-6 text-slate-100 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">teachMe</h1>
      <p className="mt-2 text-sm text-slate-300">Ask. Listen. See how it works.</p>
      <p className="mt-2 text-xs text-slate-400">{model || "OpenAI Realtime"}</p>
      {configured === false && <p role="alert" className="mt-4 text-sm text-amber-200">Set OPENAI_API_KEY in your terminal and restart the app to enable your teacher. Drawing previews still work.</p>}
      <form className="mt-5" onSubmit={event => { event.preventDefault(); ask(question); }}>
        <label htmlFor="question" className="mb-2 block text-sm">What would you like to understand?</label>
        <textarea id="question" className={field} rows={2} maxLength={8000}
          placeholder="Show me how a pendulum works" value={question} onChange={event => setQuestion(event.target.value)} />
        <button disabled={busy || configured === false || !question.trim()} className="mt-2 rounded-xl bg-[#83e8cb] px-4 py-2 font-semibold text-[#152b30] disabled:opacity-40">Ask teacher</button>
      </form>
      <button className="mt-3 text-sm text-[#83e8cb] underline" disabled={busy || configured === false}
        onClick={() => { const example = "Show me how a pendulum works. Draw its parts and explain why it swings back and forth."; setQuestion(example); ask(example); }}>
        Try a pendulum explanation
      </button>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={useScreen} onChange={event => { setUseScreen(event.target.checked); screenEnabled.current = event.target.checked; }} />
        Include my primary screen
      </label>
      <p className="mt-1 text-xs text-slate-400">{useScreen ? "Sends one screenshot with each question to OpenAI." : "Draw original diagrams without sharing your screen."}</p>
      <button disabled={configured === false}
        className="mt-4 w-full rounded-xl border border-teal-600 p-3 font-semibold active:bg-teal-800 disabled:opacity-40"
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); press(); }}
        onPointerUp={release} onPointerCancel={release}
        onKeyDown={event => { if (["Space", "Enter"].includes(event.code)) { event.preventDefault(); if (!event.repeat) press(); } }}
        onKeyUp={event => { if (["Space", "Enter"].includes(event.code)) release(); }}>
        Hold to talk
      </button>
      <p className="mt-1 text-xs text-slate-400">Wait for Listening, then speak. Space also works outside text fields while this panel is focused.</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p role="status" className="text-sm text-[#83e8cb]">{status}</p>
        <button className="rounded-lg border border-teal-800 px-3 py-2 text-sm" onClick={stop}>Stop & clear</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>}
      {state === "ready" && <button className="mt-3 text-sm text-[#83e8cb] underline"
        onClick={() => ask("Continue the current topic in more detail with the next useful section. Build on what you already explained; do not repeat the introduction. For a large subject, cover one region or mechanism thoroughly and name what we can explore next.")}>Continue this topic</button>}
      <p className="my-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{text}</p>
      <details className="border-t border-teal-800 pt-3">
        <summary className="cursor-pointer text-sm text-slate-400">Drawing previews</summary>
        <label htmlFor="shape" className="my-2 block text-sm">Drawing shape</label>
        <select id="shape" className={field} value={shape} onChange={event => setShape(event.target.value as ShapeKind)}>
          <option value="arrow">Arrow</option><option value="highlight">Rectangle highlight</option>
          <option value="ellipse">Ellipse</option><option value="line">Line</option>
          <option value="triangle">Triangle</option><option value="star">Star</option><option value="curve">Curve</option>
        </select>
        <button className="mt-3 rounded-lg border border-teal-800 px-3 py-2 text-sm" onClick={() => { stop(); action(shape); }}>Draw shape</button>
      </details>
    </main>
  );
}
const overlay = new URLSearchParams(location.search).has("overlay");
document.body.style.background = overlay ? "transparent" : "#152b30";
createRoot(document.getElementById("root")!).render(
  overlay ? <Overlay /> : <Controls />,
);

import { app, BrowserWindow, ipcMain, screen, session, desktopCapturer, systemPreferences } from "electron";
import path from "node:path";
import { encodeScreen } from "./capture";
import { existsSync } from "node:fs";
import {
  Annotation,
  isAction,
  Phase,
  validAnnotation,
  shapeKinds,
  ShapeKind,
} from "./contracts";
import { realtimeConfig, validScene } from "./realtime-config";

// Keep the API key here, outside React. Terminal settings override .env.
const envPath = path.join(app.getAppPath(), ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { validLesson, applyDrawingStep, type Lesson } from "./lesson";

let activeLesson: Lesson | undefined;
let lessonStep = -1;
let lessonAnnotations: Annotation[] = [];
let turn = 0;
let connecting = false;
let controls: BrowserWindow;
let overlay: BrowserWindow;
let phase: Phase = "idle";

function send(annotations: Annotation[] = []) {
  controls.webContents.send("state", { phase });
  overlay.webContents.send("drawing", annotations.filter(validAnnotation));
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(wc === controls?.webContents && permission === "media" &&
      "mediaTypes" in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio");
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) =>
    wc === controls?.webContents && permission === "media" && details.mediaType === "audio");
  const display = screen.getPrimaryDisplay();
  const preferences = {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
  overlay = new BrowserWindow({
    ...display.bounds,
    transparent: true,
    frame: false,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: preferences,
  });
  // Draw above the desktop while passing clicks to the student's apps.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, "floating");
  controls = new BrowserWindow({
    width: 390,
    height: Math.min(740, display.workArea.height - 60),
    x: display.workArea.x + display.workArea.width - 410,
    y: display.workArea.y + 30,
    alwaysOnTop: true,
    webPreferences: preferences,
  });
  for (const window of [controls, overlay]) {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
  }
  void overlay.loadFile(path.join(__dirname, "index.html"), {
    query: { overlay: "true" },
  });
  void controls.loadFile(path.join(__dirname, "index.html"));
  controls.on("closed", () => app.quit());
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== controls.webContents || event.senderFrame !== controls.webContents.mainFrame)
      throw new Error("Invalid sender");
  };
  ipcMain.handle("realtime-status", (event) => {
    authorize(event);
    return { configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1" };
  });
  ipcMain.handle("realtime-connect", async (event, offer: unknown) => {
    authorize(event);
    if (typeof offer !== "string" || !offer.startsWith("v=0") || offer.length > 100_000)
      throw new Error("Invalid connection offer");
    if (connecting) throw new Error("A connection is already starting");
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Set OPENAI_API_KEY in your terminal, then restart teachMe.");
    connecting = true;
    try {
      const form = new FormData();
      form.set("sdp", offer);
      form.set("session", JSON.stringify(realtimeConfig(process.env.OPENAI_REALTIME_MODEL, process.env.OPENAI_REALTIME_VOICE)));
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`OpenAI connection failed (${response.status}). Check your API key, model access and API billing.`);
      return await response.text();
    } finally { connecting = false; }
  });
  ipcMain.handle("realtime-begin", (event) => {
    authorize(event);
    turn += 1;
    activeLesson = undefined;
    send();
    const bounds = screen.getPrimaryDisplay().bounds;
    overlay.setBounds(bounds);
    return { turn, width: bounds.width, height: bounds.height };
  });
  ipcMain.handle("realtime-draw", (event, id: unknown, scene: unknown) => {
    authorize(event);
    if (id !== turn) return { ok: false, error: "This question was cancelled." };
    if (!validScene(scene)) return { ok: false, error: "Invalid diagram. Use at most 32 shapes, bounded 0..1 coordinates, and valid M/L/Q/C/Z paths." };
    send(scene.annotations);
    return { ok: true };
  });
  ipcMain.handle("realtime-lesson", (event, id: unknown, lesson: unknown) => {
    authorize(event);
    if (id !== turn) return { ok: false, error: "Question cancelled" };
    if (!validLesson(lesson)) return { ok: false, error: "Invalid lesson. Supply 1-12 spoken steps. Scenes need valid named nodes and attached links; notes need written content; flow needs labels." };
    activeLesson = lesson;
    lessonStep = -1;
    lessonAnnotations = [];
    return { ok: true };
  });
  ipcMain.handle("realtime-step", (event, id: unknown, index: unknown) => {
    authorize(event);
    if (id !== turn || !activeLesson || typeof index !== "number" || index !== lessonStep + 1 || index >= activeLesson.steps.length)
      return { ok: false, error: "Stale lesson step" };
    lessonStep = index;
    lessonAnnotations = applyDrawingStep(lessonAnnotations, activeLesson.steps[index]);
    overlay.webContents.send("lesson", { lesson: activeLesson, step: index, annotations: lessonAnnotations });
    return { ok: true };
  });
  ipcMain.handle("realtime-capture", async (event, id: unknown, maxBytes: unknown) => {
    authorize(event);
    if (id !== turn) throw new Error("Question cancelled");
    if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") === "denied")
      throw new Error("Enable Screen Recording for teachMe or Electron in macOS System Settings, then restart.");
    if (typeof maxBytes !== "number" || !Number.isInteger(maxBytes) || maxBytes < 8192 || maxBytes > 1024 * 1024)
      throw new Error("Invalid screenshot size budget");
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({ types: ["screen"],
      thumbnailSize: { width: 1600, height: Math.round(1600 * display.size.height / display.size.width) } });
    if (id !== turn) throw new Error("Question cancelled");
    const source = sources.find(source => source.display_id === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error("Screen capture unavailable. Check macOS Screen Recording permission.");
    return encodeScreen(source.thumbnail, maxBytes);
  });
  ipcMain.handle("action", (event, action: unknown) => {
    authorize(event);
    if (!isAction(action)) throw new Error("Invalid action");
    if (action === "clear") { turn += 1; activeLesson = undefined; phase = "idle"; send(); }
    else if (action === "press") { phase = "listening"; send(); }
    else if (action === "release") { phase = "explaining"; controls.webContents.send("state", { phase }); }
    else if (shapeKinds.includes(action as ShapeKind)) {
      phase = "explaining";
      send([{ kind: action as ShapeKind, x: 0.35, y: 0.3, width: 0.25, height: 0.3 }]);
    }
  });
});
app.on("window-all-closed", () => app.quit());

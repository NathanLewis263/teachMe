import { createPet } from "./pet-desktop";
import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  session,
  desktopCapturer,
  systemPreferences,
  globalShortcut,
  dialog,
} from "electron";
import path from "node:path";
import { encodeScreen } from "./capture";
import { existsSync } from "node:fs";
import type { Annotation } from "./contracts";

// Keep the API key here, outside React. Terminal settings override .env.
const envPath = path.join(app.getAppPath(), ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { applyDrawingStep, type Lesson } from "./lesson";

import { speechModel, planLesson } from "./providers";
import { speechChunks } from "./speech-stream";
import type { LessonRequest } from "./teacher-types";
import { indexCourse, loadCourse, removeCourse } from "./course";
import { routeContext } from "./context-router";
let providerAbort = new AbortController();
let screenTurn = false;
let viewedStep: number | undefined;
let boardRegion: {
  x: number;
  y: number;
  width: number;
  height: number;
  dragging: boolean;
} | null = null;
let lessonDisplay: Electron.Display | undefined;
let screenDeadline = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
const spoken = new Set<number>();
let speechAbort = new AbortController();
let speech:
  | { index: number; chunks: AsyncGenerator<Uint8Array>; pulling: boolean }
  | undefined;
// A new turn invalidates late provider replies as well as visible marks.
function cancelTeacher(notify = true) {
  providerAbort.abort();
  speechAbort.abort();
  void speech?.chunks.return(undefined).catch(() => {});
  speech = undefined;
  providerAbort = new AbortController();
  clearTimeout(expiry);
  spoken.clear();
  turn++;
  activeLesson = undefined;
  viewedStep = undefined;
  boardRegion = null;
  screenTurn = false;
  overlay.webContents.send("lesson-clear");
  if (notify) controls.webContents.send("teacher-cancel");
}
let activeLesson: Lesson | undefined;
let lessonStep = -1;
let lessonAnnotations: Annotation[] = [];
let turn = 0;
let controls: BrowserWindow;
let overlay: BrowserWindow;

function publishLesson() {
  if (!activeLesson || lessonStep < 0 || !lessonDisplay) return;
  const content = overlay.getContentBounds();
  const target = lessonDisplay.bounds;
  overlay.webContents.send("lesson", {
    viewport: {
      x: target.x - content.x,
      y: target.y - content.y,
      width: target.width,
      height: target.height,
    },
    lesson: activeLesson,
    step: viewedStep ?? lessonStep,
    turn,
    annotations: lessonAnnotations,
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (wc, permission, callback, details) => {
      callback(
        wc === controls?.webContents &&
          permission === "media" &&
          "mediaTypes" in details &&
          details.mediaTypes?.length === 1 &&
          details.mediaTypes[0] === "audio",
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, _origin, details) =>
      wc === controls?.webContents &&
      permission === "media" &&
      details.mediaType === "audio",
  );
  const display = screen.getPrimaryDisplay();
  const preferences = {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    backgroundThrottling: false,
  };
  overlay = new BrowserWindow({
    ...display.bounds,
    transparent: true,
    backgroundColor: "#00000000",
    enableLargerThanScreen: true,
    skipTaskbar: true,
    frame: false,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: preferences,
  });
  // Draw above the desktop while passing clicks to the student's apps.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, "floating");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  controls = new BrowserWindow({
    show: false,
    width: 390,
    height: Math.min(420, display.workArea.height - 60),
    minWidth: 340,
    minHeight: 360,
    backgroundColor: "#f2f6f5",
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
  let quitting = false;
  app.on("before-quit", () => {
    quitting = true;
    providerAbort.abort();
    speechAbort.abort();
  });
  controls.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      controls.hide();
    }
  });
  const pet = createPet(controls, cancelTeacher);
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== controls.webContents ||
      event.senderFrame !== controls.webContents.mainFrame
    )
      throw new Error("Invalid sender");
  };
  globalShortcut.register("CommandOrControl+Shift+Escape", pet.cancel);
  screen.on("display-metrics-changed", () => cancelTeacher());
  screen.on("display-removed", () => cancelTeacher());
  ipcMain.handle("teacher-status", (event) => {
    authorize(event);
    return {
      openai: !!process.env.OPENAI_API_KEY,
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      voice: !!process.env.ELEVENLABS_VOICE_ID,
    };
  });
  ipcMain.handle("displays", (event) => {
    authorize(event);
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      name: d.label || `Display ${d.id}`,
    }));
  });
  ipcMain.handle("teacher-plan", async (event, request: LessonRequest) => {
    authorize(event);
    if (
      !request ||
      !Number.isSafeInteger(request.requestId) ||
      typeof request.question !== "string" ||
      !request.question.trim() ||
      request.question.length > 8000 ||
      typeof request.includeScreen !== "boolean" ||
      !["screen", "whiteboard"].includes(request.mode) ||
      (request.mode === "screen" && !request.includeScreen)
    )
      throw new Error("Invalid lesson request");
    const display =
      request.displayId === 0
        ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        : screen.getAllDisplays().find((d) => d.id === request.displayId);
    if (!display) throw new Error("Select an available display.");
    const previous = activeLesson
      ? JSON.stringify(activeLesson).slice(0, 16000)
      : "";
    const course = await loadCourse();
    cancelTeacher(false);
    const id = turn;
    const route = routeContext(request.question, !!course);
    // Screen mode draws on the capture, so it always needs one.
    const includeScreen =
      request.mode === "screen" || (request.includeScreen && route.screen);
    const signal = providerAbort.signal;
    // Electron bounds are logical pixels; the drawing layer uses screenshot fractions.
    lessonDisplay = display;
    overlay.setBounds(display.bounds);
    overlay.showInactive();
    controls.webContents.send(
      "teacher-progress",
      includeScreen ? "Capturing" : "Thinking",
    );
    const capturedAt = Date.now();
    let image: string | undefined;
    if (includeScreen) {
      if (
        process.platform === "darwin" &&
        systemPreferences.getMediaAccessStatus("screen") === "denied"
      )
        throw new Error(
          "Enable Screen Recording for Electron in System Settings, then restart.",
        );
      // Keep the previous whiteboard out of the new reference image.
      overlay.hide();
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: {
            width: 1600,
            height: Math.round(
              (1600 * display.size.height) / display.size.width,
            ),
          },
        });
        if (id !== turn) throw new Error("Cancelled");
        const source = sources.find((s) => s.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty())
          throw new Error(
            "Screen capture unavailable. Check Screen Recording permission.",
          );
        image = encodeScreen(source.thumbnail, 1024 * 1024);
      } finally {
        if (id === turn && !overlay.isDestroyed()) overlay.showInactive();
      }
    }
    if (id !== turn) throw new Error("Cancelled");
    controls.webContents.send("teacher-progress", "Planning");
    lessonStep = -1;
    lessonAnnotations = [];
    screenTurn = request.mode === "screen";
    screenDeadline = capturedAt + 120_000;
    if (screenTurn)
      expiry = setTimeout(
        cancelTeacher,
        Math.max(0, screenDeadline - Date.now()),
      );
    const result = await planLesson(
      request,
      image,
      previous,
      route.course ? course?.vectorStoreId : undefined,
      signal,
      (lesson) => {
        if (id !== turn || signal.aborted) return;
        activeLesson = lesson;
        publishLesson();
        controls.webContents.send("teacher-segment", {
          requestId: request.requestId,
          turn: id,
          lesson,
        });
      },
    );
    if (id !== turn) throw new Error("Cancelled");
    return { turn: id, ...result };
  });
  ipcMain.handle("course", async (event, action: unknown) => {
    authorize(event);
    if (action === "choose") {
      const { canceled, filePaths } = await dialog.showOpenDialog(controls, {
        title: "Choose a course folder",
        properties: ["openDirectory"],
      });
      if (!canceled && filePaths[0]) await indexCourse(filePaths[0]);
    } else if (action === "remove") await removeCourse();
    else if (action !== "status") throw new Error("Invalid course action");
    const course = await loadCourse();
    return course
      ? { folder: path.basename(course.folder), files: course.files }
      : null;
  });
  ipcMain.on("board-region", (event, region) => {
    if (
      event.sender !== overlay.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      return;
    if (region === null) {
      boardRegion = null;
      return;
    }
    if (
      !region ||
      ![region.x, region.y, region.width, region.height].every(
        Number.isFinite,
      ) ||
      region.width <= 0 ||
      region.height <= 0 ||
      typeof region.dragging !== "boolean"
    )
      return;
    boardRegion = region;
  });
  let interactive = false;
  const hitTest = setInterval(() => {
    if (overlay.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = overlay.getBounds();
    const r = boardRegion;
    const inside =
      !!r &&
      !!activeLesson &&
      !screenTurn &&
      (r.dragging ||
        (point.x >= bounds.x + r.x &&
          point.x <= bounds.x + r.x + r.width &&
          point.y >= bounds.y + r.y &&
          point.y <= bounds.y + r.y + r.height));
    if (inside !== interactive) {
      interactive = inside;
      overlay.setIgnoreMouseEvents(!inside, { forward: true });
    }
  }, 50);
  hitTest.unref();
  overlay.once("closed", () => clearInterval(hitTest));
  ipcMain.handle("board-browse", (event, id, index) => {
    if (
      event.sender !== overlay.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      id !== turn ||
      !activeLesson ||
      screenTurn ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= activeLesson.steps.length
    )
      return;
    // Browsing changes the slide, not the speech queue.
    viewedStep = index;
    publishLesson();
  });
  ipcMain.handle("teacher-speech", async (event, id, index) => {
    authorize(event);
    if (
      id !== turn ||
      !activeLesson ||
      !Number.isInteger(index) ||
      !activeLesson.steps[index]
    )
      throw new Error("Stale speech request");
    if (!speech) {
      if (spoken.has(index) || index !== lessonStep + 1)
        throw new Error("Repeated speech request");
      spoken.add(index);
      speechAbort = new AbortController();
      speech = {
        index,
        pulling: false,
        chunks: speechChunks(
          activeLesson.steps[index].say,
          AbortSignal.any([providerAbort.signal, speechAbort.signal]),
          speechModel(),
        ),
      };
    }
    const current = speech;
    if (current.index !== index || current.pulling)
      throw new Error("Out-of-order speech request");
    current.pulling = true;
    try {
      const chunk = await current.chunks.next();
      if (id !== turn || speech !== current) throw new Error("Cancelled");
      if (chunk.done) speech = undefined;
      return { done: !!chunk.done, audio: chunk.value };
    } catch (error) {
      if (speech === current) {
        speechAbort.abort();
        speech = undefined;
      }
      throw error;
    } finally {
      current.pulling = false;
    }
  });
  ipcMain.handle("teacher-speech-stop", (event, id) => {
    authorize(event);
    if (id !== turn) return;
    speechAbort.abort();
    void speech?.chunks.return(undefined).catch(() => {});
    speech = undefined;
  });
  ipcMain.handle("teacher-step", (event, id: unknown, index: unknown) => {
    authorize(event);
    if (
      id !== turn ||
      !activeLesson ||
      typeof index !== "number" ||
      index !== lessonStep + 1 ||
      index >= activeLesson.steps.length
    )
      return { ok: false, error: "Stale lesson step" };
    if (screenTurn && Date.now() > screenDeadline) {
      cancelTeacher();
      return {
        ok: false,
        error: "Screenshot expired. Ask again for a fresh capture.",
      };
    }
    overlay.showInactive();
    lessonStep = index;
    lessonAnnotations = applyDrawingStep(
      lessonAnnotations,
      activeLesson.steps[index],
    );
    publishLesson();
    return { ok: true };
  });
  ipcMain.handle("action", (event, action: unknown) => {
    authorize(event);
    if (action !== "clear") throw new Error("Invalid action");
    pet.cancel();
  });
});
app.on("window-all-closed", () => app.quit());

app.on("will-quit", () => globalShortcut.unregisterAll());

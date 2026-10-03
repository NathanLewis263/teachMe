// Main owns windows and provider calls; the renderer times each step with its audio.
import { researchQuestion, publicSourceUrl } from "./web-research";
import { trackAnnotation, type ScreenPixels } from "./annotation-tracking";
import { ActionGate } from "./action-checkpoint";
import { routeQuestion } from "./routing";
import {
  clearDisplay,
  takeDisplay,
  takeScreenOverride,
  onScreenInput,
  hasInputGuard,
} from "./screen-state";
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
  shell,
  dialog,
} from "electron";
import path from "node:path";
import { encodeScreen } from "./capture";
import { existsSync } from "node:fs";
import type { Annotation } from "./contracts";
import {
  adoptPrepared,
  StepPreparation,
  type PreparedPage,
  PreparedSpeech,
  type ScreenRegion,
  type ScreenSample,
} from "./step-preparation";

// Keep the API key here, outside React. Terminal settings override .env.
const envPath = path.join(app.getAppPath(), ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { applyDrawingStep, type Lesson } from "./lesson";

import {
  speechModel,
  lessonModel,
  planLesson,
  verifyAction,
} from "./providers";
import { speechChunks } from "./speech-stream";
import type { LessonRequest } from "./teacher-types";
import { indexCourse, loadCourse, removeCourse } from "./course";
let providerAbort = new AbortController();
let screenTurn = false;
let lessonAllowsScreen = false;
let actionGate: ActionGate | undefined;
let checkAbort = new AbortController();
let autoCheckTimer: ReturnType<typeof setTimeout> | undefined;
let automaticChecks = 0;
let requestAutomaticCheck: () => void = () => {};
let requestEarlyCheck: () => void = () => {};
let resumeLesson: (() => void) | undefined;
let annotationStart = 0;
// A checkpoint can finish before generation returns, or while this wait is active.
function waitForAction(id: number, index: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (
    actionGate?.turn === id &&
    actionGate.step === index &&
    actionGate.confirmed
  )
    return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const clear = () => {
      signal.removeEventListener("abort", abort);
      if (resumeLesson === finish) resumeLesson = undefined;
    };
    const finish = () => {
      clear();
      resolve();
    };
    const abort = () => {
      clear();
      reject(new Error("Cancelled"));
    };
    resumeLesson = finish;
    signal.addEventListener("abort", abort, { once: true });
  });
}
function resumeAutomaticCheck() {
  if (actionGate?.resume()) requestAutomaticCheck();
}
// The planning loop exposes its next request only while it waits for this checkpoint.
let nextPage:
  | {
      turn: number;
      step: number;
      plan: (
        image: string,
        signal: AbortSignal,
        segment: (lesson: Lesson) => void,
      ) => Promise<{ lesson: Lesson }>;
    }
  | undefined;
let confirmedScreen: (ScreenSample & PreparationTarget) | undefined;
let lessonSpeechEnabled = true;
let preparedSpeech:
  { turn: number; index: number; speech: PreparedSpeech } | undefined;
type PreparationTarget = { turn: number; step: number; revision: number };
function screenAllowed() {
  return (
    process.platform !== "darwin" ||
    systemPreferences.getMediaAccessStatus("screen") === "granted"
  );
}
// Ignore teachMe's own visible windows when comparing captures.
function teachMeRegions(display: Electron.Display): ScreenRegion[] {
  const { x, y, width, height } = display.bounds;
  const regions = BrowserWindow.getAllWindows()
    .filter((window) => window !== overlay && window.isVisible())
    .map((window) => window.getBounds());
  const board = boardRegion,
    origin = overlay.getBounds();
  if (board && overlay.isVisible())
    regions.push({ ...board, x: origin.x + board.x, y: origin.y + board.y });
  return regions.map((region) => ({
    x: (region.x - x) / width,
    y: (region.y - y) / height,
    width: region.width / width,
    height: region.height / height,
  }));
}
function waitingAction() {
  return actionGate && !actionGate.confirmed
    ? { turn: actionGate.turn, step: actionGate.step }
    : undefined;
}
// Synthesize the following step of the same page while the current narration plays.
function prefetchSpeech() {
  const lesson = activeLesson;
  const index = (speech?.index ?? lessonStep) + 1;
  const step = lesson?.steps[index];
  if (
    !step ||
    !lessonSpeechEnabled ||
    preparedSpeech ||
    spoken.has(index) ||
    // After an action the next step waits for verification and a prepared page.
    lesson.steps[index - 1]?.action
  )
    return;
  preparedSpeech = {
    turn,
    index,
    speech: new PreparedSpeech(
      step.say,
      (text, signal) => speechChunks(text, signal, speechModel()),
      providerAbort.signal,
      2_400_000,
    ),
  };
}
function cancelPreparation() {
  preparation.cancel();
  preparedSpeech?.speech.cancel();
  preparedSpeech = undefined;
  confirmedScreen = undefined;
}
const preparation = new StepPreparation({
  eligible: (tag) =>
    tag.turn === turn &&
    nextPage?.turn === tag.turn &&
    nextPage.step === tag.step &&
    actionGate?.turn === tag.turn &&
    actionGate.step === tag.step &&
    !actionGate.confirmed &&
    !actionGate.action.sensitive &&
    !(actionGate.watchUntil && Date.now() >= actionGate.watchUntil) &&
    lessonAllowsScreen &&
    !controls.isVisible() &&
    !!lessonDisplay &&
    hasInputGuard() &&
    screenAllowed(),
  async sample() {
    const display = lessonDisplay;
    if (!display) return;
    const source = await captureDisplay(display, 800);
    if (!source || source.thumbnail.isEmpty()) return;
    return {
      pixels: screenPixels(source.thumbnail),
      ignore: teachMeRegions(display),
    };
  },
  // Hide marks and the board as the normal page capture does, without interrupting narration.
  async capture() {
    const display = lessonDisplay;
    if (!display || scrollBusy || actionGate?.checking) return;
    const id = turn;
    overlay.hide();
    const ignore = teachMeRegions(display);
    try {
      const source = await captureDisplay(display, 1600);
      if (id !== turn || !source || source.thumbnail.isEmpty()) return;
      return {
        pixels: screenPixels(source.thumbnail),
        image: encodeScreen(source.thumbnail, 1024 * 1024),
        ignore,
      };
    } finally {
      if (id === turn && !scrollBusy && !actionGate?.checking) {
        overlay.showInactive();
        publishLesson();
      }
      // The screen has settled, so also check the action without waiting for narration to end.
      if (id === turn) setTimeout(() => id === turn && requestEarlyCheck(), 0);
    }
  },
  plan: (image, signal, segment) => {
    if (!nextPage) return Promise.reject(new Error("No next page"));
    return nextPage.plan(image, signal, segment);
  },
  canSpeak: () => lessonSpeechEnabled,
  speak: (text, signal) =>
    speechChunks(
      text,
      AbortSignal.any([signal, providerAbort.signal]),
      speechModel(),
    ),
});

let coordinatesInvalid = false;
let referencePixels: ScreenPixels | undefined;
let scrolledPixels: ScreenPixels | undefined;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let scrollRevision = 0;
let scrollBusy = false;
let scrollHidden = false;
let scrollCaptures = 0;
let lastScrollCapture = 0;
async function captureDisplay(display: Electron.Display, width: number) {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width,
      height: Math.round((width * display.size.height) / display.size.width),
    },
  });
  return sources.find((source) => source.display_id === String(display.id));
}

function screenPixels(image: Electron.NativeImage): ScreenPixels {
  const resized = image.resize({ width: 800 });
  return { ...resized.getSize(), data: resized.toBitmap() };
}
function clearTracking() {
  clearTimeout(scrollTimer);
  scrollRevision++;
  referencePixels = undefined;
  scrolledPixels = undefined;
  scrollHidden = false;
}
function visibleAnnotations(): Annotation[] {
  if (coordinatesInvalid || scrollHidden || !activeLesson) return [];
  const marks =
    viewedStep === undefined
      ? lessonAnnotations
      : activeLesson.steps
          .slice(annotationStart, viewedStep + 1)
          .reduce(applyDrawingStep, [] as Annotation[]);
  const beforeScroll = referencePixels;
  const afterScroll = scrolledPixels;
  if (!beforeScroll || !afterScroll) return marks;
  return marks.flatMap((mark) => {
    const tracked = trackAnnotation(mark, beforeScroll, afterScroll);
    return tracked ? [tracked] : [];
  });
}
function scheduleScrollTracking() {
  actionGate?.invalidate();
  checkAbort.abort();
  clearTimeout(scrollTimer);
  const revision = ++scrollRevision;
  scrollHidden = true;
  publishLesson();
  if (
    !referencePixels ||
    coordinatesInvalid ||
    actionGate?.action.sensitive ||
    scrollCaptures >= 60 ||
    Date.now() > screenDeadline
  )
    return;
  const id = turn;
  scrollTimer = setTimeout(
    async () => {
      if (
        id !== turn ||
        revision !== scrollRevision ||
        scrollBusy ||
        !lessonDisplay
      )
        return;
      scrollBusy = true;
      scrollCaptures++;
      lastScrollCapture = Date.now();
      overlay.hide();
      try {
        const display = lessonDisplay;
        const source = await captureDisplay(display, 800);
        if (id !== turn || revision !== scrollRevision) return;
        if (!source || source.thumbnail.isEmpty()) return;
        scrolledPixels = screenPixels(source.thumbnail);
        scrollHidden = false;
      } catch {
        // Unavailable or ambiguous targets remain hidden.
      } finally {
        scrollBusy = false;
        if (id === turn) {
          overlay.showInactive();
          publishLesson();
        }
      }
    },
    Math.max(350, 1000 - (Date.now() - lastScrollCapture)),
  );
}

// Hide stale marks and discard old screen checks, but keep narration running.
function invalidateAction() {
  clearTimeout(autoCheckTimer);
  clearTracking();
  actionGate?.invalidate();
  checkAbort.abort();
  coordinatesInvalid = true;
  lessonAnnotations = [];
  publishLesson();
}

const recentConversation: string[] = [];
let previousLesson = "";
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
// Abort pending work and bump the turn ID so late replies cannot restart an old lesson.
function cancelTeacher(notify = true, forgetHistory = false) {
  if (forgetHistory) {
    previousLesson = "";
    recentConversation.length = 0;
  }
  invalidateAction();
  cancelPreparation();
  lessonSpeechEnabled = true;
  nextPage = undefined;
  actionGate = undefined;
  coordinatesInvalid = false;
  scrollCaptures = 0;
  annotationStart = 0;
  automaticChecks = 0;
  clearDisplay();
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
  lessonAllowsScreen = false;
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
  if (
    screenTurn &&
    Date.now() > screenDeadline &&
    !actionGate &&
    !coordinatesInvalid
  )
    return;
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
    annotations: visibleAnnotations(),
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
    width: 440,
    height: Math.min(530, display.workArea.height - 60),
    title: "Eat my files",
    minWidth: 340,
    minHeight: 360,
    backgroundColor: "#f2f6f5",
    x: display.workArea.x + display.workArea.width - 460,
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
      pet.cancel();
      controls.hide();
    }
  });
  const pet = createPet(controls, (newQuestion = false) =>
    cancelTeacher(true, !newQuestion),
  );
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
  // Route before capturing; only the lesson request gets the screenshot.
  ipcMain.handle("teacher-plan", async (event, request: LessonRequest) => {
    authorize(event);
    if (
      !request ||
      !Number.isSafeInteger(request.requestId) ||
      typeof request.question !== "string" ||
      !request.question.trim() ||
      request.question.length > 8000 ||
      !["auto", "none", "screenshot"].includes(request.context) ||
      !["auto", "none", "screen", "whiteboard", "both"].includes(
        request.mode,
      ) ||
      (request.voice !== undefined && typeof request.voice !== "boolean")
    )
      throw new Error("Invalid lesson request");
    const heldDisplay = takeDisplay();
    const displayId =
      request.voice && request.displayId === 0
        ? (heldDisplay ?? 0)
        : request.displayId;
    const display =
      displayId === 0
        ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        : screen.getAllDisplays().find((display) => display.id === displayId);
    if (!display) throw new Error("Select an available display.");
    const screenOverride = takeScreenOverride();
    const previous = previousLesson;
    cancelTeacher(false);
    const id = turn;
    const signal = providerAbort.signal;
    // Keep Stop effective while the saved course ID is loading.
    const course = await loadCourse();
    if (id !== turn || signal.aborted) throw new Error("Cancelled");
    controls.webContents.send("teacher-progress", "Choosing context");
    const route = await routeQuestion(
      request.question,
      recentConversation,
      {
        context:
          request.context !== "auto"
            ? request.context
            : screenOverride
              ? "screenshot"
              : undefined,
        rendering: request.mode === "auto" ? undefined : request.mode,
      },
      signal,
    );
    if (id !== turn) throw new Error("Cancelled");
    if (
      (route.rendering === "screen" || route.rendering === "both") &&
      !hasInputGuard()
    )
      throw new Error(
        "Enable voice permissions from the seal menu before using screen annotations, so input can clear stale marks.",
      );
    const needsScreen = route.context === "screenshot";
    lessonAllowsScreen = needsScreen;
    let image: string | undefined;
    let capturedAt = Date.now();
    lessonDisplay = display;
    if (needsScreen) {
      if (
        process.platform === "darwin" &&
        systemPreferences.getMediaAccessStatus("screen") !== "granted"
      )
        throw new Error(
          "Grant Screen Recording to Electron/teachMe in System Settings, then restart. No capture was made.",
        );
      controls.webContents.send("teacher-progress", "Capturing display");
      overlay.hide();
      const source = await captureDisplay(display, 1600);
      if (id !== turn) throw new Error("Cancelled");
      if (!source || source.thumbnail.isEmpty())
        throw new Error(
          "Screen capture unavailable. Check Screen Recording permission.",
        );
      referencePixels = screenPixels(source.thumbnail);
      image = encodeScreen(source.thumbnail, 1024 * 1024);
      capturedAt = Date.now();
    }
    controls.webContents.send(
      "teacher-progress",
      "Checking whether web research is needed",
    );
    const research = await researchQuestion(
      request.question,
      lessonModel(),
      signal,
    );
    if (id !== turn) throw new Error("Cancelled");
    overlay.setBounds(lessonDisplay.bounds);
    overlay.showInactive();
    if (id !== turn) throw new Error("Cancelled");
    controls.webContents.send("teacher-progress", "Planning");
    lessonStep = -1;
    lessonAnnotations = [];
    screenTurn = route.rendering === "screen" || route.rendering === "both";
    screenDeadline = capturedAt + 120_000;
    if (screenTurn)
      expiry = setTimeout(
        invalidateAction,
        Math.max(0, screenDeadline - Date.now()),
      );
    let result: { lesson: Lesson };
    let completedLesson: Lesson | undefined;
    let prepared: PreparedPage | undefined;
    const planPage = (
      completed: Lesson | undefined,
      pageImage: string | undefined,
      pageSignal: AbortSignal,
      segment: (lesson: Lesson) => void,
    ) =>
      planLesson(
        { ...request, mode: route.rendering, context: route.context },
        pageImage,
        completed
          ? JSON.stringify({
              originalContext: previous,
              completedLesson: completed,
              confirmation: "model",
            })
          : previous,
        course?.vectorStoreId,
        pageSignal,
        segment,
        research,
        {
          kind: completed?.kind,
          remainingSteps: 12 - (completed?.steps.length ?? 0),
        },
      );
    // Capture the page after a verified action when no prepared page matched it.
    const readNewPage = async (sensitive: boolean) => {
      clearTracking();
      lessonAnnotations = [];
      coordinatesInvalid = true;
      image = undefined;
      if (!needsScreen || sensitive) return;
      const revision = scrollRevision;
      overlay.hide();
      try {
        const source = await captureDisplay(display, 1600);
        signal.throwIfAborted();
        if (id !== turn) throw new Error("Cancelled");
        if (!source || source.thumbnail.isEmpty())
          throw new Error(
            "Could not read the new page. Ask again when it is visible.",
          );
        if (revision !== scrollRevision)
          throw new Error(
            "The screen changed during capture. Ask again when it is ready.",
          );
        referencePixels = screenPixels(source.thumbnail);
        image = encodeScreen(source.thumbnail, 1024 * 1024);
        coordinatesInvalid = false;
        screenDeadline = Date.now() + 120_000;
        clearTimeout(expiry);
        if (screenTurn) expiry = setTimeout(invalidateAction, 120_000);
      } finally {
        if (id === turn) overlay.showInactive();
      }
    };
    while (true) {
      const completedSteps = completedLesson?.steps || [];
      let received = 0;
      const segment = (lesson: Lesson) => {
        received++;
        if (id !== turn || signal.aborted) return;
        if (completedLesson && lesson.kind !== completedLesson.kind)
          throw new Error(
            "The next page used an incompatible lesson format. Ask again to continue.",
          );
        if (completedSteps.length + lesson.steps.length > 12)
          throw new Error(
            "This lesson reached its step limit. Ask again to continue.",
          );
        activeLesson = {
          ...lesson,
          steps: [...completedSteps, ...lesson.steps],
        };
        previousLesson = JSON.stringify({
          question: request.question,
          lesson: activeLesson,
        }).slice(0, 16000);
        publishLesson();
        controls.webContents.send("teacher-segment", {
          requestId: request.requestId,
          turn: id,
          lesson: activeLesson,
        });
        prefetchSpeech();
      };
      let planned: { lesson: Lesson } | undefined;
      if (prepared) {
        const page = prepared;
        prepared = undefined;
        // Fall back to a fresh capture only if nothing from the prepared page reached playback.
        planned = await adoptPrepared(page, segment).catch((error) => {
          if (received || signal.aborted || id !== turn) throw error;
          return undefined;
        });
        if (!planned) {
          preparedSpeech?.speech.cancel();
          preparedSpeech = undefined;
          await readNewPage(false);
          controls.webContents.send(
            "teacher-progress",
            "Planning the next step",
          );
        }
      }
      result =
        planned ?? (await planPage(completedLesson, image, signal, segment));
      signal.throwIfAborted();
      if (id !== turn) throw new Error("Cancelled");
      result = {
        lesson: {
          ...result.lesson,
          steps: [...completedSteps, ...result.lesson.steps],
        },
      };
      const checkpoint = result.lesson.steps.at(-1)?.action;
      if (!checkpoint || result.lesson.steps.length >= 12) break;
      const completed = result.lesson;
      const step = completed.steps.length - 1;
      nextPage = {
        turn: id,
        step,
        plan: (pageImage, pageSignal, pageSegment) =>
          planPage(
            completed,
            pageImage,
            AbortSignal.any([signal, pageSignal]),
            pageSegment,
          ),
      };
      try {
        await waitForAction(id, step, signal);
      } finally {
        if (nextPage?.turn === id && nextPage.step === step)
          nextPage = undefined;
      }
      signal.throwIfAborted();
      if (id !== turn) throw new Error("Cancelled");
      completedLesson = completed;
      controls.webContents.send("teacher-progress", "Reading the new page");
      annotationStart = completedLesson.steps.length;
      const confirmed =
        confirmedScreen?.turn === id && confirmedScreen.step === step
          ? confirmedScreen
          : undefined;
      confirmedScreen = undefined;
      prepared =
        needsScreen && !checkpoint.sensitive
          ? preparation.take({ turn: id, step }, confirmed)
          : undefined;
      preparation.cancel();
      if (prepared) {
        // The prepared capture matched the verifying screenshot, so reuse it as the page reference.
        clearTracking();
        lessonAnnotations = [];
        referencePixels = prepared.capture.pixels;
        image = prepared.capture.image;
        coordinatesInvalid = false;
        screenDeadline = Date.now() + 120_000;
        clearTimeout(expiry);
        if (screenTurn) expiry = setTimeout(invalidateAction, 120_000);
        preparedSpeech?.speech.cancel();
        preparedSpeech = undefined;
        if (prepared.speech)
          preparedSpeech = {
            turn: id,
            index: completedLesson.steps.length,
            speech: prepared.speech,
          };
      } else await readNewPage(checkpoint.sensitive);
      controls.webContents.send("teacher-progress", "Planning the next step");
    }
    previousLesson = JSON.stringify(result.lesson).slice(0, 16000);
    recentConversation.push(
      `User: ${request.question.slice(0, 480)}`,
      `Tutor: ${result.lesson.title}. ${result.lesson.steps.at(-1)?.say || ""}`.slice(
        0,
        500,
      ),
    );
    recentConversation.splice(0, Math.max(0, recentConversation.length - 4));
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
  onScreenInput((point, kind) => {
    if (!screenTurn && !actionGate) return;
    const bounds = overlay.getBounds(),
      region = boardRegion;
    if (
      point &&
      region &&
      point.x >= bounds.x + region.x &&
      point.x <= bounds.x + region.x + region.width &&
      point.y >= bounds.y + region.y &&
      point.y <= bounds.y + region.y + region.height
    )
      return;
    if (kind === "scroll") {
      if (
        point &&
        lessonDisplay &&
        screen.getDisplayNearestPoint(point).id !== lessonDisplay.id
      )
        return;
      scheduleScrollTracking();
      preparation.screenChanged(waitingAction());
      resumeAutomaticCheck();
      return;
    }
    if (actionGate) {
      // Input may move the page, so re-find each mark on a fresh capture instead of dropping them.
      clearTimeout(autoCheckTimer);
      scheduleScrollTracking();
      if (
        point &&
        lessonDisplay &&
        screen.getDisplayNearestPoint(point).id !== lessonDisplay.id
      ) {
        preparation.screenChanged();
        actionGate.armed = false;
        controls.webContents.send("teacher-check-state", {
          turn,
          index: actionGate.step,
          complete: false,
          checking: false,
          message: "Return to the lesson display to resume checking.",
        });
      } else if (point) {
        preparation.screenChanged(waitingAction());
        const controlBounds = controls.getBounds();
        const inControls =
          controls.isVisible() &&
          point.x >= controlBounds.x &&
          point.x <= controlBounds.x + controlBounds.width &&
          point.y >= controlBounds.y &&
          point.y <= controlBounds.y + controlBounds.height;
        if (!inControls) resumeAutomaticCheck();
      } else {
        preparation.screenChanged(waitingAction());
        if ((kind === "typing" || kind === "switch") && !controls.isFocused())
          resumeAutomaticCheck();
      }
      return;
    }
    if (
      point &&
      lessonDisplay &&
      screen.getDisplayNearestPoint(point).id !== lessonDisplay.id
    )
      return;
    preparation.screenChanged();
    // Keep marks whose targets are still visible after the click or keypress.
    scheduleScrollTracking();
  });
  let interactive = false;
  const hitTest = setInterval(() => {
    if (overlay.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = overlay.getBounds();
    const region = boardRegion;
    const inside =
      !!region &&
      !!activeLesson &&
      (region.dragging ||
        (point.x >= bounds.x + region.x &&
          point.x <= bounds.x + region.x + region.width &&
          point.y >= bounds.y + region.y &&
          point.y <= bounds.y + region.y + region.height));
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
      if (actionGate && !actionGate.confirmed)
        throw new Error("Complete the current action first.");
      if (spoken.has(index) || index !== lessonStep + 1)
        throw new Error("Repeated speech request");
      spoken.add(index);
      speechAbort = new AbortController();
      const stop = AbortSignal.any([providerAbort.signal, speechAbort.signal]);
      // Use prepared audio only for the exact confirmed step and text it was made for.
      const ready = preparedSpeech;
      preparedSpeech = undefined;
      const reuse =
        !!ready &&
        ready.turn === id &&
        ready.index === index &&
        ready.speech.text === activeLesson.steps[index].say &&
        !ready.speech.failure;
      if (!reuse) ready?.speech.cancel();
      speech = {
        index,
        pulling: false,
        chunks:
          reuse && ready
            ? ready.speech.play(stop)
            : speechChunks(activeLesson.steps[index].say, stop, speechModel()),
      };
      prefetchSpeech();
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
    lessonSpeechEnabled = false;
    preparedSpeech?.speech.cancel();
    preparedSpeech = undefined;
    preparation.pending?.speech?.cancel();
    speechAbort.abort();
    void speech?.chunks.return(undefined).catch(() => {});
    speech = undefined;
  });
  // Reveal marks and create the action gate at playback time, not generation time.
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
    if (actionGate && !actionGate.confirmed)
      return { ok: false, error: "Complete the current action first." };
    if (
      screenTurn &&
      Date.now() > screenDeadline &&
      !actionGate &&
      !coordinatesInvalid
    ) {
      invalidateAction();
    }
    overlay.showInactive();
    lessonStep = index;
    // Reading mode reveals without speech, so drop audio prepared for this step.
    if (preparedSpeech && preparedSpeech.index <= index) {
      preparedSpeech.speech.cancel();
      preparedSpeech = undefined;
    }
    const checkpoint = activeLesson.steps[index].action;
    actionGate = checkpoint
      ? new ActionGate(turn, index, checkpoint)
      : undefined;
    if (actionGate) clearTimeout(expiry);
    if (checkpoint?.sensitive) clearTracking();
    lessonAnnotations = coordinatesInvalid
      ? []
      : applyDrawingStep(lessonAnnotations, activeLesson.steps[index]);
    publishLesson();
    return { ok: true };
  });
  async function checkAction(id: number, index: number, automatic = false) {
    const gate = actionGate;
    if (
      !gate ||
      gate.turn !== id ||
      id !== turn ||
      gate.step !== index ||
      gate.confirmed
    )
      return {
        complete: false,
        message: "This action is no longer waiting.",
      };
    if (
      !lessonAllowsScreen ||
      gate.action.sensitive ||
      !lessonDisplay ||
      !hasInputGuard()
    )
      return {
        complete: false,
        message:
          "Screen verification is unavailable or this step is private. Ask a new question when ready.",
      };
    if (
      process.platform === "darwin" &&
      systemPreferences.getMediaAccessStatus("screen") !== "granted"
    )
      return {
        complete: false,
        message: "Screen permission is unavailable. Enable it, then ask again.",
      };
    const revision = gate.begin();
    if (revision === undefined)
      return {
        complete: false,
        message:
          "Wait a few seconds before checking again. After five checks, ask a new question.",
      };
    checkAbort.abort();
    checkAbort = new AbortController();
    const signal = AbortSignal.any([checkAbort.signal, providerAbort.signal]);
    coordinatesInvalid = true;
    lessonAnnotations = [];
    const screenRevision = preparation.revision;
    overlay.hide();
    const controlsWereVisible = controls.isVisible();
    controls.hide();
    const ignore = teachMeRegions(lessonDisplay);
    try {
      const display = lessonDisplay;
      const source = await captureDisplay(display, 1600);
      signal.throwIfAborted();
      if (!source || source.thumbnail.isEmpty())
        throw new Error("Capture unavailable");
      const image = encodeScreen(source.thumbnail, 1024 * 1024);
      const result = await verifyAction(gate.action, image, signal);
      if (gate !== actionGate || id !== turn || signal.aborted)
        return {
          complete: false,
          message: "Screen changed. Check again when ready.",
        };
      const complete = gate.finish(revision, result);
      // Keep the verified screen so a prepared page can be matched against it.
      if (complete)
        confirmedScreen = {
          turn: id,
          step: index,
          revision: screenRevision,
          pixels: screenPixels(source.thumbnail),
          ignore,
        };
      if (complete) resumeLesson?.();
      if (result === "wrong-app" || result === "ambiguous") gate.armed = false;
      return {
        complete,
        message: complete
          ? "Screen verified."
          : result === "wrong-app"
            ? "Return to the intended app. Your next interaction will check again."
            : result === "incomplete"
              ? "Waiting for the expected result to appear."
              : "I cannot confirm the result yet. Interact with the app to retry, or ask a new question.",
      };
    } catch {
      gate.finish(revision, "ambiguous");
      if (!signal.aborted) gate.armed = false;
      return {
        complete: false,
        message:
          "Verification unavailable or screen changed. Check again or ask a new question.",
      };
    } finally {
      if (id === turn) {
        overlay.showInactive();
        publishLesson();
        if (!automatic && controlsWereVisible) controls.show();
      }
    }
  }
  ipcMain.handle("teacher-check", (event, id, index) => {
    authorize(event);
    return checkAction(id, index);
  });
  // Keep checking delayed page transitions within the same action and turn budgets.
  requestAutomaticCheck = () => {
    clearTimeout(autoCheckTimer);
    const gate = actionGate;
    if (!gate || !gate.canWatch() || automaticChecks >= 20) return;
    const id = turn;
    autoCheckTimer = setTimeout(
      async () => {
        if (
          gate !== actionGate ||
          id !== turn ||
          !gate.canWatch() ||
          automaticChecks >= 20
        )
          return;
        automaticChecks++;
        controls.webContents.send("teacher-check-state", {
          turn: id,
          index: gate.step,
          complete: false,
          checking: true,
          message: "Checking the result on screen",
        });
        const result = await checkAction(id, gate.step, true);
        if (gate !== actionGate || id !== turn) return;
        if (!result.complete && (!gate.canWatch() || automaticChecks >= 20))
          result.message +=
            " Automatic checks are paused. Ask a new question when ready.";
        controls.webContents.send("teacher-check-state", {
          turn: id,
          index: gate.step,
          checking: false,
          ...result,
        });
        if (!result.complete && gate.canWatch()) requestAutomaticCheck();
      },
      Math.max(900, 3100 - (Date.now() - gate.lastCheck)),
    );
  };
  // Verify a settled screen while narration still plays; the next step still waits for playback.
  requestEarlyCheck = () => {
    const gate = actionGate;
    if (
      !gate ||
      gate.armed ||
      gate.watchUntil ||
      gate.confirmed ||
      gate.checking ||
      controls.isVisible() ||
      automaticChecks >= 20
    )
      return;
    automaticChecks++;
    const id = turn;
    void checkAction(id, gate.step, true).then((result) => {
      if (gate !== actionGate || id !== turn) return;
      controls.webContents.send("teacher-check-state", {
        turn: id,
        index: gate.step,
        checking: false,
        ...result,
      });
    });
  };
  ipcMain.handle("teacher-watch", (event, id, index) => {
    authorize(event);
    if (
      !actionGate ||
      id !== turn ||
      actionGate.turn !== id ||
      actionGate.step !== index
    )
      return;
    // An early check during narration may already have verified this action.
    if (actionGate.confirmed) {
      controls.webContents.send("teacher-check-state", {
        turn: id,
        index,
        complete: true,
        checking: false,
        message: "Screen verified.",
      });
      return;
    }
    if (actionGate.armed) return;
    actionGate.arm();
    const gate = actionGate;
    clearTimeout(expiry);
    expiry = setTimeout(() => {
      if (gate !== actionGate || id !== turn || gate.confirmed) return;
      gate.armed = false;
      invalidateAction();
      controls.webContents.send("teacher-check-state", {
        turn: id,
        index,
        complete: false,
        checking: false,
        message:
          "Automatic checking paused after two minutes. Ask a new question when ready.",
      });
    }, 120_000);
    requestAutomaticCheck();
  });
  ipcMain.handle("teacher-source", async (event, id, url) => {
    if (
      ![controls.webContents, overlay.webContents].includes(event.sender) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Invalid sender");
    if (
      id !== turn ||
      typeof url !== "string" ||
      !publicSourceUrl(url) ||
      !activeLesson?.sources?.some((source) => source.url === url)
    )
      throw new Error("Invalid lesson source");
    await shell.openExternal(url);
  });
  ipcMain.handle("action", (event, action: unknown) => {
    if (
      ![controls.webContents, overlay.webContents].includes(event.sender) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Invalid sender");
    if (action !== "clear") throw new Error("Invalid action");
    pet.cancel();
  });
});
app.on("window-all-closed", () => app.quit());

app.on("will-quit", () => globalShortcut.unregisterAll());

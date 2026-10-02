import { app, BrowserWindow, ipcMain, screen, session } from "electron";
import path from "node:path";
import {
  Annotation,
  isAction,
  Phase,
  TeachingProvider,
  validAnnotation,
} from "./contracts";
let controls: BrowserWindow;
let overlay: BrowserWindow;
let phase: Phase = "idle";
// Replace this local provider when voice and vision integration is ready.
const mock: TeachingProvider = {
  async explain() {
    return {
      explanation:
        "Mock explanation: the arrow marks the center of this display. A future provider can explain the selected course material here.",
      annotations: [
        { kind: "arrow", x: 0.35, y: 0.35, width: 0.15, height: 0.15 },
      ],
    };
  },
};
function send(annotations: Annotation[] = []) {
  controls.webContents.send("state", { phase });
  overlay.webContents.send("drawing", annotations.filter(validAnnotation));
}
app.whenReady().then(() => {
  // Mock mode never needs microphone or screen permissions.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
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
    height: 610,
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
  // Only the control window's main frame can request these actions.
  ipcMain.handle("action", async (event, action: unknown) => {
    if (
      event.sender !== controls.webContents ||
      event.senderFrame !== controls.webContents.mainFrame ||
      !isAction(action)
    )
      throw new Error("Invalid action");
    if (action === "clear") {
      phase = "idle";
      send();
      return;
    }
    if (action === "press") {
      phase = "listening";
      send();
      return;
    }
    if (action === "highlight") {
      phase = "explaining";
      send([{ kind: "highlight", x: 0.4, y: 0.4, width: 0.2, height: 0.2 }]);
      return;
    }
    if (phase !== "listening") return;
    phase = "explaining";
    const response = await mock.explain({
      question: "Explain this screen",
      unitId: "demo",
    });
    send(response.annotations);
    controls.webContents.send("explanation", response.explanation);
  });
});
app.on("window-all-closed", () => app.quit());

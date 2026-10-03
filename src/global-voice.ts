import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  systemPreferences,
} from "electron";
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from "uiohook-napi";
import { HoldGate } from "./hold-gate";
import { transcribeSpeech } from "./providers";

export function globalVoice(
  controls: BrowserWindow,
  stop: () => void,
  status: (state: string, detail?: string) => void,
) {
  const gate = new HoldGate();
  let enabled = false,
    running = false;
  let abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    gate.cancel();
    clearTimeout(timer);
    abort.abort();
    abort = new AbortController();
    controls.webContents.send("voice-hold", "cancel");
    stop();
  };
  const relevant = new Set<number>([
    UiohookKey.Ctrl,
    UiohookKey.CtrlRight,
    UiohookKey.Shift,
    UiohookKey.ShiftRight,
    UiohookKey.Alt,
    UiohookKey.AltRight,
    UiohookKey.Meta,
    UiohookKey.MetaRight,
  ]);
  const key = (down: boolean) => (e: UiohookKeyboardEvent) => {
    if (!enabled || !relevant.has(e.keycode)) return;
    const ctrl =
      e.ctrlKey &&
      !(
        !down &&
        [UiohookKey.Ctrl, UiohookKey.CtrlRight].includes(e.keycode as any)
      );
    const shift =
      e.shiftKey &&
      !(
        !down &&
        [UiohookKey.Shift, UiohookKey.ShiftRight].includes(e.keycode as any)
      );
    const change = gate.update(ctrl, shift && !e.metaKey && !e.altKey);
    if (change === "press") {
      abort.abort();
      abort = new AbortController();
      stop();
      controls.webContents.send("voice-hold", "press");
      timer = setTimeout(() => {
        cancel();
        status(
          "Error",
          "Recording limit reached. Release Control–Shift and try again.",
        );
      }, 60_000);
    } else if (change === "release") {
      clearTimeout(timer);
      controls.webContents.send("voice-hold", "release");
    }
  };
  const down = key(true),
    up = key(false);
  const start = (requestPermission = false) => {
    if (
      process.platform === "darwin" &&
      !systemPreferences.isTrustedAccessibilityClient(requestPermission)
    ) {
      status(
        "Error",
        "Grant Accessibility to Electron/teachMe in System Settings, then choose Enable voice permissions. macOS may also require Input Monitoring.",
      );
      return;
    }
    try {
      if (!running) {
        uIOhook.on("keydown", down);
        uIOhook.on("keyup", up);
        uIOhook.start();
        running = true;
      }
      enabled = true;
      status(
        "Ready",
        "Hold Control–Shift to talk. Release any chord key to submit. The question goes to OpenAI.",
      );
    } catch {
      uIOhook.removeListener("keydown", down);
      uIOhook.removeListener("keyup", up);
      status(
        "Error",
        "Global keys could not start. Check macOS Accessibility/Input Monitoring and restart.",
      );
    }
  };
  const restore = () => start(false);
  const enable = async () => {
    if (
      process.platform === "darwin" &&
      !systemPreferences.isTrustedAccessibilityClient(false)
    ) {
      const { response } = await dialog.showMessageBox({
        message: "Allow global Control–Shift?",
        detail:
          "macOS Accessibility permission lets teachMe detect the hold shortcut outside the app. Only chord state is retained. Grant permission in System Settings yourself, then enable voice again.",
        buttons: ["Open permission request", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return;
    }
    start(true);
  };
  ipcMain.handle("voice-transcribe", async (event, bytes: unknown) => {
    if (
      event.sender !== controls.webContents ||
      event.senderFrame !== controls.webContents.mainFrame ||
      !enabled
    )
      throw Error("Enable voice from the seal menu first.");
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length < 100 ||
      bytes.length > 8 * 1024 * 1024
    )
      throw Error("Invalid recording size.");
    return transcribeSpeech(bytes, abort.signal);
  });
  const interrupt = () => {
    enabled = false;
    cancel();
    status(
      "Ready",
      "Voice paused after an interruption. Enable it again from the seal menu.",
    );
  };
  powerMonitor.on("suspend", interrupt);
  powerMonitor.on("lock-screen", interrupt);
  powerMonitor.on("resume", restore);
  powerMonitor.on("unlock-screen", restore);
  controls.on("unresponsive", interrupt);
  controls.webContents.on("render-process-gone", interrupt);
  app.on("before-quit", () => {
    cancel();
    if (running) uIOhook.stop();
  });
  return { enable, cancel, restore };
}

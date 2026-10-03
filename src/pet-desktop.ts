// Own the seal window and tray menu, and connect their controls to global voice input.
import type { PetBubble } from "./teacher-types";
import { globalVoice } from "./global-voice";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  systemPreferences,
  Tray,
} from "electron";
import path from "node:path";

export function createPet(
  controls: BrowserWindow,
  stop: (newQuestion?: boolean) => void,
) {
  const size = { width: 340, height: 420 };
  const area = screen.getPrimaryDisplay().workArea;
  const pet = new BrowserWindow({
    ...size,
    x: area.x + area.width - size.width - 30,
    y: area.y + area.height - size.height,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    focusable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  pet.once("ready-to-show", () => pet.showInactive());
  pet.setIgnoreMouseEvents(true, { forward: true });
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pet.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  pet.webContents.on("will-navigate", (e) => e.preventDefault());
  void pet.loadFile(path.join(__dirname, "index.html"), {
    query: { pet: "true" },
  });
  let bubble: PetBubble | undefined;
  let state = "Ready",
    detail = "Hold Control–Shift to talk. Right-click the seal for its menu.";
  let roaming = false,
    hovered = false,
    dragging = false,
    direction = -1;
  let tray: Tray;
  const showState = (value: string, message?: string) => {
    state = value;
    detail = message || "";
    pet.webContents.send("pet-state", state);
    pet.webContents.send("pet-detail", detail);
    tray?.setToolTip(`teachMe: ${message || state}`);
  };
  const clamp = () => {
    const bounds = pet.getBounds(),
      workArea = screen.getDisplayMatching(bounds).workArea;
    pet.setPosition(
      Math.round(
        Math.max(
          workArea.x,
          Math.min(bounds.x, workArea.x + workArea.width - bounds.width),
        ),
      ),
      Math.round(
        Math.max(
          workArea.y,
          Math.min(bounds.y, workArea.y + workArea.height - bounds.height),
        ),
      ),
    );
  };
  const voice = globalVoice(controls, stop, showState);
  controls.webContents.once("did-finish-load", () => voice.restore());
  const cancel = () => {
    voice.cancel();
    bubble = undefined;
    pet.webContents.send("pet-bubble", null);
    showState("Ready");
  };
  const openFiles = () => {
    controls.webContents.send("show-course-files");
    controls.show();
    controls.focus();
  };
  const menu = () =>
    Menu.buildFromTemplate([
      { label: "Stop & clear", click: cancel },
      {
        label: "Wander",
        type: "checkbox",
        checked: roaming,
        click: (item) => {
          roaming = item.checked;
        },
      },
      {
        label: "Move seal to pointer",
        click: () => {
          roaming = false;
          const pointer = screen.getCursorScreenPoint();
          pet.setPosition(
            pointer.x - size.width / 2,
            pointer.y - size.height + 84,
          );
          clamp();
        },
      },
      { label: "Eat my files…", click: openFiles },
      { label: "Enable voice permissions…", click: () => void voice.enable() },
      {
        label: "Status…",
        click: () => void dialog.showMessageBox({ message: state, detail }),
      },
      { type: "separator" },
      { label: "Quit teachMe", click: () => app.quit() },
    ]);
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  );
  tray = new Tray(icon);
  tray.setTitle("🦭");
  tray.setToolTip("teachMe");
  tray.on("click", () => tray.popUpContextMenu(menu()));
  tray.on("right-click", () => tray.popUpContextMenu(menu()));
  ipcMain.handle("pet-command", (event, command: unknown, value: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) return;
    const isPet = event.sender === pet.webContents;
    if (!isPet && event.sender !== controls.webContents) return;
    if (
      command === "level" &&
      !isPet &&
      typeof value === "number" &&
      Number.isFinite(value)
    )
      pet.webContents.send("pet-level", Math.max(0, Math.min(1, value)));
    if (command === "close-files" && !isPet) controls.hide();
    if (command === "bubble" && !isPet && value && typeof value === "object") {
      const next = value as PetBubble;
      if (
        !Number.isSafeInteger(next.operation) ||
        typeof next.status !== "string" ||
        typeof next.text !== "string"
      )
        return;
      bubble = next;
      showState(next.error ? "Error" : next.status, next.error);
      pet.webContents.send("pet-bubble", bubble);
    }
    if (
      command === "bubble-action" &&
      isPet &&
      value &&
      typeof value === "object"
    ) {
      const intent = value as {
        action?: string;
        operation?: number;
        safeScreen?: boolean;
        url?: string;
      };
      if (intent.action === "end") {
        cancel();
        return;
      }
      if (
        intent.operation !== bubble?.operation ||
        !["continue", "manual", "check", "source"].includes(intent.action || "")
      )
        return;
      controls.webContents.send("teacher-bubble-action", intent);
    }
    if (!isPet) return;
    if (command === "ready") {
      showState(state, detail);
      pet.webContents.send("pet-bubble", bubble || null);
    }
    if (command === "menu") menu().popup({ window: pet });
    if (command === "hover" && typeof value === "boolean") {
      hovered = value;
      pet.setIgnoreMouseEvents(!value, { forward: true });
    }
    if (command === "drag" && typeof value === "boolean") {
      dragging = value;
      if (value) roaming = false;
    }
    if (
      command === "move" &&
      dragging &&
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => Number.isFinite(n) && Math.abs(n) < 1000)
    ) {
      const [x, y] = pet.getPosition();
      pet.setPosition(Math.round(x + value[0]), Math.round(y + value[1]));
      clamp();
    }
  });
  const timer = setInterval(() => {
    if (
      pet.isDestroyed() ||
      systemPreferences.getAnimationSettings().prefersReducedMotion ||
      !roaming ||
      hovered ||
      dragging ||
      state !== "Ready" ||
      !!bubble?.text
    )
      return;
    const bounds = pet.getBounds(),
      workArea = screen.getDisplayMatching(bounds).workArea;
    if (bounds.x <= workArea.x + 8) direction = 1;
    if (bounds.x + bounds.width >= workArea.x + workArea.width - 8)
      direction = -1;
    pet.setPosition(bounds.x + direction, bounds.y);
    pet.webContents.send("pet-direction", direction);
    clamp();
  }, 70);
  screen.on("display-metrics-changed", clamp);
  screen.on("display-removed", clamp);
  app.on("before-quit", () => {
    clearInterval(timer);
    tray.destroy();
  });
  return { cancel };
}

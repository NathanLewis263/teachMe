import { contextBridge, ipcRenderer } from "electron";
// Expose a small bridge instead of giving React access to Electron.
contextBridge.exposeInMainWorld("teachMe", {
  browse: (turn: number, index: number) =>
    ipcRenderer.invoke("board-browse", turn, index),
  boardRegion: (region: unknown) => ipcRenderer.send("board-region", region),
  petCommand: (command: string, value?: unknown) =>
    ipcRenderer.invoke("pet-command", command, value),
  transcribe: (bytes: Uint8Array) =>
    ipcRenderer.invoke("voice-transcribe", bytes),
  teacherStatus: () => ipcRenderer.invoke("teacher-status"),
  displays: () => ipcRenderer.invoke("displays"),
  plan: (request: unknown) => ipcRenderer.invoke("teacher-plan", request),
  stopSpeech: (turn: number) => ipcRenderer.invoke("teacher-speech-stop", turn),
  speech: (turn: number, step: number) =>
    ipcRenderer.invoke("teacher-speech", turn, step),
  step: (turn: number, index: number) =>
    ipcRenderer.invoke("teacher-step", turn, index),
  action: (action: string) => ipcRenderer.invoke("action", action),
  subscribe: (channel: string, callback: (value: unknown) => void) => {
    if (
      ![
        "pet-state",
        "pet-level",
        "pet-direction",
        "voice-hold",
        "teacher-progress",
        "teacher-segment",
        "teacher-cancel",
        "lesson-clear",
        "lesson",
      ].includes(channel)
    )
      throw new Error("Invalid channel");
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

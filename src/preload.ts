// React talks to Electron through this bridge; main still checks who sent each request.
import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("teachMe", {
  openSource: (turn: number, url: string) =>
    ipcRenderer.invoke("teacher-source", turn, url),
  watch: (turn: number, index: number) =>
    ipcRenderer.invoke("teacher-watch", turn, index),
  confirm: (turn: number, index: number) =>
    ipcRenderer.invoke("teacher-confirm", turn, index),
  check: (turn: number, index: number) =>
    ipcRenderer.invoke("teacher-check", turn, index),
  browse: (turn: number, index: number) =>
    ipcRenderer.invoke("board-browse", turn, index),
  boardRegion: (region: unknown) => ipcRenderer.send("board-region", region),
  petCommand: (command: string, value?: unknown) =>
    ipcRenderer.invoke("pet-command", command, value),
  transcribe: (bytes: Uint8Array) =>
    ipcRenderer.invoke("voice-transcribe", bytes),
  teacherStatus: () => ipcRenderer.invoke("teacher-status"),
  course: (action: string) => ipcRenderer.invoke("course", action),
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
        "pet-detail",
        "pet-bubble",
        "teacher-bubble-action",
        "show-course-files",
        "pet-level",
        "pet-direction",
        "voice-hold",
        "teacher-progress",
        "teacher-segment",
        "teacher-cancel",
        "teacher-check-state",
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

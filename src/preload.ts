import { contextBridge, ipcRenderer } from "electron";
// Expose a small bridge instead of giving React access to Electron.
contextBridge.exposeInMainWorld("teachMe", {
  realtimeStatus: () => ipcRenderer.invoke("realtime-status"),
  connect: (offer: string) => ipcRenderer.invoke("realtime-connect", offer),
  begin: () => ipcRenderer.invoke("realtime-begin"),
  draw: (turn: number, scene: unknown) => ipcRenderer.invoke("realtime-draw", turn, scene),
  lesson: (turn: number, lesson: unknown) => ipcRenderer.invoke("realtime-lesson", turn, lesson),
  step: (turn: number, index: number) => ipcRenderer.invoke("realtime-step", turn, index),
  capture: (turn: number, maxBytes: number) => ipcRenderer.invoke("realtime-capture", turn, maxBytes),
  action: (action: string) => ipcRenderer.invoke("action", action),
  subscribe: (channel: string, callback: (value: unknown) => void) => {
    if (!["state", "drawing", "explanation", "lesson"].includes(channel))
      throw new Error("Invalid channel");
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

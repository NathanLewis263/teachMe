import { contextBridge, ipcRenderer } from "electron";
// Expose a small bridge instead of giving React access to Electron.
contextBridge.exposeInMainWorld("teachMe", {
  action: (action: string) => ipcRenderer.invoke("action", action),
  subscribe: (channel: string, callback: (value: unknown) => void) => {
    if (!["state", "drawing", "explanation"].includes(channel))
      throw new Error("Invalid channel");
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

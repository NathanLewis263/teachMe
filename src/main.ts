import { app, BrowserWindow } from 'electron';
import path from 'node:path';
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 480, height: 360, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  void window.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());

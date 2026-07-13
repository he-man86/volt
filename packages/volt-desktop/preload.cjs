// Bridge for the frameless titlebar + the IDE panel. CJS so it works under Electron's default sandbox.
const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("volt", {
  // window controls
  minimize: () => ipcRenderer.send("win:minimize"),
  maximize: () => ipcRenderer.send("win:maximize"),
  close: () => ipcRenderer.send("win:close"),
  // IDE panel
  togglePanel: (open) => ipcRenderer.send("volt:togglePanel", open),
  onStatus: (cb) => ipcRenderer.on("volt:status", (_e, snap) => cb(snap)),
  pull: () => ipcRenderer.invoke("volt:pull"),
  push: () => ipcRenderer.invoke("volt:push"),
  build: () => ipcRenderer.invoke("volt:build"),
  refresh: () => ipcRenderer.send("volt:refresh"),
  refreshDiagnostics: () => ipcRenderer.send("volt:refreshDiagnostics"),
  onDiagnostics: (cb) => ipcRenderer.on("volt:diagnostics", (_e, d) => cb(d)),
  initWorkspace: (vendor) => ipcRenderer.invoke("volt:init", vendor),
})

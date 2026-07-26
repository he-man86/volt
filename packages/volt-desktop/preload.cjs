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
  connect: () => ipcRenderer.invoke("volt:connect"),
  disconnect: () => ipcRenderer.invoke("volt:disconnect"),
  rebind: (projectId) => ipcRenderer.invoke("volt:rebind", projectId),
  forcePull: () => ipcRenderer.invoke("volt:forcePull"),
  forcePush: () => ipcRenderer.invoke("volt:forcePush"),
  finishMerge: () => ipcRenderer.invoke("volt:finishMerge"),
  abortMerge: () => ipcRenderer.invoke("volt:abortMerge"),
  mergeResolve: (path, side) => ipcRenderer.invoke("volt:mergeResolve", path, side),
  refresh: () => ipcRenderer.send("volt:refresh"),
  refreshDiagnostics: () => ipcRenderer.send("volt:refreshDiagnostics"),
  onDiagnostics: (cb) => ipcRenderer.on("volt:diagnostics", (_e, d) => cb(d)),
  initWorkspace: (projectId) => ipcRenderer.invoke("volt:init", projectId),
  pickFolder: () => ipcRenderer.invoke("volt:pickFolder"),
  diff: (workspaceRoot, relPath, name, direction) => ipcRenderer.invoke("volt:diff", workspaceRoot, relPath, name, direction),
  openFile: (path) => ipcRenderer.invoke("volt:openFile", path),
  onProgress: (cb) => ipcRenderer.on("volt:progress", (_e, p) => cb(p)),
})

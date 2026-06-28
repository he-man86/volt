## 1. Implementation (shipped)

- [x] 1.1 Extract `volt-control` (UI-agnostic CLI/bridge driver) — phase 1
- [x] 1.2 `VoltPanel` as a persistent "⚡ Volt" tab in the session panel — phase 2
- [x] 1.3 Electron IPC (`window.volt`) → panel drives `volt-control` — phase 3

## 2. Review + capture

- [x] 2.1 Verify the thin-surface contract (Incoming `VOLTIDE↔BRIDGE` / Outgoing `VOLTIDE↔WORKSPACE`; git axis delegated)
- [x] 2.2 Author `specs/desktop-panel/spec.md`
- [x] 2.3 `openspec validate review-desktop-panel`

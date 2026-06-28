## 1. Rename (desktop-panel → editor-surface)

- [x] 1.1 Carry the 4 core requirements forward, renderer-neutral, under `editor-surface` (ADDED)
- [x] 1.2 Remove the 4 `desktop-panel` requirements (REMOVED) with Reason + Migration

## 2. Add the VS Code extension contracts

- [x] 2.1 Workspace detection by `.git/volt/config.json`
- [x] 2.2 Explorer drift decorations (`i`/`o`/`C`/`RO`, distinct from git)
- [x] 2.3 Worst-state-wins status item + Start Bridge
- [x] 2.4 `volt://` ref content provider + live health probing

## 3. Validate

- [x] 3.1 `openspec validate expand-editor-surface`

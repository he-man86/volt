# Tasks

> **STATUS — CORE BUILT + PROVEN (this session).** `packages/volt-git/volt-config/` ships via `dist.ts` → `dist/volt/volt-config/` (plugin vendored, one bundle); the desktop (`main/index.ts`) + the `volt` binary (`volt.ts`) set `OPENCODE_CONFIG_DIR` + PATH; `volt init` no longer writes per-project `.opencode`; dead code deleted (`opencode-config.ts`, the `OPENCODE_PLUGIN_VERSION` pin, `resolveBin`). **Proven:** a no-`.opencode` project + a compiled `volt-lsp-codesys.exe` as the only copy on PATH + the real config dir → live `volt-lsp-codesys` diagnostics. `check-volt-integration` + `check-divergence` green. **Remaining:** ship `st-reference` globally (optional), one full installer smoke build (final acceptance), doc polish.

## Spike (de-risk before building)
- [x] **LSP bare-name spawn — CONFIRMED.** `lsp.ts:174` → `./launch` `spawn` → `util/process.ts:3` uses **`cross-spawn`**, which PATH/PATHEXT-resolves a bare command on Windows. So `["volt-lsp-codesys","--stdio"]` works off the installer's PATH → **the config dir ships static, no absolute path, no first-run write.** (Same for `VOLT_BIN` = bare `volt`.)
- [x] **Env passthrough — PROVEN by PoC.** A temp project with **no `.opencode`** + an LSP config supplied ONLY via `OPENCODE_CONFIG_DIR` → `opencode debug lsp diagnostics` returned real `volt-lsp-codesys` diagnostics (planted `;` error + undefined `y`). opencode reads the env dir, loads its `opencode.json`, spawns the LSP. (Remaining at wiring time: confirm the desktop's `preferAppEnv` fork doesn't strip the var — trivial, we build the env object.)

## Build the shipped config dir
- [ ] Create one template that generates `volt-config/` (opencode.json LSP+permission, `tool/volt.ts`, `agent/volt.md`, `themes/volt.json`) — single source for both this dir AND the dev-repo `.opencode/` (no drift).
- [ ] Vendor `@opencode-ai/plugin` into `volt-config/node_modules/@opencode-ai/plugin` (bundle → 1 file, zod inlined) in `dist.ts`.
- [ ] `electron-builder.config.ts` + `dist.ts`: ship `volt-config/` under `resources/volt/`.

## Wire `OPENCODE_CONFIG_DIR`
- [ ] Desktop: set it on the sidecar fork env (`desktop/src/main/server.ts`) → `resources/volt/volt-config`.
- [ ] CLI/TUI: the `volt` launcher exports it (sibling-of-binary resolve) before the opencode handoff.
- [ ] If the spike chose fallback: desktop writes `volt-config/opencode.json` at first-run with resolved absolute paths.

## Shrink `volt init`
- [ ] `writeOpencodeConfig`: delete the `.opencode/{opencode.json, tool/volt.ts, package.json}` writes + the `bun/npm install`. Keep only what's per-project elsewhere (the `.git/volt` binding + skills already live in `init.ts`/`installCorpus`).
- [ ] Remove the now-dead `OPENCODE_PLUGIN_VERSION` pin path if nothing else uses it.

## Cleanup — delete (audited, file:line)
- [ ] `OPENCODE_PLUGIN_VERSION` pin → `volt-scripts/build.ts:44-47,83` + `volt-git/src/opencode-config.ts:19-24` (dead once plugin vendored)
- [ ] Per-project `.opencode/package.json` + `bun/npm install` → `opencode-config.ts:139-158`
- [ ] `resolveBin` helper + call sites → `opencode-config.ts:40-47,117-118` (dead once bare-name everywhere)
- [ ] Dev-repo `tool/volt.ts` twin + the generator `toolSource()` → one shipped template feeds both (`opencode-config.ts:49-112,134-137` + `.opencode/tool/volt.ts`)
- [ ] `.env` `OPENCODE_CHANNEL` remnant — channel is now an in-code default; remove
- [ ] Archive stale openspec: `tighten-upstream-cadence` (SUPERSEDED), `pin-stable-ui-channel` (IMPLEMENTED)

## Extensions (audited — fold in)
- [ ] Ship `st-reference` skill ONCE globally (`~/.claude/skills/` or the config-dir `skill/`) — drop the per-project write (`volt-lsp-codesys/src/init.ts:46`)
- [ ] Generated `volt` tool: bare-name `VOLT_BIN = "volt"` (PATH) like the LSP
- [ ] Move `tui.json` theme-select into the config dir (drops seam #2 → floor 16→15)

## Verify
- [ ] Fresh project, NO `volt init`, opened in the Volt desktop: `.st` gets LSP diagnostics/nav + the `volt` tool loads + the agent/theme are present.
- [ ] Offline / proxied machine: same works (plugin vendored, no registry).
- [ ] `volt init` still binds the IDE + installs vendor skills.
- [ ] `check-divergence` clean (desktop env-set rides the existing IPC seam).

## Docs
- [ ] CLAUDE.md "Volt architecture" — the agent toolchain registers via one shipped `OPENCODE_CONFIG_DIR`; `volt init` = IDE binding + skills only.
- [ ] Mark `harden-opencode-integration` Step 0 plugin-vendoring as folded into this change.

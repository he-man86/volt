# Tasks

## Spike (de-risk before building — both have safe fallbacks)
- [ ] **LSP bare-name spawn:** read `packages/opencode/src/lsp/lsp.ts:160-181`; does the spawn PATH-resolve a bare `volt-lsp-codesys` on Windows (Bun.spawn / child_process semantics)? → picks bare-name (static dir) vs resolved-at-first-run.
- [ ] **Env passthrough:** set `OPENCODE_CONFIG_DIR` to a temp dir with an `opencode.json` LSP entry, launch the volt binary against a `.st` project, confirm the LSP loads (`opencode debug` / log). Proves the env hook end-to-end before wiring the desktop.

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

## Verify
- [ ] Fresh project, NO `volt init`, opened in the Volt desktop: `.st` gets LSP diagnostics/nav + the `volt` tool loads + the agent/theme are present.
- [ ] Offline / proxied machine: same works (plugin vendored, no registry).
- [ ] `volt init` still binds the IDE + installs vendor skills.
- [ ] `check-divergence` clean (desktop env-set rides the existing IPC seam).

## Docs
- [ ] CLAUDE.md "Volt architecture" — the agent toolchain registers via one shipped `OPENCODE_CONFIG_DIR`; `volt init` = IDE binding + skills only.
- [ ] Mark `harden-opencode-integration` Step 0 plugin-vendoring as folded into this change.

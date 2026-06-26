# @opencode-ai/volt-control

UI-agnostic core that **drives the `volt` CLI / bridge** — `status` / `push` / `pull` / `build` /
health / workspace detection. It contains **no UI framework code**, so it can be rendered by both
`volt-vscode` (VS Code tree views) and `volt-app` (a Solid panel in the opencode desktop app).

> **Status — Phase 1 done.** The full UI-agnostic core lives here: the primitives
> (`cli` · `types` · `workspace` · `gate` · `health`) **and** the actions
> (`fetchStatus` · `pull` · `push` · `build` · `init` · `mergeCmd` · `showFile` + the `PullOutcome`/
> `PushOutcome`/`StatusResult` contracts). `volt-vscode` consumes all of it — no UI logic
> duplicated (typecheck ✓, 13 tests ✓, extension build ✓).
> **Next:** `volt-app` renders this same core as a Solid panel (Phase 3, via the GUI `<Slot/>` in
> Phase 2). Distinct from `@opencode-ai/volt-cli` — that's the CLI *binary*; this *spawns and parses* it.

```
        @opencode-ai/volt-control   (drives volt CLI/bridge — no UI)
        ├─ rendered by  volt-vscode  → VS Code tree views   (exists)
        └─ rendered by  volt-app     → Solid panel in desktop (Phase 3)
```

## Phase 1 — extraction (step by step)

`volt-vscode`'s core is already cleanly separable (verified). The work is *moving* the pure parts
here and *splitting* the two vscode-coupled files.

**Extraction map:**

| `volt-vscode/src` file | Coupled to `vscode`? | Action |
|---|---|---|
| `cli.ts` (`spawnVolt`, `spawnVoltBuffer`) | no | **move verbatim** → `src/cli.ts` |
| `workspace.ts` (detection) | no | **move verbatim** → `src/workspace.ts` |
| `state/health.ts` (`probeHealth`, `readBridgePort`, `isBridgeOnline`) | no | **move verbatim** → `src/health.ts` |
| `gate.ts` (`withGate`) | no | **move verbatim** → `src/gate.ts` |
| `types.ts` (`StatusJson`, …) | no | **move verbatim** → `src/types.ts` |
| `state/status.ts` | **yes** (status-bar/events) | **split**: status *fetch/parse* (uses `cli` + `health`) → here as `getStatus()`; the `vscode.StatusBarItem`/event wiring stays in `volt-vscode` |
| `commands.ts` | **yes** (command registration) | **split**: the *actions* (`push`/`pull`/`build` via `cli`) → here; `vscode.commands.registerCommand(...)` stays in `volt-vscode` |

**Steps:**
1. **Move the 5 pure files** into `src/`. They import only `node:*` — no changes needed.
2. **Refactor `status.ts`:** pull the `spawnVolt('status --json')` + parse + health-merge into
   `getStatus(ctx)` here; leave the status-bar rendering in `volt-vscode` (it now calls `getStatus`).
3. **Refactor `commands.ts`:** move the action bodies into `push()`/`pull()`/`build()` here (wrapped
   in `withGate`); `volt-vscode`'s `registerCommand` handlers become one-liners that call these.
4. **Finalize the public API** in `src/index.ts` (replace the throwing stubs with the moved code).
5. **Re-point `volt-vscode`:** `import { … } from "@opencode-ai/volt-control"` instead of `./cli`,
   `./state/status`, etc. Add `"@opencode-ai/volt-control": "workspace:*"` to its deps.
6. **Build setup:** add `tsconfig.json` + `"build": "tsc"` + `"typecheck"` / `"test"` scripts
   (mirror `volt-cli`). `dist/` is what `volt-vscode`/`volt-app` consume in production.

## Public API (target — see `src/index.ts`)

`detectWorkspace(cwd)` · `getHealth(ctx)` · `getStatus(ctx)` · `pull(ctx, flags?)` ·
`push(ctx, flags?)` · `build(ctx)` · types `StatusJson`, `HealthState`, `VoltContext`.

## Verify (Phase 1 exit)

- `bun --cwd packages/volt-vscode run build` succeeds; its tests pass (it now sources `volt-control`).
- `bun --cwd packages/volt-control test` — unit tests for `getStatus`/`push`/… against a fake `volt`.
- `bun run volt-scripts/check-divergence.ts` — clean (both packages are fork-owned).

No upstream files are touched in Phase 1.

# Design: rate every opencode injection, harden simplest-first

## Model: the installer is plain opencode + layers of Volt
Build it from the **base up**. The base — opencode's own GUI + CLI + embedded server — ships as-is (we don't touch its features, only its build *channel*). On top sit the Volt injections, which vary in how cleanly they attach. We validate/harden from the base upward; the point where a layer stops being additive is where the integration is structurally shaky.

## Integration tiers (cleanest → shakiest)
| Tier | Mechanism | Survives a merge? | Examples |
|---|---|---|---|
| **0 — Plain opencode** | opencode's own features, shipped unmodified (only the build *channel* is pinned). | n/a (it IS upstream) | the GUI app, the CLI, the embedded server |
| **1 — Hook (additive)** | opencode's extension points: auto-discovered files, deep-merged config. No upstream edit. | Always | `.opencode/opencode.json` (LSP + permissions), `.opencode/tool/volt.ts`, `.opencode/agent/*`, `.opencode/themes/*` |
| **2 — Cold seam (1-line)** | A minimal edit to a rarely-touched opencode file. | Almost always | tui.json theme, index.html titles, logo.tsx, deep-links scheme, **the channel default** |
| **3 — Additive seam** | Appended/wrapped code in a moderate opencode file (no interleave). | Usually | desktop preload `window.volt` (EOF), main IPC (wrapped), electron.vite volt input, electron-builder branding + extraFiles |
| **4 — Hot interleave** | An edit interleaved through a HOT opencode file's logic. | Conflicts often | **session.tsx** (8 touch points, 315 commits/6mo) |
| **5 — Build/runtime workaround** | A mitigation for an opencode constraint that has no hook. | Needs a guard | **spinner** value-reference (dynamic-import tree-shake), **plugin** resolution |

## Assessment + action (from the two audits)
**Tier 0 — plain opencode.** Ships fine EXCEPT the GUI defaults to opencode's unreleased **V2** layout: `app/vite.js` + `electron.vite.config.ts` default the channel to `"dev"`. We want the stable **V1**. → **harden first** (a Tier-2 fix on the base).

**Tier 1 — clean, leave as-is.** LSP / permissions / tool / agent / themes via `.opencode/*`. Survive any merge. ✓

**Tier 2 — cold seams.** Branding (logo / titles / theme / scheme) minimal + irreducible white-label cost. The **channel** is the one Tier-2 problem solved the WRONG way (a gitignored `.env`): → **flip the in-code default `"dev"→"prod"`** in `electron.vite.config.ts` (already a seam) + `app/vite.js` (new 16th seam). Deterministic; no env reliance.

**Tier 3 — additive seams, sound.** preload / main IPC / vite input / builder config — additive on cold/moderate files. ✓ Leave.

**Tier 5 — build/runtime workarounds.**
- **Spinner** — AUDITED SOUND. The only tree-shake-vulnerable registration; the value-reference is deterministic; a static-entry root fix is infeasible (opencode's `index.ts` self-runs the CLI on import, no command hook). → keep; the `dist.ts` grep guard stays.
- **Plugin** — currently a runtime `bun/npm install` at `volt init` → breaks offline / no-package-manager (real for air-gapped PLC machines). → **vendor `@opencode-ai/plugin`** into the install resources + copy into `.opencode/node_modules` at init (exactly like the LSP / connector / vsix already are).

**Tier 4 — the (former) ceiling, now cheap.** `session.tsx`'s "IDE" changes-source *was* 8 edits interleaved through opencode's hottest file — but only because we made it a NATIVE peer of git/branch/turn inside opencode's changes-dropdown. **Decision: re-implement as a self-owned `VoltIdePanel`** in `volt-app`, mounted with ONE line beside `<SessionSidePanel/>` (`session.tsx:1859`). The panel owns its toggle, runs `ideQuery` over the existing `window.volt` IPC, and renders diffs by importing `@opencode-ai/ui` diff rows (additive). Net: **−8 interleaves, +1 mount line**, zero upstream dependency — the diff-viewer is already generic, so the logic just moves out of opencode's file into `volt-app`. **Tradeoff:** a Volt-owned panel *alongside* opencode's changes panel, not an entry *inside* its native dropdown — same function. (An upstream `registerChangeSource()` hook would make even the 1 line additive, but that's a bet on opencode; the self-owned panel is the ship-now answer.)

## Build-up sequence (the execution — zero-drift → full; verify EVERY step)
**Rule:** add the override → `check-divergence` names the exact new drift → build the installer → confirm 100% functional → commit. Never advance on a red step.

| # | Step | Override(s) added to opencode's packages | Drift after |
|---|---|---|---|
| **0** | **Additive product** (the floor) | none — `volt-*` packages + `.opencode/` only | **0 files** |
| **1** | **One-installer bundling** | `electron-builder.config.ts` (ship the product + `Programs\Volt` dir + updater feed) + `desktop/package.json` deps + the NSIS scripts (PATH, vscode sideload, connector) | structural only |
| **2** | **Stable UI channel (V1)** | `app/vite.js` + `electron.vite.config.ts` default → prod | +channel — **done (Task 1)** |
| **3** | **Branding** | `logo.tsx`, app name (`main/index.ts`), window titles (×2 html), brand theme (`tui.json`) | +branding |
| **4** | **Desktop IDE-changes panel** (self-owned) | `window.volt` IPC (`preload` + `main`) + **one** mount line in `session.tsx` (`<VoltIdePanel/>` — all logic lives in `volt-app`) | +IPC + 1 line |
| **5** | **Deep-link scheme** | `deep-links.ts` (`volt://`) | +scheme |

**First release = Step 1:** stock opencode GUI + the full bundled volt product; the ONLY opencode drift is the structural bundling. Behavioral overrides (3-5) layer on + are verified after.

**Honest caveat:** Step 0 (the product) is genuinely **0 drift** and fully functional — the `volt` binary is *built from* opencode source without changing an opencode file; the LSP/connector/vscode are `volt-*` packages; `.opencode/` is opencode's own hook. A single bundled installer needs Step 1's structural override — that's the irreducible floor for one package.

**Quality fixes fold into the steps, not a separate ladder:** the `@opencode-ai/plugin` vendoring (offline-safe `volt init`) is **Step 0** (the product must work standalone); the `<spinner>` value-reference + `dist.ts` guard are **Step 0** build-hardening (audited sound — keep); the doc/seam-count cleanup rode **Step 2** (done). `session.tsx` (Step 4) is no longer the ceiling — the self-owned `VoltIdePanel` cuts it from 8 interleaves to 1 mount line with no upstream dependency.

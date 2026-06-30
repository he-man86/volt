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

**Tier 4 — the ceiling.** `session.tsx` — the "IDE" changes-source, 8 edits interleaved through opencode's hottest file. Irreducible to additive (no GUI change-source hook). → accept short-term; long-term an upstream `registerChangeSource()` slot collapses 8 conflict sites to 1. **This is where the integration is structurally shaky — and it's upstream's to fix, not ours.**

## Ladder (execution — bottom-up; build + smoke the installer after each)
1. **Channel** (Tier 0/2) — make the plain opencode GUI ship stable V1 via an in-code default. *Build → confirm V1, no env.*
2. **Plugin** (Tier 5) — vendor it; offline-safe init. *Build → confirm init with no PM.*
3. **Spinner** (Tier 5) — confirm the guard; no change.
4. **Docs / cleanup** — seam count (15), deep-links wording, dead pre-push line.
5. **session.tsx** (Tier 4) — the ceiling; draft the upstream hook proposal.

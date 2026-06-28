# VOLT-PLAN — roadmap & status

The forward-looking companion to **[VOLT-DESIGN.md](./VOLT-DESIGN.md)** (architecture + decision log).
DESIGN is *why & what*; this file is *status & when* — what's shipped, what's next, and the open product
decisions. Keep design rationale in DESIGN; keep phases/status here.

## Current status (shipped)

The PLC toolchain and the git-native sync model are built and tested; the commercial cloud track is next.

- **Git-native sync engine** (`volt-git`) — the live IDE is a git remote-tracking branch
  (`refs/remotes/volt/ide`); `pull`/`push` reconcile through native `git merge` (no custom 3-way engine),
  auto-commit on push/pull, `status`/diff read the working tree. One declarative `set`/`delete` push wire;
  machine-local state in `.git/volt/`. Tested mock + live against CODESYS (8556) and TwinCAT (8555). See **D11**.
- **VG (Volt Graphical)** — editable FBD/LD bodies round-trip as Volt's own textual language (the bridge is
  the source of truth); CFC/SFC read-only. `volt-lsp-codesys` analyzes it as a first-class sublanguage;
  `volt-vscode` highlights it by content-injection (the `NETWORK` token, incl. graphical methods inlined in a
  `.st` POU). See **D12**.
- **LSP** (`volt-lsp-codesys`) — the CODESYS/TwinCAT language server (ST + VG + the declaration kinds) off the
  embedded CODESYS reference. Full LSP feature set, every feature now with graphical-body test coverage, plus a
  `vg-undefined-label` quick-fix. Vendor-keyed naming — a new LSP is a new vendor. See **D13**.
- **UI** — `volt-vscode` + the desktop `volt-app`/`volt-control` are a thin **IDE-sync surface**: bridge
  health, incoming/outgoing drift, and the two diffs against the last sync (Incoming `VOLTIDE↔BRIDGE`, Outgoing
  `VOLTIDE↔WORKSPACE`). The git axis (history, working-tree edits, merge) delegates to the editor's built-in Git.
- **Packages** — all seven `volt-*` have standardized, code-grounded READMEs; package names aligned to their
  directories (`@opencode-ai/volt-bridge`, `volt-lsp-codesys`, …).

**Verify:** `bun volt-scripts/sync.ts` (the fork-signal flow) · per-package `bun test` + `bunx tsgo --noEmit`
· live: `pwsh volt-scripts/codesys-bridge.ps1 up` (CODESYS 8556) or the Beckhoff bridge (8555).

## Next steps

1. **Commercial cloud (W5 → W6)** — the revenue path: `volt-web` landing + signup, then deploy the reused
   cloud (the `llm` gateway + `console-core` billing + Stripe + a "Volt" hosted-provider entry at
   `api.volt.ai`). Mostly config + deploy, not new code (see the phase table + decisions below).
2. **Desktop distribution (Phase B)** — code-signing + updater feed + release (logo + app name already done).
3. **Connector installer** — the native Windows installer (Connector + the C# bridges) is being reworked.

## Open product decisions

| Decision | Choice | Notes |
|---|---|---|
| **What Volt sells** | ★ **hosted AI subscriptions** (opencode Go/Zen-style) | reuse the in-repo gateway (`llm`) + billing (`console-core`); PLC tools (`volt-*`) stay free |
| **Where metering lives** | **server-side, reused backend** | `console-core` `UsageTable`/`LiteTable` + `log-processor`; **no `volt-git` gate** |
| **Billing shape** | **metered credits + subscription** | reuse `console-core` + Stripe **as-is**; your products/prices via `infra/` config |
| **Platform** | **Windows-first** | bridges are Windows-only; PLC work is Windows-centric. Remote bridge later |
| **`<Slot/>`** | **try upstream first** | one local seam only if rejected |
| **MVP** | **deploy the reused cloud** (gateway + `console-core` + Stripe) + a Volt provider entry | it's the product; mostly **config + deploy, not new code** |

> **Trade-off of the AI-reseller model (eyes open):** you hold the provider keys and **front the model
> cost**, so your sub price must beat real usage — the `LiteTable` weekly/rolling limits are exactly the
> throttle for that. Heavier **ops** than a license key (running a billed gateway: keys, abuse limits,
> reconciliation), but it's **reuse + deploy, not build**.

## Phased build plan

Tracks: **W5→W6** = commercial (**your revenue path** — deploy the reused cloud) · **1→2→3** = desktop panel
(polish) · **B** = branding+distribution. Only 1→2→3 is strictly ordered.

| Phase | Goal | Packages / files | Seams | Inputs you provide | Verify |
|---|---|---|---|---|---|
| **0 ✅** | Additive integration foundation | `.opencode/*`, verifiers, package map, this doc | none | — | ✅ done |
| **0.5 ✅** | **License/attribution** — keep opencode's MIT notice + add a Volt `NOTICE` | `NOTICE` | none | — | ✅ done |
| **W5** | `volt-web` landing + signup | `packages/volt-web` (steps in its README) | none | branding/copy, domain | site renders; signup via `console-core` |
| **W6** | **Deploy the revenue cloud** — Volt `infra/`: `llm` gateway + `console-core` billing + Stripe (your products/keys) + a **"Volt" hosted-provider** entry (`api.volt.ai`); + CI/release | parallel `infra/`; config; ⚠ `.github/` (CI) | **AWS + Stripe + SES + provider keys**, domain | paid sub → metered model call works end-to-end |
| **1 ✅** | Extract `volt-control` from `volt-vscode` (primitives + actions) | new `volt-control`; refactor `volt-vscode` | none | — | ✅ done — typecheck + 13 tests + extension build |
| **2 ✅** | `VoltPanel` as a persistent **"⚡ Volt" tab** in the session changes panel (next to Review/Context). Native v2 components (FileIcon/IconButtonV2). All UI in `volt-app`. | ⚠ `session-side-panel.tsx` (trigger+content) + `helpers.ts` (persistent tab) + dep | 2 | — | ✅ app builds; `dev:desktop` → changes panel → Volt tab |
| **3 ✅** | Wire the panel: Electron IPC (`packages/desktop` main runs `volt-control`; preload exposes `window.volt`) → `VoltPanel` calls `window.volt.*`; render live **IDE-sync** status (incoming drift + Pull/Push/Build) | grow `volt-app` + ⚠ `packages/desktop` (IPC) | reuses #2 | — | ✅ IPC wired; panel drives the CLI in the desktop app |
| **B ◐** | **Branding + desktop distribution** — logo, app name *(done)*; `opencode.ai` constants, Sentry DSN, **code-signing + updater feed + release** *(todo)* | ⚠ `ui` (logo) · ⚠ `desktop` (name) | done: 3 | *(done: logo + name)* · signing certs | ◐ logo + name done; distribution todo |
| **D** | *(optional)* Volt docs site | new `volt-docs` (Astro) or fold into `volt-web` | none | docs content | `docs.volt.ai` renders |

> **Git-native delegation (post-refactor) ✅** — since sync is now standard `git merge`, the Volt UI (vscode +
> desktop) is a **thin IDE-sync surface only**. It owns the **IDE axis** git can't see: bind/pull/push/build,
> the incoming/outgoing drift, drift colors, and the two diffs *against the last sync* — Incoming
> (`VOLTIDE↔BRIDGE`, what a pull brings) and Outgoing (`VOLTIDE↔WORKSPACE`, what a push sends), each clickable in
> the Volt view. The **git axis** — working-tree edits, history, local-change discard, merge-conflict
> resolution — uses the editor's **built-in Git** (VS Code's SCM + merge editor; opencode's Review tab). See
> **D11** for the engine model the diffs read from.

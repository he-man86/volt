# Volt — design & roadmap

The single design reference for the **Volt** product (a white-label of opencode): vision,
architecture, the phased build plan, and the decision log. `CLAUDE.md` is the lean, always-loaded
fork guide and links here. Build phase-by-phase; each phase is its own PR.

**Contents:** Vision & rule · Integration model · Extension hierarchy · Runtime layer stack ·
Packages · App & money model · Open decisions · **Phased build plan** · Deployment · Seam ledger ·
Sync flow · Explicitly-not-doing · **Decision log** (ADRs, at the end).

## Vision & the one rule

Volt is a **white-label of opencode**: an AI agent for IEC 61131-3 PLC work, sold as a SaaS.
The governing rule — proven across the integration work already done:

> **Own what's purely Volt's; reuse + keep in sync what *is* the product. Never *edit* an
> upstream file's contents — only *add* sibling files, *register* through a hook, or insert a
> *one-line mount*.**

This keeps `git merge upstream/dev` a near-trivial operation forever (opencode ships dozens of
PRs/day). The merge surface = only the handful of tiny ⚠ seams below.

## Integration model (how Volt touches opencode)

```
 LEGEND  ✅ additive (no edit)   ♻ reuse+sync (no edit)   ⚠ seam (tiny edit)   🔶 Volt-owned

 opencode (TUI+server+runtime)  ◄─ ✅  .opencode/{opencode.json,tool,agent,themes,plugins}
 console-core (Stripe/SES/auth) ◄─ ♻  reuse as-is, your infra config
 packages/ui (logo)             ◄─ ⚠  logo seam / build-alias
 packages/app (agent GUI)       ◄─ ⚠  ONE <Slot/> seam → then panels are additive
 packages/desktop (shell/name)  ◄─ ⚠  app-name + build-alias seam
 console/app (their landing)    ─── not touched; volt-web is parallel
 volt-*                         ─── 🔶 fork-owned, never merges
```

| opencode pkg | mechanism | conflicts on merge? |
|---|---|---|
| `opencode` (runtime/TUI) | ✅ additive config + tools + agent + theme + TUI plugins | No |
| `console-core` (backend) | ♻ reuse, your infra | No |
| `app` / `ui` / `desktop` (GUI) | ♻ synced deps + ⚠ few small seams (logo, app-name, one `<Slot/>`) | only those seams |
| `console/app` (landing) | not touched (parallel `volt-web`) | No |
| `volt-*` | 🔶 fork-owned | Never |

## Extension hierarchy — what extends what (keep this on track)

Each Volt addition, the opencode package it extends, and the mechanism.
✅ additive · ♻ reuse+sync · ⚠ seam · 🔶 fork-owned.

```
opencode host                          ◄── Volt extends via                       how
──────────────────────────────────────────────────────────────────────────────────────────
packages/opencode  (runtime + TUI)
  ├ config (lsp / permission / model)  ◄── .opencode/opencode.json                ✅ deep-merge
  ├ tools                              ◄── .opencode/tool/volt.ts                 ✅ auto-discover
  ├ agents                             ◄── .opencode/agent/volt.md                ✅ auto-discover
  ├ TUI theme                          ◄── .opencode/themes/volt.json + tui.json  ✅ config
  └ TUI plugins / slots                ◄── .opencode/plugins/volt.tsx  (future)   ✅ plugin API
packages/llm  (model gateway)          ◄── reused; a "Volt" provider entry        ♻ reuse
console-core  (billing/auth/email)     ◄── reused; your infra/ config             ♻ reuse
packages/ui  (logo)                    ◄── volt-app: VoltMark / VoltSplash        ⚠ build-alias
packages/app  (agent GUI)              ◄── volt-app: VoltPanel via <Slot/>        ⚠ 1 slot seam
packages/desktop  (shell / app name)   ◄── app name + panel/logo wiring           ⚠ seam
console/app  (opencode.ai landing)     ◄── volt-web  (parallel site)              🔶 own
packages/volt-vscode  (VS Code)        ◄── renders volt-control                   🔶 own

Volt-owned packages (never merge upstream):
  volt-bridge · volt-git · volt-lsp-codesys · volt-vscode · volt-control · volt-app · volt-web
  (+ planned: volt-docs)
```

**The rule to stay on track:** a new Volt capability attaches at the **highest ✅ row that fits**;
drop to ⚠ only when no hook exists (GUI panels/logo). Never edit an upstream file that isn't a ⚠ row here.

## Packages — current & planned

**Exist:** `volt-bridge`, `volt-git`, `volt-lsp-codesys`, `volt-vscode` (PLC toolchain) ·
`volt-web` (landing — *scaffold*, `packages/volt-web/README.md`).

**Planned:**
- **`volt-control`** — shared, UI-agnostic core that drives the `volt` CLI/bridge (status/push/
  pull/build, parse, health). Consumed by both `volt-vscode` and the future desktop panel.
- **`volt-app`** — Solid panel component(s) for the opencode **desktop** app (the volt-vscode UX),
  mounted into `packages/app` via the `<Slot/>`. Holds *only* override/added components — **not** a
  copy of `app`.

### `volt-control` extractability — VERIFIED (load-bearing)

`volt-vscode`'s core is cleanly separable:
- **Pure today (move as-is):** `cli.ts` (CLI driver, only node built-ins), `workspace.ts`,
  `state/health.ts`, `gate.ts`, `types.ts`.
- **vscode-coupled but logic delegates to the pure files:** `commands.ts`, `state/status.ts`,
  `connector.ts` — split the action/parse logic (→ `volt-control`) from the `vscode` presentation
  (status bar / command registration; stays in `volt-vscode`).
- **Stays VS Code-only:** `extension.ts`, `lsp.ts`, `providers/*`, `views/*`.

→ Green light; the only real work is peeling `vscode` out of `status.ts`/`commands.ts`.

> **`volt-control` vs `volt-git`:** distinct. `volt-git` is the CLI *binary*; `volt-control` is the
> UI-agnostic wrapper that *spawns/parses* it and is rendered by `volt-vscode` and `volt-app`.

## Runtime layer stack (consumers → CLI → bridge → IDE)

How control actually flows to the PLC. **Two paths in, one CLI:** the GUIs go through
`volt-control` (rendering state — live status, health, parsed outcomes); the AI agent spawns the
CLI **directly** (it just runs a verb + reads stdout). Everything converges on the **CLI** — the
single chokepoint that speaks HTTP to the bridge. This is *why* the CLI is the clean integration
point: every front-door is just a different way to fire the same verbs.

```
 LAYER 1 — CONSUMERS
 ┌──────────────────────────────────┐        ┌──────────────────────────────┐
 │ GRAPHICAL UIs                    │        │ AI AGENT (opencode)          │
 │  • Volt desktop panel (Electron) │        │  • volt tool  (typed)        │
 │  • VS Code views                 │        │  • gated bash (volt …)       │
 └───────────────┬──────────────────┘        └──────────────┬───────────────┘
                 │ calls                                     │ spawns directly
                 ▼                                           │ (mutating verbs → ask)
 ┌──────────────────────────────────┐                       │
 │ LAYER 2 — volt-control (Node)     │                       │
 │  status/pull/push/build/merge     │                       │
 │  + health polling, outcome parse  │                       │
 │  — only the GUIs need this        │                       │
 └───────────────┬──────────────────┘                       │
                 │ spawns                                    │
                 └──────────────────┬────────────────────────┘
                                    ▼  (everything converges here)
 ┌────────────────────────────────────────────────────────────────────────┐
 │ LAYER 3 — volt CLI   status · pull · push · build · init · merge · show  │
 └────────────────────────────────┬───────────────────────────────────────┘
                                  │ HTTP  (localhost :8555 TwinCAT / :8556 CODESYS)
 ┌────────────────────────────────▼───────────────────────────────────────┐
 │ LAYER 4 — VOLT CONNECTOR + C# BRIDGE   (native Windows)                  │
 │   VoltConnector.exe (tray) → Volt.Bridge.Codesys (.NET48 in-proc)       │
 │                            → Volt.Bridge.Beckhoff (.NET8 exe)           │
 └────────────────────────────────┬───────────────────────────────────────┘
                                  │ IDE automation API
 ┌────────────────────────────────▼───────────────────────────────────────┐
 │ LAYER 5 — PLC IDE   CODESYS / TwinCAT                                    │
 └─────────────────────────────────────────────────────────────────────────┘
```

**Install model (what the user actually installs):**

| Layers | Ships as | Install |
|---|---|---|
| **1 + 2 + 3** (UI + control + CLI — all JS/Node) | **bundled together** in the product; CLI runs via the host's own Node (`ELECTRON_RUN_AS_NODE`) — no toolchain needed | one normal install: the **Volt desktop app** *or* the **VS Code extension** *or* **opencode** |
| **4** (Connector + C# bridges) | `VoltConnector.exe` + .NET bridges (`%LocalAppData%\Programs\Volt\`) | **separate native Windows installer** (the only "like-Git" install) |
| **5** | the user's existing CODESYS / TwinCAT | already on their machine |

So the `volt` CLI is **not** a separate install — it's bundled in whatever front-end the user runs.
The one native install is the **Connector** (Layer 4), because it must run on Windows and automate
the PLC IDEs. (Its installer — the old `volt-connector.iss` + scripts — is being reworked.)

## Verified: opencode's app & money model (shapes the gaps below)

- The **desktop app runs a local sidecar server** (`127.0.0.1`, random port) — the agent runtime is
  **local**, not a cloud endpoint. The server URL is **configurable** (`electron-store
  defaultServerUrl`), not hardcoded.
- LLM access is **bring-your-own provider key** (Anthropic login, custom providers). **No
  subscription gate exists in the app.** Telemetry is env-driven (`VITE_SENTRY_DSN`).
- opencode's revenue (`console-core` / "Zen") = **selling hosted model access** (opencode-as-a-
  provider), *not* gating the app.
- Hardcoded `opencode.ai` bits are a few small config/seams: changelog URL, favicon, install URL,
  `VITE_OPENCODE_CHANNEL`.

**DECISION — Volt sells AI subscriptions (opencode Go/Zen-style), not tooling licenses.** The
metering + monetization already lives **server-side in the reused backend, all in-repo**:
`packages/llm` (model gateway/protocols), `console-core/billing.ts` (`UsageTable`, credits,
`LiteTable` weekly/rolling **usage limits**, Stripe credit products), `console/function/log-processor.ts`
(usage pipeline). So you **reuse it as-is** — deploy your own instance with your provider keys +
Stripe products, and add a **"Volt" hosted-provider entry** the app points at (`api.volt.ai`).
**No `volt-git` gate, no app fork** — the PLC tools stay free; the AI subscription is the product.
The **cloud deploy *is* the revenue path**, so the commercial track moves early.

## Open product decisions

| Decision | Choice | Notes |
|---|---|---|
| **What Volt sells** | ★ **hosted AI subscriptions** (opencode Go/Zen-style) | reuse the in-repo gateway (`llm`) + billing (`console-core`); PLC tools (`volt-*`) stay free |
| **Where metering lives** | **server-side, reused backend** | `console-core` `UsageTable`/`LiteTable` + `log-processor`; **no `volt-git` gate** |
| **Billing shape** | **metered credits + subscription** | reuse `console-core` + Stripe **as-is**; your products/prices via `infra/` config |
| **Platform** | **Windows-first** | bridges are Windows-only; PLC work is Windows-centric. Remote bridge later |
| **`<Slot/>`** | **try upstream first** | one local seam only if rejected |
| **MVP** | **deploy the reused cloud** (gateway + `console-core` + Stripe) + a Volt provider entry | it's the product; mostly **config + deploy, not new code** |

> **Trade-off of the AI-reseller model (eyes open):** you hold the provider keys and **front the
> model cost**, so your sub price must beat real usage — the `LiteTable` weekly/rolling limits are
> exactly the throttle for that. Heavier **ops** than a license key (running a billed gateway: keys,
> abuse limits, reconciliation), but it's **reuse + deploy, not build**.

## Phased build plan

Tracks: **W5→W6** = commercial (**your revenue path** — deploy the reused cloud) · **1→2→3** =
desktop panel (polish) · **B** = branding+distribution. Only 1→2→3 is strictly ordered.

| Phase | Goal | Packages / files | Seams | Inputs you provide | Verify |
|---|---|---|---|---|---|
| **0 ✅** | Additive integration foundation | `.opencode/*`, verifiers, package map, this doc | none | — | ✅ done |
| **0.5 ✅** | **License/attribution** — keep opencode's MIT notice + add a Volt `NOTICE` | `NOTICE` | none | — | ✅ done |
| **W5** | `volt-web` landing + signup | `packages/volt-web` (steps in its README) | none | branding/copy, domain | site renders; signup via `console-core` |
| **W6** | **Deploy the revenue cloud** — Volt `infra/`: `llm` gateway + `console-core` billing + Stripe (your products/keys) + a **"Volt" hosted-provider** entry (`api.volt.ai`); + CI/release | parallel `infra/`; config; ⚠ `.github/` (CI) | **AWS + Stripe + SES + provider keys**, domain | paid sub → metered model call works end-to-end |
| **1 ✅** | Extract `volt-control` from `volt-vscode` (primitives + actions) | new `volt-control`; refactor `volt-vscode` | none | — | ✅ done — typecheck + 13 tests + extension build |
| **2 ✅** | `VoltPanel` as a persistent **"⚡ Volt" tab** in the session changes panel (next to Review/Context) — the multipurpose viewer already hosts Review+Context+files, so Volt is a sibling tab, not a separate column. Native v2 components (FileIcon/IconButtonV2). All UI in `volt-app`. | ⚠ `session-side-panel.tsx` (trigger+content) + `helpers.ts` (persistent tab) + dep | 2 | — | ✅ app builds; `dev:desktop` → changes panel → Volt tab |
| **3 ✅** | Wire the panel: Electron IPC (`packages/desktop` main runs `volt-control`; preload exposes `window.volt`) → `VoltPanel` calls `window.volt.*`; render live **IDE-sync** status (incoming drift + Pull/Push/Build) | grow `volt-app` + ⚠ `packages/desktop` (IPC) | reuses #2 | — | ✅ IPC wired; panel drives the CLI in the desktop app |
| **B ◐** | **Branding + desktop distribution** — logo, app name *(done)*; `opencode.ai` constants, Sentry DSN, **code-signing + updater feed + release** *(todo)* | ⚠ `ui` (logo) · ⚠ `desktop` (name) | done: 3 | *(done: logo + name)* · signing certs | ◐ logo + name done; distribution todo |
| **D** | *(optional)* Volt docs site | new `volt-docs` (Astro) or fold into `volt-web` | none | docs content | `docs.volt.ai` renders |

> **Git-native delegation (post-refactor) ✅** — since sync is now standard `git merge`, the Volt UI (vscode +
> desktop) is a **thin IDE-sync surface only**. It owns the **IDE axis** git can't see: bind/pull/push/build,
> the incoming/outgoing drift, drift colors, and the two diffs *against the last sync* — Incoming
> (`VOLTIDE↔BRIDGE`, what a pull brings) and Outgoing (`VOLTIDE↔HEAD`, what a push sends), each clickable in
> the Volt view. The **git axis** — working-tree edits, history, local-change discard, merge-conflict
> resolution — uses the editor's **built-in Git** (VS Code's SCM + merge editor; opencode's Review tab). The
> custom `merge.*` commands, the "Sync history" view/tab, the `discardOutgoing` command, and the `log` IPC
> were removed. See **D11** for the engine model the diffs read from.

## Deployment & subdomains (your `infra/`)

`volt.ai` (landing → `volt-web`) · `app.volt.ai` (agent GUI = reused `app`) · `api.volt.ai` (agent
server) · `auth.volt.ai` (OpenAuth = reused `console-function`) · `docs.volt.ai` (optional).

## Seam ledger (the *entire* upstream-merge conflict surface, end-state)

```
 config (4):  bun.lock · .opencode/tui.json · .husky/pre-push · .gitignore
 branding:    packages/ui (logo) · packages/desktop (name + opencode.ai constants)
 GUI:         packages/app (<Slot/>)        ← →0 if upstreamed
 CI:          .github/ (Volt workflows — allowlist entry)
 ───────────────────────────────────────────────────────────────────────────
 ≈ 7–9 tiny insertion points. Entitlement gate, landing, infra, docs = 100% additive/fork-owned.
```
Every new file lives under `packages/volt-*` (or an allowlisted path) → exempt from
`check-divergence`. Spend the seam budget on **generic hooks**, never per-feature edits.

## Staying in sync — the merge-process signal flow

The restructuring (additive merge-layers) makes `git merge upstream/dev` near-trivial. The whole
sync is **one command** — `volt-scripts/merge-upstream.ts` (fetch → branch → merge → verify):

```
bun volt-scripts/merge-upstream.ts     # fetch · dated sync branch · merge · run sync.ts
                                        # stops on conflict; prints the ff to land it

   sync.ts signal flow (stops at the first ✗):
   install ─▶ divergence ─▶ integration ─▶ lsp loads ─▶ tool loads ─▶ ✓ SYNC OK
    deps      4 seams         configs+bins    opencode      opencode
              only?           present?        runtime       runtime
```

**Validated 2026-06-26:** merged 108 upstream commits → **zero conflicts**, surface still 4 seams,
all signals ✓.

**Scripts (post-restructuring):**

| Script | Role |
|---|---|
| **`merge-upstream.ts`** | **the one sync command** — fetch → dated sync branch → merge → run `sync.ts`; stops on conflict |
| **`sync.ts`** | **the merge-process signal flow** — orchestrates the four checks below; run standalone after a manual merge |
| `check-divergence.ts` | keystone guard (fork surface); also run by the pre-push hook |
| `check-volt-integration.ts` · `verify-lsp.ts` · `verify-volt-tool.ts` | the load/health sub-steps `sync.ts` runs |
| `dev.ts` · `bridge.ps1` · `codesys-bridge.ps1` · `harvest-corpus.ts` · `volt`/`volt.cmd` | dev launcher + PLC/bridge tooling |

The sync *mechanism* is `git merge` + `sync.ts`. (`export-overlay.ts` — the old patch-overlay
distribution model — was **removed**; superseded by "Volt is a product deployed from this fork.")

## Explicitly NOT doing

- **Fork `packages/app`** (the agent GUI) — it's opencode's core, synced not copied.
- **Marketplace** / **`volt-git` license gate** — dropped (Volt sells AI subs, not tooling licenses).
- **Rewrite the backend** — none. Reuse `console-core` (incl. the metered-credit "Zen"/Go billing),
  `packages/llm` (the model gateway), and the usage pipeline **as-is**; only `infra/` config differs
  (your Stripe products, provider keys, domain).

## Decision log

Lightweight ADRs — the load-bearing choices, with what we **rejected**, so they aren't relitigated.
Newest first.

### D12 — VG is a first-class Volt language (FBD/LD as text), not "graphical transpiled to ST" (2026-06-28)
**Decision:** editable FBD/LD graphical bodies are **VG (Volt Graphical)** — Volt's own textual language. It
reads like Structured Text but is **distinct** (its own grammar, parser, type-inference, and diagnostics).
The bridge round-trips it exactly (PLCopen XML ⇄ graph ⇄ VG text) and is the source of truth; `volt-lsp-codesys`
analyzes it as a first-class sublanguage (routed by the leading `NETWORK` token to `src/vg/` + `queries/vg/`);
`volt-vscode` gives it its own `volt-graphical` editor language id. `.fbd`/`.ld` are editable VG; CFC/SFC are
read-only. The spec is `packages/volt-bridge/docs/vg-language.md`.
**Why:** graphical bodies must be editable *as text* for the AI + the LSP, and an exact round trip makes the
whole project text-native. Treating VG as its own language (not "ST") is honest — it has its own grammar and
checks — and lets the editor + LSP handle it correctly instead of mislabelling it.
**Rejected:** "transpile graphical to ST / one source language" (the old framing — VG isn't ST; the LSP routes
it separately); mapping `.fbd`/`.ld` to the `structured-text` editor language (hid VG *as* ST in VS Code —
*the* gap this closes); a bespoke VG TextMate grammar now (overkill — VG reads like ST, so the ST grammar is a
fine highlight approximation under the VG language id, with room to specialise later).

### D11 — The IDE is a git *remote*; the engine operates on committed HEAD (2026-06-27)
**Decision:** model the live IDE as a git remote-tracking branch **`refs/remotes/volt/ide`** (renders in the
graph as `volt/ide`). The engine reads/writes **committed git state (HEAD), never the worktree**, and
**auto-commits** to get there: `volt push` commits any working changes then lands `volt/ide` **on HEAD**
(exactly `git push` → `origin/main == main`); `volt pull` commits any working changes then `git merge
volt/ide`. So the day-to-day flow is just **`volt push` / `volt pull`** — no manual `git commit`. A clean
tree commits nothing, so committing by hand first keeps full control of message/granularity. The *view*
(`status` + the diff tab) reads the **working tree**, though, so an edit shows as outgoing the moment you
save — committed or not. So: sync follows your commits, the view follows your files. The diff surface
compares both directions against the baseline (incoming = baseline↔live IDE, outgoing = baseline↔your
working file).
**Why:** it makes the whole thing a textbook git remote — the graph shows your branch vs the IDE, `push`/
`pull` semantics transfer directly, `volt/ide` stays local (remote-tracking refs aren't pushed to origin),
and auto-commit collapses the workflow to two commands. Operating on committed HEAD gives one unambiguous
source of truth and kills the split-brain (IDE ahead of git) the worktree-based push caused.
**Rejected:** the hidden `refs/volt/ide` ref (invisible in the graph); pushing the uncommitted worktree (git
never pushes uncommitted work; it left the IDE ahead of git); a parallel deterministic IDE-commit on push
(showed `volt/ide` on its own chain, not aligned with HEAD); delegating the *outgoing* diff to Source Control
(it shows working-vs-HEAD, which is empty once you've committed in order to push).

### D10 — CI + scheduled auto-sync (2026-06-26)
**Decision:** GitHub Actions enforce the fork invariants (`.github/workflows/volt-ci.yml`) on every
push/PR; a weekly job (`volt-upstream-sync.yml`) merges `upstream/dev` and opens a PR if clean.
**Why:** the pre-push hook is bypassable (`--no-verify`); upstream moves ~100 commits/2 days.
**Rejected:** local-only guards (not enforced); manual-only syncing (drifts fast).

### D9 — Committed-junk guard in check-divergence (2026-06-26)
**Decision:** `check-divergence` flags `*.bak`/`*.orig`/`*.swp`/`.DS_Store`/… anywhere in the fork's
files. **Rejected:** gitignoring them (silent; less visible than a guard failure).

### D8 — Sync = `git merge` + `sync.ts`; `export-overlay` removed (2026-06-26)
**Decision:** one signal-flow command (`sync.ts`) verifies a merge; `merge-upstream.ts` wraps the
whole flow. **Rejected:** the patch-overlay distribution model (`export-overlay.ts`) — Volt is a
*deployed product*, not a patch shipped against a pinned opencode release.

### D7 — Monetize by reselling hosted AI subscriptions (opencode Go/Zen-style) (2026-06-26)
**Decision:** Volt sells **hosted AI access**, reusing the in-repo gateway (`packages/llm`) + billing
(`console-core`: `UsageTable`/`LiteTable`/Stripe) as-is; the PLC tools stay free.
**Why:** keeps the backend identical (deploy + config, not a rewrite); the moat is the PLC
integration, not the AI. **Rejected:** gating the `volt-git`/bridge by license (would require new
entitlement code; opencode's app is BYO-key with no gate). **Trade-off:** you front the model cost —
`LiteTable` limits are the margin throttle.

### D6 — Own the landing page; keep + sync the agent app (2026-06-26)
**Decision:** `volt-web` is the only frontend Volt fully owns (parallel to `console/app`). The agent
GUI (`packages/app`/`ui`/`desktop`) is reused and kept in sync — **never forked** — customized only
via minimal seams. **Rejected:** a monolithic `volt-app` fork of the GUI (forfeits daily upstream
improvements; permanent re-merge pain).

### D5 — Graphical Volt features via additive hooks; desktop GUI = deliberate seams (2026-06-26)
**Decision:** TUI panels via `.opencode/plugins/*.tsx` (additive); a desktop panel via one GUI
`<Slot/>` in `packages/app` (ideally upstreamed) rendering `volt-app`. Logo/app-name = small seams.
**Why:** the GUI has no plugin hook (verified); spend the seam budget on **generic hooks**, not
per-feature edits.

### D4 — `volt-control`: one shared CLI/bridge core, two renderers (2026-06-26)
**Decision:** extract the UI-agnostic core from `volt-vscode` into `volt-control`, rendered by both
`volt-vscode` (VS Code views) and `volt-app` (Solid panel). **Why:** verified cleanly separable.
**Rejected:** reimplementing the CLI-driving logic per surface.

### D3 — CLI as a first-class opencode tool + gated bash (2026-06-25)
**Decision:** expose `volt` via `.opencode/tool/volt.ts` (typed, approval-gated) **and** gated bash.
**Why:** a custom tool is discoverable by every agent; bash alone relies on prose + the model
choosing it. **Rejected:** an MCP server (heavier; the CLI is the surface).

### D2 — Eliminate config/test seams via native merge-layers (2026-06-25)
**Decision:** Volt config lives in fork-owned `.opencode/opencode.json` (opencode deep-merges it over
a pristine `opencode.jsonc`); turbo tasks in per-package `turbo.json`. **Why:** the two files upstream
also edits become zero-conflict on merge (6 seams → 4). **Rejected:** a script that re-patches the
upstream files (fragile; breaks on upstream refactors).

### D1 — Purely additive fork; verifiable loading (2026-06-25)
**Decision:** Volt only *adds* files / *registers* via hooks / *inserts* minimal seams — never edits
upstream file contents. Loading is provable (`verify-lsp`/`verify-volt-tool` drive `opencode debug`).
**Why:** keeps `git merge upstream/dev` near-trivial (proven: 108 commits, zero conflicts).
`check-divergence` enforces it.

# Volt-as-a-SaaS roadmap (white-label opencode)

The plan-of-record for turning this opencode fork into the **Volt** product. Companion to
`CLAUDE.md` ("Fork surface", "Monorepo package map"). Build phase-by-phase; each phase is
its own PR.

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
  volt-bridge · volt-cli · volt-lsp-st · volt-vscode · volt-control · volt-app · volt-web
  (+ planned: volt-docs)
```

**The rule to stay on track:** a new Volt capability attaches at the **highest ✅ row that fits**;
drop to ⚠ only when no hook exists (GUI panels/logo). Never edit an upstream file that isn't a ⚠ row here.

## Packages — current & planned

**Exist:** `volt-bridge`, `volt-cli`, `volt-lsp-st`, `volt-vscode` (PLC toolchain) ·
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

> **`volt-control` vs `volt-cli`:** distinct. `volt-cli` is the CLI *binary*; `volt-control` is the
> UI-agnostic wrapper that *spawns/parses* it and is rendered by `volt-vscode` and `volt-app`.

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
**No `volt-cli` gate, no app fork** — the PLC tools stay free; the AI subscription is the product.
The **cloud deploy *is* the revenue path**, so the commercial track moves early.

## Open product decisions

| Decision | Choice | Notes |
|---|---|---|
| **What Volt sells** | ★ **hosted AI subscriptions** (opencode Go/Zen-style) | reuse the in-repo gateway (`llm`) + billing (`console-core`); PLC tools (`volt-*`) stay free |
| **Where metering lives** | **server-side, reused backend** | `console-core` `UsageTable`/`LiteTable` + `log-processor`; **no `volt-cli` gate** |
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
| **0 ✅** | Additive integration foundation | `.opencode/*`, verifiers, package map, this roadmap | none | — | done this session |
| **0.5** | **License/attribution** — keep opencode's MIT notice + add a Volt `NOTICE` | `LICENSE`, `NOTICE` | none | — | both present, attribution intact |
| **W5** | `volt-web` landing + signup | `packages/volt-web` (steps in its README) | none | branding/copy, domain | site renders; signup via `console-core` |
| **W6** | **Deploy the revenue cloud** — Volt `infra/`: `llm` gateway + `console-core` billing + Stripe (your products/keys) + a **"Volt" hosted-provider** entry (`api.volt.ai`); + CI/release | parallel `infra/`; config; ⚠ `.github/` (CI) | **AWS + Stripe + SES + provider keys**, domain | paid sub → metered model call works end-to-end |
| **1** | Extract `volt-control` from `volt-vscode` | new `volt-control`; refactor `volt-vscode` | none | — | vscode builds + tests pass |
| **2** | GUI `<Slot/>` in `packages/app` (try to upstream) | ⚠ `packages/app` | 1 (→0 if upstreamed) | design review | dummy panel renders |
| **3** | `volt-app` desktop panel rendering `volt-control`, via slot | new `volt-app` | reuses #2 | panel UX | panel drives CLI in desktop |
| **B** | **Branding + desktop distribution** — logo, app name, `opencode.ai` constants, Sentry DSN; **code-signing + updater feed + release** | ⚠ `ui` (logo) · ⚠ `desktop` (name/constants) · config (Sentry) | 2–3 | logo asset, signing certs | Volt-branded signed build auto-updates |
| **D** | *(optional)* Volt docs site | new `volt-docs` (Astro) or fold into `volt-web` | none | docs content | `docs.volt.ai` renders |

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
post-merge check is **one command** — `volt-scripts/sync.ts`:

```
git fetch upstream
git merge upstream/dev        # conflicts only in the 4 tiny seams (usually none)
bun volt-scripts/sync.ts      # ↓ the signal flow (stops at the first ✗)

   install ─▶ divergence ─▶ integration ─▶ lsp loads ─▶ tool loads ─▶ ✓ SYNC OK
    deps      4 seams         configs+bins    opencode      opencode
              only?           present?        runtime       runtime
```

**Validated 2026-06-26:** merged 108 upstream commits → **zero conflicts**, surface still 4 seams,
all signals ✓.

**Scripts (post-restructuring):**

| Script | Role |
|---|---|
| **`sync.ts`** | **the merge-process signal flow** — the one command after a merge; orchestrates the four checks below |
| `check-divergence.ts` | keystone guard (fork surface); also run by the pre-push hook |
| `check-volt-integration.ts` · `verify-lsp.ts` · `verify-volt-tool.ts` | the load/health sub-steps `sync.ts` runs |
| `dev.ts` · `bridge.ps1` · `codesys-bridge.ps1` · `harvest-corpus.ts` · `volt`/`volt.cmd` | dev launcher + PLC/bridge tooling |

The sync *mechanism* is `git merge` + `sync.ts`. (`export-overlay.ts` — the old patch-overlay
distribution model — was **removed**; superseded by "Volt is a product deployed from this fork.")

## Explicitly NOT doing

- **Fork `packages/app`** (the agent GUI) — it's opencode's core, synced not copied.
- **Marketplace** / **`volt-cli` license gate** — dropped (Volt sells AI subs, not tooling licenses).
- **Rewrite the backend** — none. Reuse `console-core` (incl. the metered-credit "Zen"/Go billing),
  `packages/llm` (the model gateway), and the usage pipeline **as-is**; only `infra/` config differs
  (your Stripe products, provider keys, domain).

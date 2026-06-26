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

**Implication (resolves the auth gap #1):** enforce a Volt subscription in **the part Volt owns —
`volt-cli` / `volt-bridge`** (a license/entitlement check before driving the IDE), validated against
Volt's backend. That is **additive** — no app seam, no fork. The reused app stays BYO-key.

## Open product decisions (recommended defaults)

| Decision | Options | Recommended default |
|---|---|---|
| **What Volt sells** | (a) hosted model access (reuse Zen) · (b) licensed PLC tooling · (c) seats | **(b)** gate the Volt PLC capability — your differentiator; BYO-key keeps model cost off you |
| **Where entitlement is enforced** | app (seam) · **`volt-cli`/`bridge`** (additive) | **`volt-cli`/`bridge`** — gate what you own; zero app seam |
| **Billing shape** | metered (Zen-style) · seat / subscription | **seat/subscription** (PLC tool sold to teams); reuse `console-core`'s Stripe utils, write Volt's plan logic |
| **Platform** | cross-platform · **Windows-first** | **Windows-first** — bridges are Windows-only; PLC work is Windows-centric. Allow remote bridge later |
| **`<Slot/>`** | upstream · local seam | **try upstream first**; one seam if rejected |
| **MVP scope** | full console · **minimal license check** | **minimal** — a license key checked by `volt-cli` against a tiny Volt backend; defer full `console-core`/Stripe until self-serve billing is needed |

## Phased build plan

Tracks: **1→2→3** = desktop panel · **E** = entitlement · **B** = branding+distribution ·
**W5→W6** = commercial/web. Pick the track you need first; only 1→2→3 is strictly ordered.

| Phase | Goal | Packages / files | Seams | Inputs you provide | Verify |
|---|---|---|---|---|---|
| **0 ✅** | Additive integration foundation | `.opencode/*`, verifiers, package map, this roadmap | none | — | done this session |
| **0.5** | **License/attribution** — keep opencode's MIT notice + add a Volt `NOTICE` | `LICENSE`, `NOTICE` | none | — | both present, attribution intact |
| **1** | Extract `volt-control` from `volt-vscode` | new `volt-control`; refactor `volt-vscode` | none | — | vscode builds + tests pass |
| **2** | GUI `<Slot/>` in `packages/app` (try to upstream) | ⚠ `packages/app` | 1 (→0 if upstreamed) | design review | dummy panel renders |
| **3** | `volt-app` desktop panel rendering `volt-control`, via slot | new `volt-app` | reuses #2 | panel UX | panel drives CLI in desktop |
| **E** | **Volt entitlement gate** — license check in `volt-cli`/`bridge` + a minimal Volt backend | `volt-cli`/`volt-bridge` (additive) + tiny license fn | none | how licenses are issued | unlicensed → bridge refuses |
| **B** | **Branding + desktop distribution** — logo, app name, `opencode.ai` constants, Sentry DSN; **code-signing + updater feed + release** | ⚠ `ui` (logo) · ⚠ `desktop` (name/constants) · config (Sentry) | 2–3 | logo asset, signing certs | Volt-branded signed build auto-updates |
| **W5** | `volt-web` landing | `packages/volt-web` (steps in its README) | none | branding/copy, domain | site renders; signup via `console-core` |
| **W6** | Volt `infra/` + **CI/release** | parallel SST; CI for desktop builds, npm (`volt-cli`/`volt-lsp`), VS Code marketplace (`volt-vscode`), deploy | ⚠ `.github/` (allowlist) | AWS+Stripe+SES, domain | deploy; checkout+email; releases publish |
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

## Explicitly NOT doing

- **Fork `packages/app`** (the agent GUI) — it's opencode's core, synced not copied.
- **Marketplace** — dropped.
- **Rewrite the backend** — reuse `console-core`'s Stripe/SES/auth *utilities* as-is (your `infra/`
  config). Volt's plan/entitlement logic is its own (the `volt-cli` gate), **not** a fork of
  opencode's per-model "Zen" billing domain.

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

## Phased build plan

| Phase | Goal | Packages / files | Seams | Inputs you must provide | Verify |
|---|---|---|---|---|---|
| **0 ✅ done** | Additive integration foundation | `.opencode/opencode.json`, `tool/volt.ts`, per-pkg `turbo.json`; verifiers; package map | none new | — | `verify-lsp`/`verify-volt-tool`/`check-divergence` (this session) |
| **1** | Extract `volt-control` from `volt-vscode`; re-point the extension | new `packages/volt-control`; refactor `volt-vscode` | **none** (fork pkgs only) | — | `volt-vscode` builds + tests pass; `volt-control` unit tests |
| **2** | GUI `<Slot/>` — panel-slot/registry in `packages/app`; **try to upstream it** | ⚠ `packages/app` (one slot) | **1** (ideally → 0 if upstreamed) | design review | a dummy panel renders via the slot |
| **3** | `volt-app` desktop panel — render `volt-control` (status/push/pull/build/diag), mount via slot | new `packages/volt-app` | reuses Phase-2 slot | panel UX design | panel drives the CLI in the desktop app |
| **4** | Branding | ⚠ `packages/ui` (logo), ⚠ `packages/desktop` (name); colors via theme (✅) | **2** | **Volt logo asset**, app name | desktop shows Volt brand |
| **5** | `volt-web` landing | build `packages/volt-web` (solid-start; steps in its README) | none (parallel) | branding/copy, **domain** | site renders; signup via `console-core` |
| **6** | Volt `infra/` (deploy) | parallel SST stack; reuse `console-core` | none (own files) | **AWS + Stripe + SES accounts**, domain | deploy; test checkout + email |

Order is dependency-driven: 1→2→3 (panel needs core + slot); 4 anytime; 5→6 is the commercial track (independent of 1–3).

## Seam ledger (the *entire* upstream-merge conflict surface, end-state)

```
 today:  bun.lock · .opencode/tui.json · .husky/pre-push · .gitignore         (4)
 +       packages/ui (logo) · packages/desktop (app-name) · packages/app (<Slot/>)  (≈3)
 ──────────────────────────────────────────────────────────────────────────────────
 ≈ 7 tiny, stable insertion points — vs. forking app/ui/desktop = conflicts every PR.
```
Every new file lives under `packages/volt-*` (or the `.opencode/…` additive allowlist) and is
exempt from `check-divergence`. Keep spending the seam budget on **generic hooks** (the `<Slot/>`,
build-aliases), never per-feature edits.

## Decisions / inputs still needed (per phase)

- **Phase 2:** upstream the `<Slot/>` to opencode, or carry it as one local seam?
- **Phase 3:** desktop panel UX (mirror volt-vscode's SCM/history views?).
- **Phase 4:** the Volt **logo** asset + final app name.
- **Phase 5/6:** **domain**, and your **Stripe / AWS / SES** accounts (deploy + secrets).

## Explicitly NOT doing

- **Fork `packages/app`** (the agent GUI) — it's opencode's core, synced not copied.
- **Marketplace / `volt-commerce`** — dropped; billing reused identically from `console-core`.
- **Rewrite the backend** — `console-core` reused as-is, configured via your `infra/`.

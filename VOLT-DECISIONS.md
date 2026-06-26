# Volt decision log

Lightweight ADRs — the load-bearing choices behind the Volt fork, with what we **rejected**, so
they aren't relitigated. Newest first. Companion to `VOLT-ROADMAP.md` (the *what*) and `CLAUDE.md`.

---

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
integration, not the AI. **Rejected:** gating the `volt-cli`/bridge by license (would require new
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

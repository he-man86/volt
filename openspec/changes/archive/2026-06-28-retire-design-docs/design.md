## Context

`VOLT-DESIGN.md` and `VOLT-PLAN.md` have been superseded by OpenSpec: the invariants are now the
capability specs in `openspec/specs/`, the roadmap is the changes in `openspec/changes/`, and the
shipped system was captured by the archived `review-*` changes. The one thing OpenSpec's per-change
model doesn't natively retain is the **retrospective decision log** (D1–D13), since those decisions
predate the migration. This change slims the prose docs to pointers and **preserves that decision log
here** — the archived change is its permanent home (the user chose against a standalone `DECISIONS.md`;
spec requirements carry the decision *outcomes*, this carries the *rationale + rejected alternatives*).

## Goals / Non-Goals

**Goals:** one source of truth (OpenSpec + READMEs); no loss of the decision rationale.
**Non-Goals:** changing any decision; re-deriving specs (already done by the `review-*` changes).

## Decisions

Slim `VOLT-DESIGN.md` → the one rule + pointers. Slim `VOLT-PLAN.md` → a status pointer at
`openspec/changes/`. Update `CLAUDE.md` links. Preserve the full decision log below.

## Preserved decision log (D1–D13)

> Verbatim from the retired `VOLT-DESIGN.md`. Newest first. Decision *outcomes* now live as
> requirements in `openspec/specs/`; this is the rationale + rejected alternatives.

### D13 — The LSP is vendor-keyed (`volt-lsp-codesys`); a new LSP = a new vendor (2026-06-28)
**Decision:** the language server is named for the **vendor ecosystem** it serves — `@opencode-ai/volt-lsp-codesys`
(CODESYS + TwinCAT, which is CODESYS-derived) — not a single language. It already covers that whole family's
languages (ST + VG + the declaration kinds) off the embedded CODESYS reference. So a new LSP is a different-
structure **vendor** (e.g. Siemens TIA/SCL → a sibling `volt-lsp-siemens`), not a new language.
**Why:** the old `volt-lsp-st` name implied ST-only, but the server *is* the CODESYS/TwinCAT language server.
Keying by vendor is honest and leaves a clean extension axis (per-vendor), not per-language.
**Rejected:** `volt-lsp-st` (misnomer); bare `volt-lsp` (no room for a Siemens sibling); `volt-lsp-codesys-beckhoff` (redundant — TwinCAT is CODESYS-based).
→ captured in spec `language-server`.

### D12 — VG is a first-class Volt language (FBD/LD as text), not "graphical transpiled to ST" (2026-06-28)
**Decision:** editable FBD/LD graphical bodies are **VG (Volt Graphical)** — Volt's own textual language, distinct
from ST (its own grammar, parser, type-inference, diagnostics). The bridge round-trips it exactly; `volt-lsp-codesys`
analyzes it routed by the leading `NETWORK` token; `volt-vscode` highlights it by content injection (whole files +
graphical methods inlined in a `.st` POU). `.fbd`/`.ld` editable; CFC/SFC read-only.
**Why:** graphical bodies must be editable as text for the AI + LSP; an exact round trip makes the project text-native;
treating VG as its own language is honest.
**Rejected:** "transpile graphical to ST"; a separate `volt-graphical` editor language keyed on `.fbd`/`.ld` (misses
inlined graphical methods — the `NETWORK` injection catches both); a bespoke VG TextMate grammar now (overkill).
→ captured in spec `vg-language`.

### D11 — The IDE is a git *remote*; the engine operates on committed HEAD (2026-06-27)
**Decision:** model the live IDE as a git remote-tracking branch **`refs/remotes/volt/ide`**. The engine reads/writes
committed git state (HEAD), never the worktree, and auto-commits to get there: `volt push` commits then lands
`volt/ide` on HEAD; `volt pull` commits then `git merge volt/ide`. The *view* (`status` + diff tab) reads the working
tree, so an edit shows as outgoing the moment you save.
**Why:** makes it a textbook git remote — push/pull semantics transfer directly, `volt/ide` stays local, auto-commit
collapses the workflow to two commands; committed HEAD gives one unambiguous source of truth.
**Rejected:** a hidden `refs/volt/ide` ref; pushing the uncommitted worktree; a parallel deterministic IDE-commit on
push; delegating the outgoing diff to Source Control (shows working-vs-HEAD, empty once committed).
→ captured in spec `ide-sync`.

### D10 — CI + scheduled auto-sync (2026-06-26)
**Decision:** GitHub Actions enforce the fork invariants (`volt-ci.yml`) on every push/PR; a weekly job
(`volt-upstream-sync.yml`) merges `upstream/dev` and opens a PR if clean.
**Why:** the pre-push hook is bypassable; upstream moves ~100 commits/2 days.
**Rejected:** local-only guards; manual-only syncing. → captured in spec `upstream-sync`.

### D9 — Committed-junk guard in check-divergence (2026-06-26)
**Decision:** `check-divergence` flags `*.bak`/`*.orig`/`*.swp`/`.DS_Store`/… anywhere in the fork's files.
**Rejected:** gitignoring them (silent). → captured in spec `upstream-sync`.

### D8 — Sync = `git merge` + `sync.ts`; `export-overlay` removed (2026-06-26)
**Decision:** one signal-flow command (`sync.ts`) verifies a merge; `merge-upstream.ts` wraps the whole flow.
**Rejected:** the patch-overlay distribution model (`export-overlay.ts`) — Volt is a *deployed product*, not a patch
shipped against a pinned opencode release. → captured in spec `upstream-sync`.

### D7 — Monetize by reselling hosted AI subscriptions (opencode Go/Zen-style) (2026-06-26)
**Decision:** Volt sells **hosted AI access**, reusing the in-repo gateway (`packages/llm`) + billing
(`console-core`: `UsageTable`/`LiteTable`/Stripe) as-is; the PLC tools stay free.
**Why:** keeps the backend identical (deploy + config, not a rewrite); the moat is the PLC integration, not the AI.
**Rejected:** gating `volt-git`/bridge by license (new entitlement code; opencode's app is BYO-key, no gate).
**Trade-off:** you front the model cost — `LiteTable` limits are the margin throttle. → future spec `monetization`.

### D6 — Own the landing page; keep + sync the agent app (2026-06-26)
**Decision:** `volt-web` is the only frontend Volt fully owns. The agent GUI (`packages/app`/`ui`/`desktop`) is reused
and kept in sync — never forked — customized only via minimal seams.
**Rejected:** a monolithic `volt-app` fork of the GUI (forfeits daily upstream improvements). → future spec `monetization`.

### D5 — Graphical Volt features via additive hooks; desktop GUI = deliberate seams (2026-06-26)
**Decision:** TUI panels via `.opencode/plugins/*.tsx` (additive); a desktop panel via one GUI `<Slot/>` in
`packages/app` rendering `volt-app`. Logo/app-name = small seams.
**Why:** the GUI has no plugin hook; spend the seam budget on generic hooks, not per-feature edits.
→ captured in specs `upstream-sync` + `editor-surface`.

### D4 — `volt-control`: one shared CLI/bridge core, two renderers (2026-06-26)
**Decision:** extract the UI-agnostic core from `volt-vscode` into `volt-control`, rendered by both `volt-vscode` and
`volt-app`. **Rejected:** reimplementing the CLI-driving logic per surface. → captured in spec `editor-surface`.

### D3 — CLI as a first-class opencode tool + gated bash (2026-06-25)
**Decision:** expose `volt` via `.opencode/tool/volt.ts` (typed, approval-gated) **and** gated bash.
**Why:** a custom tool is discoverable by every agent. **Rejected:** an MCP server (heavier). → captured in spec `upstream-sync`.

### D2 — Eliminate config/test seams via native merge-layers (2026-06-25)
**Decision:** Volt config lives in fork-owned `.opencode/opencode.json` (deep-merged over a pristine `opencode.jsonc`);
turbo tasks in per-package `turbo.json`. **Why:** zero-conflict on merge. **Rejected:** a re-patch script (fragile).
→ captured in spec `upstream-sync`.

### D1 — Purely additive fork; verifiable loading (2026-06-25)
**Decision:** Volt only *adds* files / *registers* via hooks / *inserts* minimal seams — never edits upstream file
contents. Loading is provable (`verify-lsp`/`verify-volt-tool`). **Why:** keeps `git merge upstream/dev` near-trivial.
**Rejected:** (implicit) forking opencode. → captured in spec `upstream-sync`.

## Risks / Trade-offs

[Risk] a reader looks for the old prose docs → *Mitigation:* the slimmed docs are pointers to `openspec/` + READMEs.

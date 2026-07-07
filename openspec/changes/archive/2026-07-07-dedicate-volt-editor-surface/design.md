## Context

Today the Volt editor surface is co-located in the host's git UI: VS Code renders a native
`SourceControl` group beside Git (`volt-vscode/src/views/scm.ts`), and the desktop GUI mounts
`VoltIdePanel` in the session view (`volt-app`). Shared CLI/bridge logic already lives in
`@opencode-ai/volt-control` — the "one core, two renderers" split. This change moves both surfaces
into their own dedicated area and adds a Bridge-status view, a Reference & Agent view, and a
diagnostics-summary row.

Because both surfaces grow richer at once, the shared-core boundary matters more than usual — the
user explicitly asked whether `volt-control` is still the right home and warned against duplicate
code. It is, but it is only **half-built**: `volt-control/src/index.ts` still carries the note *"Phase
1 (done): the pure primitives… Phase 2 (next): split the UI-agnostic status/command logic out of
volt-vscode's state/status.ts + commands.ts."* Phase 2 never happened, and the seam already shows:

- **Health → display string is derived three times.** `volt-control` exposes `healthLabel()`, but
  VS Code's `updateGlobalUi` (extension.ts:123-182) hand-rolls its own worst-state-wins aggregation +
  text/icon/tooltip switch, and the desktop `HealthDot` (VoltIdeHeader.tsx:151) **re-inlines** the
  online check + label — with the comment *"isBridgeOnline lives in a Node module (node:http),
  unimportable here."*
- That comment is the root cause: `healthLabel` sits in `health.ts`, which imports `node:http`, so the
  sandboxed Solid renderer cannot import it and re-implements it instead. `volt-control` already
  solved this shape once — the Node-free `/channels` subpath — but never applied it to the display
  mappers.

Adding two new Bridge-status views (one per surface) on top of this would create a 4th and 5th copy of
the same health→text mapping.

## Goals / Non-Goals

**Goals:**
- Give Volt a dedicated area on both surfaces (VS Code activity-bar container; desktop dedicated area),
  moving IDE-sync out of the git UI.
- Add Bridge-status and Reference & Agent views, and a diagnostics-summary row that jumps to the native
  Problems panel.
- Fix `volt-vscode`'s stale LSP config wiring.
- **Finish `volt-control` Phase 2 only for what the new views consume** — extract the pure
  health/aggregate/drift → *display model* so all surfaces render one function instead of re-deriving.

**Non-Goals:**
- No redesign of `volt-control`'s architecture — the "one core, two renderers" split stays; we complete
  it, not replace it.
- No custom diagnostics tree — the diagnostics summary reads the host's own diagnostics collection and
  jumps to the native Problems panel.
- Not extracting host-specific view code (VS Code `TreeDataProvider`, Solid components, per-file diff
  rows) — those are genuinely per-surface and forcing them into the core would be over-abstraction.
- Not rewriting the polling loop (`VoltStatus` heartbeat/mtime-poll) into the core in this change (see
  Open Questions).

## Decisions

**D1 — Keep `volt-control`; complete Phase 2 for the display layer.** Add a **Node-free** display
module (pure functions, zero `node:*` imports) exposing:
- `aggregate(statuses)` → worst-state-wins reduction over bound workspaces (merge > mismatch > offline
  > no-project > degraded > drift > in-sync), returning a neutral `VoltDisplay` model
  (`{ severity, label, tooltip, action?, incoming, outgoing }`).
- `healthDisplay(state)` → the per-workspace health → `{ online, label, tone }` mapping the desktop
  `HealthDot` currently inlines.

Export it via a Node-free subpath (mirroring `/channels`) so both the VS Code extension **and** the
sandboxed Solid renderer import the *same* mapping. VS Code's `updateGlobalUi` status bar, the two new
Bridge-status views, and the desktop `HealthDot` all render `VoltDisplay`. This deletes the 3 (soon 5)
divergent copies. *Alternative rejected:* leave `healthLabel` in `health.ts` and let each surface keep
its copy — that is exactly the duplication the user flagged, and it drifts silently.

**D2 — VS Code dedicated area = `viewsContainers` + `views`.** Replace the native `SourceControl`
provider with an activity-bar view container holding tree views: IDE Sync (two drift groups + title
actions Pull/Push/Force/Build/Refresh), Bridge status, Reference & Agent. The `scm/title` and
`volt.scm.more` menus move to `view/title` / `view/item/context`. The click-to-diff command and the
`VoltContentProvider` ref provider are unchanged (still `vscode.diff` over `VOLTIDE↔BRIDGE/WORKSPACE`).
*Alternative rejected:* a webview panel — heavier, loses native tree affordances (decorations,
context menus, keyboard nav) for no gain.

**D3 — Diagnostics summary is host-owned, not a `volt-control` concern.** LSP diagnostics are published
by the language client to the host's diagnostics collection (`vscode.languages.getDiagnostics()` in VS
Code). The summary reads that collection, groups counts per file, and its click runs the host's
"filter Problems to Volt" action. It does **not** go through the CLI/bridge, so it correctly stays out
of `volt-control`. This keeps the shared core about the CLI/bridge only.

**D4 — Fix the LSP wiring + drop legacy product naming.** Three drifts compound: (a) `lsp.ts` reads
`volt.lsp.*` (nonexistent keys); (b) the manifest declares them under `volt.structuredText.*` — the
LSP's *old* name, misleading now that it's `volt-lsp-iec` covering ST **and** VG; (c) the launch points
`command` at a nonexistent `dist/server.js` and passes neither `--stdio` nor a vendor flag, so the
stdio-only server never enters server mode. Fix all three: rename the config namespace to `volt.iec.*`
(product = IEC LSP), keep the `structured-text` language id (a real language — ST is one IEC sublanguage,
per the user), resolve the server module robustly (override `volt.iec.server` → packaged
`dist/lsp-server.js` → dep → dev sibling), launch it as a Node module over stdio with
`--stdio --codesys|--twincat`, and forward `diagnostics.*` + `vendor` + `trace` into
`initializationOptions`. The diagnostics summary filters on the diagnostics' own `source`
(`"volt-lsp-iec"`), not file extensions. Also fix the stale `lsp-st` reference in `CLAUDE.md`. Small,
contained; correctness + a naming cleanup the user asked to fold in.

**D5 — Desktop dedicated area is realized *inside* the single existing seam, not by relocating it.**
The load-bearing fork invariant is that the desktop's only upstream seam is the one `<VoltIdePanel/>`
mount line in `packages/app/src/pages/session.tsx`, and `packages/app` must never grow a second seam.
Moving the mount into a new left-nav/activity container would itself be a *new* seam location in
`packages/app` — forbidden. Therefore the desktop "dedicated area" is delivered by **expanding what
`VoltIdePanel` renders** — a self-contained, self-framed surface (IDE Sync + Bridge status +
Reference & Agent, all owned by `volt-app`) hung off the *same single* seam line. VS Code, being a
fork-owned extension, gets a true activity-bar container (D2); the desktop gets an enriched
self-owned panel through the one seam. This is the deliberate asymmetry: the desktop stays
implementable with a single addition to opencode's code. *Alternative rejected:* a desktop left-rail
Volt container — it cannot be built without a second `packages/app` seam, violating the white-label
invariant.

## Risks / Trade-offs

- **Scope creep into a `volt-control` rewrite** → Mitigation: extract *only* the display model (D1);
  explicitly out-of-scope everything in Non-Goals. The Node-free-subpath pattern already exists, so D1
  is a small, proven move.
- **Losing native SCM affordances by leaving the SourceControl API** → Mitigation: use native
  `TreeView`s (not a webview), which keep decorations, context menus, and keyboard nav (D2). File-
  explorer drift decorations are unaffected (separate `FileDecorationProvider`).
- **Users accustomed to Volt-in-Source-Control** → Mitigation: it is a deliberate product decision
  (proposal), the activity-bar icon is discoverable, and the aggregate status-bar item still points
  into the area. Reversing the prior spec decision is documented in the delta (REMOVED requirements).
- **Two surfaces diverging again after this change** → Mitigation: D1 makes the display model the
  single source; a follow-up could extend it to the polling loop if drift reappears.

## Open Questions

- Should the `VoltStatus` polling/refresh state machine (heartbeat + mtime poll + keep-last-good) also
  move into `volt-control` as a framework-neutral watcher? The desktop currently lacks the mtime-based
  auto-refresh, so this is a latent feature gap, not duplication. Deferred: extract the display model
  now (cheap, kills real duplication); revisit the watcher only if the surfaces drift. Noted, not
  blocking.
- Does the desktop GUI's "dedicated area" get its own nav entry, or reuse an existing panel slot? To be
  resolved against the current `packages/app` navigation during implementation (host-owned detail, no
  spec impact).

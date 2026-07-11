# Tasks — LSP completeness audit

Ordered by impact. Each: implement + colocated test (the one that would've caught it) + corpus gate +
commit. `[x]` when landed.

## P0 — correctness bug (rename corrupts code)

- [x] **Type-position references** — `findReferences` walks only statement bodies, so type-position uses
  (`inst : FB_X`, `EXTENDS`, `IMPLEMENTS`, return types) aren't counted → **renaming a type silently leaves
  those uses stale** (broken project). Scan declaration type-positions too. Test: rename a type, assert the
  `: FB_X` decl uses are included; and the R23 narrowing scenario (same-name field not over-matched).

## P1 — resolution depth (one root cause lights up a whole column)

- [x] **Interface member scope** — added an `interface` Type kind; completion/hover/sig-help/nav resolve
  interface members; hover no longer mis-matches the builtin `MOVE`. Corpus gate green.
- [x] **GVL-qualified member completion** — collect GVL block members by uri (incl. `qualified_only`).
- [ ] **DEFERRED (model work) — Device instances into the symbol tree.** Devices are name-only (`.device` is a
  descriptor, not ST → no type, so member access is *inherently* blind, and there's no clean go-to-def target).
  Making the NAME resolve everywhere needs a new `device` `SymbolKind` (+ every exhaustive `Record<SymbolKind>`),
  `.device`-path tracking in workspace-refs, and injection after `buildSymbolTable`. Modest value (name only),
  real cross-cutting cost + a design decision. Diagnostics already skip devices (no false "unresolved"), so the
  only gap is completion offering the name / a descriptor hover. Do only if a device-heavy project needs it.

## P2 — VG (graphical) parity

- [x] **document-highlight VG variant** — `documentHighlightsAnywhere`, wired.
- [x] **folding over VG networks** — one fold per NETWORK.
- [x] **semantic-tokens: elementary type names** color as `type` (was `variable`) on every file.
- [ ] **DEFERRED (niche + cross-layer plumbing) — call-hierarchy + selection-range over VG.** call-hierarchy
  iterates `stBodies` so FBD/LD `fb_call`s are invisible; selection-range is token→whole-POU inside a network.
  Both are feasible (VG networks *do* expose calls/operands — `operandStatements` handles `fb_call`) but the
  wiring is cycle-sensitive (services↔graphical) and the features are low-frequency on graphical bodies. Follow
  the `referencesAnywhere` server-wiring pattern when picked up.

## P3 — test debt (untested guarantees — regression protection, no bug)

- [ ] Vendor dialect layer (R2/R3); formatting comments (R30, also reconcile spec's "relocate" vs verbatim impl);
  formatter canonicalization from non-canonical input (R29); bare-enum-member nav (R27); VG device resolution
  (R28); `.library`-change re-index (R8.3); reconcile the stale body-parse-fallback scenario (R10.1). All
  test-only (or spec-reconcile) — they protect working behavior; none is a shipped bug.

## Done

- [x] The audit itself (4-agent, lens #1 + #3) — findings captured in `proposal.md` + this list.

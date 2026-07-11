# Tasks — LSP completeness audit

Ordered by impact. Each: implement + colocated test (the one that would've caught it) + corpus gate +
commit. `[x]` when landed.

## P0 — correctness bug (rename corrupts code)

- [ ] **Type-position references** — `findReferences` walks only statement bodies, so type-position uses
  (`inst : FB_X`, `EXTENDS`, `IMPLEMENTS`, return types) aren't counted → **renaming a type silently leaves
  those uses stale** (broken project). Scan declaration type-positions too. Test: rename a type, assert the
  `: FB_X` decl uses are included; and the R23 narrowing scenario (same-name field not over-matched).

## P1 — resolution depth (one root cause lights up a whole column)

- [ ] **Device instances into the symbol tree** — `.device` excluded from `SOURCE_EXTENSIONS`; device names
  only feed the diagnostics skip-set, never `buildSymbolTable`; assist services don't even get `WorkspaceRefs`.
  Blind across nav/completion/hover/sig-help/semantic-tokens. Expose read-only device descriptors so refs
  resolve. Test: def/hover/completion on a device instance.
- [ ] **Interface member scope** — `resolveTypeExpr(interface)` builds no scope → `drv.Move` completion/
  sig-help blind and hover *wrong* (shows builtin `MOVE`). Give interface types a member scope + add
  `interface` to `scopeOfType`. Test: completion/hover/sig-help on an interface-typed instance.
- [ ] **GVL-qualified member completion** — `GvlName.field` blind (no child scope for the GVL block).

## P2 — VG (graphical) parity (missing graphical-aware variants)

- [ ] **document-highlight VG variant** — highlight is ST-only; add `documentHighlightsAnywhere`, wire it.
- [ ] **call-hierarchy over VG bodies** — calls inside FBD/LD are invisible (iterates `stBodies`).
- [ ] **folding + selection over VG networks** — folding refuses graphical bodies; selection is coarse.
- [ ] **semantic-tokens coloring** — builtin primitives (`INT`/`BOOL`) and library/device refs color as
  `variable`. Recognize the primitive set; feed library/device into the classifier's scope.

## P3 — test debt (untested guarantees; silent degradation risk)

- [ ] Vendor dialect layer (R2/R3) — no test withholds a TwinCAT-only name / flags a CODESYS-only `__` op.
- [ ] Formatting comments (R30) — no format test has a comment; impl preserves verbatim vs spec's "relocate"
  → reconcile spec↔behavior, then test the invariant that survives.
- [ ] Formatter canonicalization (R29) — tests start from canonical input; add non-canonical → canonical.
- [ ] Bare-enum-member navigation (R27); VG device resolution (R28); `.library`-change re-index (R8.3).
- [ ] Reconcile the stale body-parse-fallback scenario (R10.1) with current parse-error-as-diagnostic behavior.

## Done

- [x] The audit itself (4-agent, lens #1 + #3) — findings captured in `proposal.md` + this list.

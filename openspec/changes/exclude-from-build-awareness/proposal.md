## Why

**Exclude-from-build objects are diagnosed against no ground truth.** CODESYS never compiles objects
flagged Build → Exclude from build, so their undeclared references are never checked. Pro2193's
`MagazineBaseFB` has empty `VAR` sections and methods referencing members declared nowhere, yet the
project is "clean" because the object is excluded. This breaks the coverage-harness invariant
*"compiles clean ⇒ every diagnostic is a false positive"* — true only for **built** objects; ~200 of
the ~1798 remaining `unresolved-identifier` diagnostics on the corpus are excluded-object noise.
Confirmed 2026-07-02: a live bridge pull is byte-identical to the corpus and the object is excluded in
the IDE — the bridge is faithful; not a pull bug.

**The "read-only language" concept is obsolete.** ST, FBD, and LD are all read-write and round-trip as
text. The remaining graphical languages, CFC and SFC, are not "read-only" — they simply have no text
representation. Modeling them as a read-only *access* state (a `READONLY <LANG>` marker the LSP
detects, plus a would-be wire flag) is machinery for a distinction that no longer exists. A
complication that forced the issue: methods/actions are inlined child bodies of a POU, and a child can
be graphical while its parent is ST — so read-only-ness was never per-item anyway.

## What Changes

Two things, one change:

1. **Add `excludeFromBuild`** — a per-item boolean the bridge derives from the CODESYS ScriptObject's
   `effectively_excluded_from_build` (inheritance-aware: a folder excluded from build excludes its
   subtree), emitted on `/refs` and `/fetch`. The LSP skips semantic diagnostics on excluded items, and
   the coverage harness measures precision over built objects only. VS Code shows an `EX` badge.

2. **Retire the read-only-language concept.** CFC/SFC bodies materialize with an **informational
   marker** (`(* Graphical <LANG> — edit in the IDE; Volt does not represent it as text *)`) instead of
   the `READONLY <LANG>` marker. There is no read-only wire flag and no marker-based detection: the
   marker is human/AI-readable content, nothing more. Push-refusal on graphical bodies stays keyed on
   **live IDE state** (`BodyLanguage` ∈ {CFC,SFC}) — the data-loss safety net is untouched. The
   `RO` badge stays for opaque **config kinds** (library manager / task / visualization), which are
   read-only by item *kind*, not by language — that mechanism is unchanged.

## Capabilities

### New Capabilities
<!-- none — this extends existing capabilities -->

### Modified Capabilities
- `bridge-protocol`: `/refs` and `/fetch` gain a per-item `excludeFromBuild` boolean; the note that
  read-only "is self-describing in content (`READONLY <LANG>`)" is removed — graphical bodies carry a
  non-semantic informational marker, and push-refusal is by live IDE state.
- `vg-language`: CFC/SFC bodies materialize as an informational marker (not a `READONLY` control
  marker) and are not analyzed; ST/FBD/LD are the read-write forms. Read-only-language framing removed.
- `language-server`: the LSP SHALL skip diagnostics on excluded items; "clean ⇒ zero diagnostics"
  holds over built objects only. Read-only-marker detection is removed.
- `editor-surface`: an `EX` badge is added for build-excluded items; the `RO` badge remains, scoped to
  read-only config kinds (item-kind-based), no longer to graphical POUs.

## Impact

- **Code:** `packages/volt-bridge` (`CodesysObjectModel.IsExcludedFromBuild`, `CodesysDriver.Tree`,
  `ProjectItem`, `/refs`+`/fetch` wire; `Materializer` marker → informational marker; `VgBody` drop
  `IsReadOnly`/`ReadOnlyLanguageOf`; `PushService` drop the dead marker check, keep the live-state
  guard; Beckhoff parity), `packages/volt-git` + `packages/volt-control` (fetch/materialize/sidecar for
  `excludeFromBuild`; drop `bodyIsReadOnly` marker logic; `readExcludedFromBuild`), `packages/volt-lsp-codesys`
  (remove `isReadOnlyBody`; skip excluded units; `scripts/coverage-report.ts` + `real-corpus.test.ts`),
  `packages/volt-vscode` (`providers/decorations.ts`: add `EX`, keep `RO` for config kinds).
- **Wire:** additive optional `excludeFromBuild` — absent ⇒ `false`. No `readOnly` field.
- **Migration:** the `READONLY` marker is replaced by the informational marker; a re-pull regenerates
  graphical bodies. Tests/fixtures asserting `READONLY <LANG>` are updated.
- **No new dependencies.** Verify the live `effectively_excluded_from_build` read via `/debug`
  (`IDebugIntrospect`) during implementation.

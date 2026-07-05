## Why

A three-way audit (semantic / query / reference-parser) found the LSP's type-and-semantic foundation has
accreted into scattered, duplicated, cross-leaking layers — and the duplication has produced real bugs:

- **Elementary-type facts live in 7 files with 5 mutually-inconsistent name lists** (`NUMERIC_RANK`,
  `INTEGER_TYPES`, two `ELEMENTARY_TYPES` lists, `ELEM_ABBREV`/`DATETIME`/`DURATION`, range prose in
  `data-types.ts`). Inconsistencies are latent bugs: `ANY_MAGNITUDE` in one catalog only, `BIT` missing from
  the intended source of truth, canonicalization done 3 ways, a **verbatim-duplicated `ENUM_ISOLATED` block**,
  and **dead long-form date entries that can never match**.
- **Type-compatibility policy is split across 3 layers** — `isAssignable` (a check, imported by a sibling
  check), `isAcceptableSource` (the *reference* layer), and an inline narrowing rule — with two halves of the
  same REAL↔LREAL fact kept in sync by a comment.
- **`humanKind` exists twice with different output** → hover and completion show the user different words for
  the same symbol kind. **`definition`/`hover` re-inline resolution** instead of the shared service → nav can
  drift from references/rename. **`call-hierarchy` is still name-only** (imprecise where references is exact).
- Shared logic copied 3–7×: symbol→Location, POU-body accessor, find-unit-by-name, scope-tree walks,
  token-at-offset, and **4 type-expression renderers** (+2 in VG).

Building the static typechecker on this would bake the mess in. Instead, rebuild the foundation *clean*: a
layered architecture with **one source of truth per concern** and no cross-layer leakage. The 3594-test suite
+ corpus ratchet + conformance replay are the behavioral spec — they hold green at every step, so a
ground-up-clean core is verifiable, not risky.

## Capabilities

### New Capabilities

- **A cohesive type-system layer** (`semantic/type-system/`): the elementary-type SSOT, the rich `Type` model,
  declared-type resolution, expression inference (one engine), constant evaluation, the compatibility relation,
  and one type renderer — self-contained and independently tested.
- **Shared semantic services**: one `scope-nav` (scope-tree navigation), one symbol-resolution entry
  (`symbolAtOffset`), consumed by BOTH checks and LSP queries.
- **Shared query utilities**: one `locationOfSymbol`, one hierarchy core (call+type), one `symbol-kinds`
  mapper set + one `humanKind`, one token scanner.

### Modified Capabilities

- **`language-server` diagnostics + navigation** — the 18 checks and the nav/hover/completion queries migrate
  onto the shared type-system + services (behaviour-preserving), fixing the `humanKind` wording split, the
  nav-resolution drift, and the name-only `call-hierarchy` imprecision along the way.

## Impact

- `packages/volt-lsp-iec/src/` — a new `semantic/type-system/` module (elementary facts, `Type`, resolve,
  infer, const-eval, compat, render), a `semantic/scope-nav.ts`, and shared `lsp/queries/` utils; the scattered
  copies deleted; oversized files split (`symbol-table-build`, `format` → extract `editorconfig`, `hover`).
  Parser: additive subrange capture. No wire/protocol change.
- Unblocks `st-static-typechecker`: its rich model + const-eval + `assignable` are delivered here as the clean
  core; that change narrows to the new diagnostic rows (overflow/subrange/bounds/…) on top.
- Deferred (follow-ups, noted not done here): standardizing every check signature (R6), and unifying VG's
  parallel string-inference onto the shared engine.

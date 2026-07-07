## Why

The LSP's type-checking is complete and byte-parity-verified for **errors**, but not for **warnings**. Today it
emits exactly ONE implicit-conversion warning (`LREAL→REAL`); the code (`narrowing.ts`) even says "wider
narrowings are added once each is recorded." The compilers emit a whole **family** the LSP is silent on:
signed↔unsigned "change of sign" (`WORD→INT`, `INT→UINT`, `UINT→INT`), wider→narrower "possible loss"
(`DINT→INT`, `LINT→DINT`), and more. These are safe misses (never false positives), but they mean the editor
and the build pane disagree: the compiler underlines a conversion the LSP shows as clean.

We also don't *know* the complete classification. The FP-bait battery pinned ~a dozen conversion cases live,
but there is no systematic "source type × target type → warn / error / clean" matrix. So "match CODESYS" is
currently a judgement call for any pair we haven't happened to fixture.

The goal: **the LSP emits EXACTLY the warnings and errors the compilers emit for implicit type conversions —
100% parity, both severities — derived from recorded ground truth, not guessed.** This is the same method that
caught the `constant-overflow` false positive: let the live compiler define the rule.

## What Changes

Use the **proven type-checker approach** (Roslyn/Clang-style), not a bespoke empirical process — see
`design.md`. Concretely:

- A single **conversion-classification function** `classifyConversion(src, dst): ConversionKind` in `types/`,
  co-located with `elementary`/`compat` (one source of truth). It is driven by the type lattice we already
  have (family, width, signedness, rank) and implements the **IEC 61131-3 + CODESYS documented conversion
  rules** — `{identity | widen | narrow | sign-change | cross-family | incompatible}`. `isAssignable` /
  `isNarrowing` become thin views over it.
- The `narrowing-conversion` check generalizes into an **implicit-conversion** check that maps each
  non-identity kind to its severity + message (warn for narrow / sign-change; the error kinds already owned by
  `assignment` / `conversion-source`). Conservative-skip on unknown types is preserved (0-FP is sacred),
  per-vendor wording via `messages`, warnings never counted in the zero-ERROR floor.
- The live compiler is the **validation oracle, not the rule source**: a generated conversion matrix (every
  elementary pair × the assignment/arithmetic/comparison/typed-literal contexts) is recorded against CODESYS +
  TwinCAT and diffed against `classifyConversion` — every disagreement is a bug in our classification (or a
  vendor quirk to encode), surfaced by the existing replay. A representative slice is committed as fixtures.
- A **completeness audit** applies the same "classify → validate against oracle" loop to every other type
  category (assignment, binary-op, deref, subrange, array-bounds, conversion-source), so parity is *proven*,
  not assumed.

## Impact

- Affected spec: `st-language-server` — MODIFY "Narrowing-conversion diagnostic" (generalize to the full
  implicit-conversion family) + ADD "Type-conversion parity is matrix-verified".
- Affected code: `packages/volt-lsp-iec/src/types/` (the rule table), `src/analysis/checks/types/` (the
  generalized check + the retired hardcoded pair), `src/analysis/messages.ts` (the conversion-warning
  wordings), `test/conformance/` (matrix fixtures + recordings).
- No behavior regression: additive (new warnings) + conservative-skip preserved; existing error checks and the
  zero-ERROR corpus floor are the behavioral floor.

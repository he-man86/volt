# Tasks — complete-type-checking

Invariant for every task: `cd packages/volt-lsp-iec && bun test` + `bun typecheck` + corpus 0-error +
conformance replay green before its commit. 0-FP (conservative-skip on `UNKNOWN`) is never traded for coverage.

## A. The classification function (proven core — `types/`)

- [x] A.1 Add `ConversionKind` + `classifyConversion(src: Type, dst: Type): ConversionKind` to `types/`
      (co-located with `elementary`/`compat`). Reads ONLY lattice facts (family, bits, signed, rank).
      Implements the IEC 61131-3 hierarchy: identity; widen (rank↑, same discipline); narrow (width↓, same
      family); sign-change (same width, signed↔unsigned); cross-family; incompatible. `UNKNOWN` on either side
      → a skip kind (no diagnostic).
- [x] A.2 Re-express `isAssignable` = `classify(...) !== "incompatible"` and `isNarrowing` = `classify(...) ===
      "narrow"` — delete the duplicate logic, keep the public signatures. Existing type tests stay green.
- [x] A.3 Unit-test `classifyConversion` exhaustively over the elementary lattice (a golden table): every pair
      → expected kind. This is the offline spec of our classification, independent of the bridge.

## B. Generalize the check (`analysis/`)

- [x] B.1 `narrowing.ts` → `implicit-conversion.ts`: walk assignment/init/arg sites, call `classifyConversion`,
      map `narrow`→"possible loss" WARNING and `sign-change`→"change of sign" WARNING via `messages`
      (per-vendor). The single confirmed pair (`LREAL→REAL`) becomes one row of the general rule.
- [x] B.2 Wire the conversion-warning messages into `messages.ts` (CODESYS + TwinCAT wording, incl. the
      `'unsigned Type X' to 'signed Type Y' : Possible change of sign` form already recorded live). Provisional
      until locked by the matrix pass (C.2).
- [x] B.3 Confirm the ERROR kinds still route to the existing checks (`assignment-type-mismatch`,
      `conversion-source-mismatch`) with no double-emit — one site, one diagnostic.

## C. The oracle (validate, don't invent — `test/conformance/` + `scripts/`)

- [ ] C.1 Generate the conversion matrix as `LanguageTest`s: every elementary pair × contexts (plain assign,
      typed-literal, untyped literal, arithmetic result, comparison). Auto-generated in `fixtures/` (a
      generator, not 200 hand-written entries).
- [ ] C.2 Record the matrix against live CODESYS + TwinCAT (`RECORD_ONLY`/merge). The recording is the vendor
      ground truth (severity + exact wording per pair).
- [ ] C.3 Diff `classifyConversion` + `messages` against the recording via `replay.test.ts`. Resolve EVERY
      disagreement: fix the classification (a real bug) or encode a vendor quirk (per-vendor rule). Lock the
      wordings from PROVISIONAL to confirmed.
- [ ] C.4 Commit a representative slice as fixtures (a dozen per family — widen/narrow/sign-change/cross/
      incompatible exemplars); keep the full generated matrix reproducible from the generator, not committed
      wholesale. Ratchet floors rise.

## D. Completeness audit — every other type category

- [ ] D.1 Apply the same "classify → validate against oracle" loop to: `assignment-type-mismatch`,
      `binary-op-type-mismatch`, `conversion-source-mismatch`, `deref-non-pointer`, `subrange-out-of-range`,
      `array-index-out-of-bounds`. For each: a small generated case set, recorded, diffed — confirm the LSP
      emits exactly what the compiler does (both severities) or document the divergence.
- [ ] D.2 Reconcile the two known divergences with the new classification: `subrange` (compilers use the
      conversion-error form — fold into `classifyConversion`'s cross-family/narrow path so wording matches) and
      the signed/unsigned warnings that were previously "misses" (now emitted by B.1).

## E. Close-out

- [ ] E.1 Corpus 0-error holds (warnings never counted in the ERROR floor); full suite + typecheck green;
      conformance replay green with the raised floors; `check-divergence` clean.
- [ ] E.2 Update `st-language-server` spec (this change's deltas) + the `build-st-language-server` matrix rows;
      note the remaining non-goals (no invented range analysis).

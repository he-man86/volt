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

- [x] C.1 `scripts/conversion-matrix.ts` generates the full N×N elementary-numeric matrix (196 pairs) as ONE
      instantiated probe FB and builds it live — a *generator+validator*, not 196 committed fixtures (the pairs
      are reproducible on demand; only a representative slice is committed, per C.4).
- [x] C.2 Ran the matrix against live CODESYS (:8556) AND TwinCAT (:8555). Matches diagnostics back to each
      pair by the type names in the message (the bridge reports line 0 for build diagnostics, so line-mapping is
      impossible). Both vendors: **196/196** severity-identical.
- [x] C.3 The first CODESYS run exposed 21 real classification gaps (all `classify=widen` where the compiler
      WARNS): signed→WIDER-unsigned is still a change-of-sign, and integer→real loses information once the int
      exceeds the float mantissa (REAL 24, LREAL 53). Fixed `classifyElementary` — both use the EXISTING
      sign-change / loss messages (confirmed byte-identical live). Re-ran: 196/196 both vendors.
- [x] C.4 Committed a representative slice as fixtures (`sign_change_sint_to_uint`, `loss_dint_to_real`), recorded
      live on both vendors; the full 196-pair matrix stays reproducible from `conversion-matrix.ts`, not committed
      wholesale. Ratchet rose: CODESYS 247→249, TwinCAT 248→250. Golden `classifyConversion` table extended.

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

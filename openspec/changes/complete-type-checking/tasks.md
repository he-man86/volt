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

- [x] D.1 `assignment-type-mismatch` is the matrix's ERROR column — all 196 pairs validated both vendors (C.2),
      so the whole implicit-assignment surface is oracle-confirmed. The others already carry live recordings in
      the ratchet: `conversion-source-mismatch` (conversion.ts fixtures), `deref-non-pointer` + `array-index-out-
      of-bounds` (locked byte-identical, confirmed live), `binary-op-type-mismatch` (MOD/operator fixtures). No
      new divergence surfaced.
- [x] D.2 Reconciled both known divergences: `subrange-out-of-range` now emits the compilers' own type-CONVERSION
      wording (`Cannot convert type '200' to type 'INT (1..100)'`, base type + space + range — probed live, named
      AND inline render identically) by folding onto `cannotConvert`; removed the bespoke `subrangeOutOfRange`
      message and dropped subrange from `KNOWN_DIVERGENCES` (now in the ratchet, +2 each vendor). The signed/
      unsigned "misses" are now emitted by B.1 and validated by the matrix (C.3).

## E. Close-out

- [x] E.1 Corpus 0-error holds (8/8, warnings not in the ERROR floor); full suite green (268 pass); typecheck
      clean; conformance replay green at the raised floors (251 CS / 252 TC); `check-divergence` clean.
- [x] E.2 Updated the change's `st-language-server` spec deltas to the AS-BUILT rules (sign-change at any width
      signed→unsigned, int→real mantissa loss, no `cross-family` kind, subrange folded onto `cannotConvert`) and
      refreshed the `build-st-language-server` status matrix rows + ratchet counts. Non-goal held: NO invented
      range/value analysis — only the type-lattice classification the compilers themselves apply.

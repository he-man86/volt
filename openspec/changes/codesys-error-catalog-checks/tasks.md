## 1. Catalog scaffold (data model) — DONE

- [x] 1.1 Catalog entry shape + typed accessor `src/reference/error-codes.ts` over `docs/codesys-reference/error-catalog.json`. Shape: `{ code, url, kind, category, cause, message: string|string[], repro, expect: string[], fix, status: "implemented"|"checkable"|"ide-only"|"pending", ourCheck, ourCode, lint, verified: { codesys, twincat } }` + `errorCatalog()` / `lookupErrorCode()`.
- [x] 1.2 Seed every code from `_toc.json` as a stub so the catalog enumerates all codes before harvest fills them.
- [x] 1.3 Completeness test (`error-catalog.test.ts`): one entry per `_toc.json` code + well-formedness (harvested ⇒ message; repro ⇒ expect).
- [x] 1.4 **Catalog-integrity guard (gap found):** URL-derived codes can mislabel — `_cds_error_c0008-2040066.html` is C0454, not C0008. Split fixed + real C0008 fetched. Keep the completeness test as the guard against regression.

## 2. Harvest — DONE (approach corrected)

- [x] 2.1 **CORRECTION to original plan:** we DO mirror the docs' own fixtures — capture the "Example of the error:" block as `repro`, its concrete "Message:" as `expect`, and the "Example of an error correction:" block as `fix`. These are functional test fixtures (input code → compiler output), not prose. Do NOT copy the pages' prose descriptions or fix-explanation paragraphs; `cause` stays a one-line paraphrase.
- [x] 2.2 Ran the harvest (16 sonnet agents): all codes have message/category/cause; ~199 have `expect`, ~197 have `repro`, ~78 have `fix`.
- [ ] 2.3 **Fidelity pass (gap found):** the bulk harvest is reliable for MESSAGES but lossy for MULTI-OBJECT code examples (e.g. C0565 dropped the `PROGRAM PLC_PRG` unit + `END_` keywords). Repros are DRAFTS. Do not trust a harvested repro wholesale — finalize a well-formed repro per code at implementation time (§5). Single-unit repros are usually fine as-is.
- [ ] 2.4 Rewrite the stance section of `13-error-messages.md`: catalog is the coverage checklist; our diagnostics map to `Cnnnn` as metadata (own `source`/`code` unchanged).

## 3. Triage (EXECUTE NOW)

- [ ] 3.1 Assign each code exactly one status. Rubric: `implemented` (a check emits it AND its automated test passes with our wording + a faithful repro) · `checkable` (offline-analyzable, to build) · `ide-only` (needs a live build / library resolution — record the reason). A `covered` code whose wording/repro is not yet reconciled stays `checkable` with `ourCheck` set (a tracked reconciliation), NOT `implemented`.
- [ ] 3.2 Map each existing check to its code(s) by MESSAGE correspondence (not guesswork): set `ourCheck`/`ourCode`. Known: C0032→assignment/binary/conversion (`cannotConvert`), C0077→unknown-type, C0004→unknown-member (`notAMember`), C0037→external-write (`noInput`), C0565/C0564/C0566→lifecycle, plus duplicate-declaration, var-section-placement, deref, abstract-instantiation, interface-impl, array-bounds, subrange, call-arguments.
- [ ] 3.3 For every mapped code, decide flip-to-`implemented` per code: it flips ONLY when `expect` is set to OUR live-confirmed wording AND a faithful repro makes the automated test pass. Where our wording ≠ the docs wording (**docs-vs-live drift is systemic** — C0004 "is no component" vs docs "is not a component"; C0008/C0565 differ), keep `expect`=our wording, record the docs value for the live-build reconciliation, and leave `verified.codesys=false` until §4.
- [ ] 3.4 Honesty test: fail if an `implemented` code has no faithful repro/expect, or if a code claims `ourCheck` that isn't a registered check.

## 4. Conformance (live-build oracle — deferred until IDEs available)

- [ ] 4.1 Extend the conformance harness to compile a code's `repro` via the live `/build` and capture the emitted `Cnnnn: <message>` for both vendors (`:8556` CODESYS, `:8555` TwinCAT).
- [ ] 4.2 Recorder writes captured wording into `expect` + `verified` flags + `messages.ts`; unrecorded stays `PROVISIONAL`. Record CODESYS-only vs shared vs divergent-wording. **This is where every docs-vs-live drift is settled authoritatively.**
- [ ] 4.3 Flip `verified.codesys` for codes already witnessed in a live build log (C0077 unknown-type, C0032 cannot-convert).

## 5. Implementation loop (easy → hard, one code per unit)

- [ ] 5.1 Per code: finalize a well-formed `repro` (mirror the docs example, add missing `END_`/units), set `expect` to our wording, add the check + register + route wording through `messages.ts`, flip `status`→`implemented`; the data-driven harness then runs it BOTH ways (error example ⇒ message; correction ⇒ silent).
- [ ] 5.2 First easy batch (zero-FP, no existing check): C0001 constant-too-large (reuse `types/elementary` + `const-eval`), C0116 duplicate-label, then the parser/syntax codes our error-tolerant parser already surfaces.
- [ ] 5.3 Reconcile the `covered` codes (C0004, C0037, C0565…): flip to `implemented` with our wording + a faithful repro; any that reveal a real behavior gap (e.g. C0565's FB_Exit return-value question) become a bug to fix or a live-build question.
- [ ] 5.4 FP-prone codes → opt-in `LintConfig` lint (default off), like `unknownType`.

## 6. Guardrails

- [ ] 6.1 Corpus zero-FP gate green after each implemented code; a new FP ⇒ make that code an opt-in lint, never weaken the gate.
- [ ] 6.2 `bun typecheck` + full `bun test` green in `packages/volt-lsp-iec`.
- [ ] 6.3 Point `src/analysis` check docs at the catalog as the coverage source of truth; remaining `checkable` codes are tracked follow-on units.

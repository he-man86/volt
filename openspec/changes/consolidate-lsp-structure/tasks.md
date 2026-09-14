# Tasks — consolidate volt-lsp-iec

Source: the two audits of 2026-09-14 (types; structure), findings with file:line in the session transcript and summarised
here. Rule for every task: a failing test first (a recorded fixture when it is vendor behaviour), then the fix, then
"why did no test catch it?". One commit per task group; all offline gates green at each.

## A. Bugs the duplication hid

- [x] A1 **Layering lint is blind** — `scripts/check-layering.ts` ranked `graphical`/`graphical/text` (gone); `network/`,
      `network/text/` and the top-level files (`workspace-refs`, `detect-vendor`, `init`, `source-extensions`) were never
      checked. DONE 2026-09-14: every folder ranked (a new rule 0 fails on an unranked folder — the class fix), cross-group
      `_`-helper imports and cross-layer cycles refused. It found one violation — `oop/inheritance.ts` imported the names
      group's `_identifier-resolution.ts` — fixed by moving that to `analysis/resolution.ts` (C3's first part). README and
      TESTING paths updated. *Why missed:* the lint had no test of its own coverage; renaming a folder silently exempted it.
- [x] A2 **`LDATE#`/`LTOD#`/`LDT#` literals typed DATE/TOD/DT** by `types/infer.ts` `literalType` (lower was right).
      DONE 2026-09-14: recorded (`cc_ldate_literal_into_date`, `cc_ltod_*`, `cc_ldt_*`, `cc_fp_ldate_*`) — the prefix now
      decides. The recording also showed CODESYS prints the abbreviated types in full ('TIME_OF_DAY', 'LDATE_AND_TIME'),
      whatever the declaration wrote: `types/elementaryDisplayName`, the inverse of `ELEM_ALIASES`, used by `renderType`.
      *Why missed:* no fixture had an L-date literal; the transpiler's own literal typing hid that the LSP's disagreed.
- [x] A3 **Lowering ignored a typed literal's prefix**. DONE 2026-09-14: recorded first — `REAL#0.1` stored into an LREAL
      is float32's 0.1 (`typed_literal_real_prefix`), while an INTEGER prefix changes nothing measured: all-constant
      arithmetic still folds at full width (`typed_literal_constant_fold`, already matching). `lower.ts` `typedRealOf`
      types a REAL/LREAL-prefixed literal by its prefix, in expressions and initializers. *Why missed:* no oracle case
      had a typed real literal; lowering's literal typing was written for untyped ones.
- [x] A4 **Six `X_TO_Y` parsers** disagreed on spelled-out type names. DONE 2026-09-14 — recorded first, and the
      recording turned the item around: CODESYS defines NO spelled-out conversion (`TIME_OF_DAY_TO_UDINT` is "Identifier
      'TIME_OF_DAY_TO_UDINT' not defined", `cc_conv_spelled_*`). So the strict parsers were right; the gaps were the loose
      one in `analysis/resolution.ts` (any `…_TO_…` shape resolved — the spelled-out names and a project name like
      `GO_TO_START` were never flagged), lowering reading the spelled-out names as conversions, and `conversion.ts`
      printing `TOD` where CODESYS prints 'TIME_OF_DAY' (`cc_conv_short_source_mismatch`). One `types/parseConversionName`
      — exact table names — now used by all six sites. *Why missed:* every conversion fixture used a short name.
- [x] A5 **Property-accessor scope** — `services/shared/resolve-at.ts`, `assist/signature-help.ts` and
      `assist/inlay-hints.ts` re-walked the bodies with the UNIT scope where `symbols/bodies.ts` uses the accessor's.
      DONE 2026-09-14: `symbols/bodiesAt(offset)`; the three use it (or `bodies()`), and resolve-at's private walker went.
      Tests (`services/accessor-scope.test.ts`, all four red first): definition, signature help and inlay hints on a
      getter-local. *Why missed:* no service test had a property accessor with its own VAR section.
- [x] A6 **Inlay hints rebuilt parameters** from the callee's AST — no hints for an FB-instance call or inherited inputs.
      DONE 2026-09-14: `resolveCallee`, as signature help and the call checks already did. *Why missed:* the only inlay
      test called a METHOD.
- [x] A7 **Network wording hard-coded** — DONE 2026-09-14. Worse than wording: the jump-label check emitted CODESYS's
      text on TwinCAT too, where the compiler reports nothing — a TwinCAT false positive the replay listed as a "known
      divergence". `messages.networkJumpLabelUndefined` is vendor data (undefined on TwinCAT); the pin check uses
      `messages.noInput`; the divergence entry is gone. *Why missed:* the known-divergence set accepted the mismatch
      instead of asking which side was wrong.
- [x] A8 **`this-super-context.ts` compared `THIS`/`SUPER` exactly.** DONE 2026-09-14: recorded — a lower-case `this` or
      `super` in a PROGRAM is the same error ("Expression THIS is not allowed in this context", `cc_self_*`); the check
      now upper-cases first. The byte-identical private helper in `external-write.ts` and `inout-external-access.ts` is one
      `syntax/isSelfRef`. *Why missed:* every THIS/SUPER fixture and test wrote the keyword in upper case.
- [x] A9 **Label keys**: ST `jump-labels.ts` upper-cases, network-text lower-cases. VERIFIED 2026-09-14, no bug — each
      compares its own keys consistently, so both are case-insensitive, and the two never meet. The duplicated
      normalisation is left to C4's shared `nameKey`.
- [x] A10 **Three string-literal length rules.** DONE 2026-09-14 — one `syntax/decodeStringLiteral` (the transpiler's
      measured decoder, moved), used by the transpiler, the string-constant check and the assignment message. Recorded
      18 fixtures on the way, and they found more than the length: `i := 'a$Tb'` is `STRING(INT#3)` (the message counted
      raw characters, 4); the too-long constant is a WARNING, not the error the documentation catalog said; and its
      message prints a prefix of the literal AS WRITTEN sized by the destination (n − 3 characters, or n below 3 —
      lengths 1–7 recorded), where the check always printed `''...'`. *Why missed:* the check was written from the
      catalog, not a recording, and its only fixture happened to be STRING(4), where `''...'` is right.
- [x] A11 **`network-analyze.ts` `synthTypeExpr`** lost string length, arrays and pointers. DONE 2026-09-14: it rebuilds
      a string's length and array/pointer/reference structure; test `network/network-wire-type.test.ts`. *Why missed:*
      no network test typed a wire from anything but BOOL/INT.
- [x] A12 **`lower.ts` `wider` is order-dependent** at equal rank, mixed sign (DINT vs UDINT) — only one order measured.
      DONE 2026-09-14: at the same width the signed type wins on either side, bit strings included (test/exec
      `same_width_mixed_sign_order`, `same_width_bitstring_sign`); `types/commonType`, interp test. *Why missed:* the
      one recorded case (`signed_unsigned_comparison`) compared values whose bits are equal, where left-wins and
      signed-wins give the same answer.
- [x] A13 **Gap 14**: declaration initializers were never type-checked. DONE 2026-09-14: 16 recorded fixtures
      (`cc_init_*`, `cc_assign_*`) give one rule for initializers and assignments alike — a value converts as its type,
      an untyped integer as its narrowest type unless the target holds it (a BOOL takes 0 and 1), a real literal as
      LREAL; a constant expression is silent. `types/literalErrorType`; the assignment check now walks every scalar
      initializer. *Why missed:* the check walked statements only, and no fixture put a mismatch in a declaration.

- [x] A14 (DONE 2026-09-14: 15 fixtures `cc_il_name_*` — LD, LDN, ST, STN, RET, RETC, RETCN, JMPC, JMPCN, CAL, CALCN,
      ANDN, ORN, XORN are each "Unexpected token '<name as written>' found" on the declaration and every use, like R/S;
      `set-reset-name` became `il-operator-name` over that set. CAL left the keyword table: it echoed 'CAL' and added a
      false "Identifier 'cal' not defined". CALC parses as a conditional call with other messages — not claimed.
      *Why missed:* no fixture declared one, and the keyword table's upper-case echo was assumed for every reserved word.)
      **IL operator names as identifiers** — found by the execution oracle twice: CODESYS rejects a variable named
      `lt` and one named `ld` ("Unexpected token 'ld' found"), both instruction-list operators. The LSP's reserved-name
      handling covers `r`/`s` (set-reset-name) and the keyword table; the IL operator set (LD, LDN, ST, STN, GT, GE, EQ,
      NE, LE, LT, JMP, JMPC, CAL, RET, …) is unrecorded. Record which are reserved, then one check.

## B. `src/types` is the only home of type knowledge

- [x] B1 Exported `elementaryRef(name)` / `elemOf(t)`; replace `infer.elem`, `resolve.resolveElementary`,
      `lower.named/boolType/elem`, and redundant re-lookups (`conversion.ts:23/31`, `_shared.ts:90`).
- [x] B2 (DONE 2026-09-14 as `inTypeGroup(group, t)` over `ANY_FAMILIES` plus the existing name predicates — no
      `string | Type` overloads were needed) Predicates over `string | Type` with an explicit BIT policy: `isIntegerType`, `isNumericType`, `isRealType`,
      `isStringType`, `isBoolType`, `isTemporal`, `inTypeGroup`; switch every hard-coded family/name list (lower,
      `binary-operators`, `intrinsic-operands`, `indexing`, `bit-number` (BIT kept as a named exception), `pointer-conversion`
      (derive, key by name not `renderType`)).
- [x] B3 Facts on the table: temporal tick unit, mantissa bits, `DEFAULT_STRING_LENGTH`, duration-for-date; switch
      `lower` `UNIT_NS`/`/^L/`/`withStringCapacity`, `infer.durationFor`, `compat.MANTISSA_BITS`.
      DONE 2026-09-14: `tickNs` and `mantissaBits` on the table, `DEFAULT_STRING_LENGTH`; `durationFor` reads the date's
      width. The `/^L/` prefix tests went with B5 — lowering takes a date/time literal's type from `types/literalType`.
- [x] B4 `types/arith.ts`: `commonType` (from `wider`, after A12), `promoteForRuntime` (from `promoted`), exported
      `checkedNegationType`, `exptResultType`, `temporalResultType` (incl. duration × integer), `arithmeticOperandError`
      (from `binary-operators`). Keep run-time vs checked types clearly named. Fix `docs/architecture.md:62`.
      DONE 2026-09-14: lower and infer share `exptResultType` and `temporalResultType` (lowering's calendar arithmetic
      keeps only the unit scaling). Left where they are: duration × integer (a run-time conversion rule lowering alone
      has — the checker types no mixed operands), and `binaryOpError`, already the one home shared by the ST and
      network checks and bound to `messages`, which `types/` must not import.
- [x] B5 Literal typing: export `literalType` (after A2), `REAL_LITERAL_TYPE`, `ANY_INT_RANGE`; lower keeps only context
      adoption; switch `enum-init.ts:28`, `constant-overflow.ts:18`. DONE 2026-09-14: lowering's `durationOf`/`calendarOf`
      take the literal's type from `types/literalType` and scale by its `tickNs`; its own typing is `contextLiteralType`.
- [x] B6 `isSameType` and a shared `checkableType` (or inference types an enum-value reference); switch
      `call-arguments.ts:185/227`, `assignment.ts:51`, `comparison.ts:60`, `_shared.ts:86`. DONE 2026-09-14: inference
      types an enum value as its enum (base type included); `checkableType` is one line over it; `compat.isSameType`.
      Two hidden bugs the copies held, both recorded (5 fixtures): the call-argument copy never learned the enum's base
      type, so `F(E.Busy)` into a SINT input was silent (CODESYS: an error; into UINT a change of sign); and comparison
      matched enum names case-sensitively. CODESYS compares two enum VALUES of different types silently — only
      variables warn C0354, names upper-cased — so the check now tells a value from a variable (`isEnumValueRef`).
- [x] B7 Rendering: `typeToTypeExpr` (for A11), `memberScopeOf` (completion.ts:87 = infer scopeOf); compiler-exact type
      text (`comparison.ts:65`, `subrange.ts:35`, `assignment.ts:78`) into `analysis/messages`. DONE 2026-09-14:
      `types/resolve.typeToTypeExpr` (was network `synthTypeExpr`), `infer.memberScopeOf`, and `compilerTypeName`,
      `compilerArrayText`, `compilerSubrangeText`, `compilerStringLiteralText` in `analysis/messages`.
- [x] B8 `defaultValueOf(type)` into `transpile/ir` (interp `defaultOf` = emit `defaultLiteral`). DONE 2026-09-14: lowering
      stamps every slot's `init` (the type's zero when none is written), so neither backend picks a default. The emitter's
      copy printed `IecStr::new()` for every string, a STRING for a WSTRING field; test `emit.test.ts`.

## C. Structure

- [x] C1 `Document` from `services/shared/resolve-at.ts:32` to `syntax/`. DONE 2026-09-14: `syntax/ast.ts`; 33 importers,
      the network layer and the server among them, no longer reach into services for it.
- [x] C2 One body iterator: `bodiesAt(offset)`, all-bodies-incl-unparsed, `graphicalBodies()`; replace 7 ST and 6 graphical
      copies; delete `stBodies`; `forEachExpr`/`forEachDecl` to `symbols/bodies.ts`. DONE 2026-09-14: `bodiesAt` (A5),
      `stBodies` gone (C8), `syntax/graphicalBodies` replaces the five graphical walks, and `forEachExpr`/`forEachDecl`
      live in `symbols/bodies.ts` (30 checks re-pointed). Left as they are: selection, folding, formatting and
      parse-errors walk `unitBodies` at the syntax level on purpose — they have no project scope, and parse-errors wants
      the bodies that do NOT parse, which `bodies()` skips.
- [ ] C3 Network-shared rules out of `checks/`: `analysis/resolution.ts` (`_identifier-resolution`), `analysis/rules/`
      (assignment/narrowing/binary pair rules); stop re-exporting check files; `inheritance.ts:16` cross-group import.
- [ ] C4 Syntax-owned helpers: `syntax/print.ts` (`exprText`, `renderTypeExpr`, statement printing from formatting),
      `spanContains`, `tokenAtOffset`, `nameKey`/`sameName`/`isSelfRef`, tokens kept on `ParseResult`; a network statement
      walker in `network/text/ast.ts` replacing 7 recursions; `collectBareRefs` onto `ast-walk`.
- [ ] C5 `libraryOf(uri)` in symbols; `lower.ts` Standard gate uses it; drop the `_shared.ts:95` shim.
- [ ] C6 Declarative vendor gating in the check list (8 early returns, `activeVendor`), rule gates in a `config.ts` table.
- [ ] C7 `test/support/project.ts`: `diagnose`, `codesOf`, `docSetup`, `libraryFile`; migrate the 76 check tests + 5
      service tests.
- [ ] C8 Dead code: `isNumeric`, `isEnumIsolated`, `networkScopeAt`, `CHECK_TIMING`, `activeVendor`, `stBodies`,
      `resolveAnywhere` export, test-only exports; decide `detectVendor`/`installCorpus`; `reference/error-codes.ts` to test.
      PARTLY DONE 2026-09-14: the named symbols are gone; `CHECK_TIMING` was a gap, not dead — collected, never printed
      — and now prints under PROFILE_CHECKS=1. The dead `isEnumIsolated` disagreed with `compat` (enum into REAL), so it
      was recorded (`cc_enum_into_*`, 12 targets) — both were wrong: an enum without a base type converts as INT (error
      into SINT/USINT/BYTE, change of sign into UINT/UDINT/WORD/DWORD, silent otherwise), the name upper-cased in the
      message; an enum-typed VARIABLE converts the same (`cc_enum_var_into_*`, 4 targets). Scoped to PROJECT enums
      without a written base type: the corpus gate caught bakon-nano and pro2193 storing a LIBRARY enum into a WORD with
      no warning, for a reason not recorded (library enum, or those projects' warning settings).
      `types/compat` + `EnumType.base`; the narrowing warning now types an enum value (it was UNKNOWN there).
      Open: test-only exports, `detectVendor`/`installCorpus`, `reference/error-codes.ts`.
- [ ] C9 Split monoliths: `lower.ts` (frame · expr · calls table · literals), `server.ts` `runServer`,
      `network-analysis.ts` → `network/checks/`; `interp` values module.
- [ ] C10 Placement: `network/text` to a syntax-tier folder, `reference/error-code-map.ts` next to `analysis/config`,
      `reachability.ts` incremental half to `server/`, top-level app files to `src/workspace/`.

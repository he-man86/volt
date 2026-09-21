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
- [x] C3 Network-shared rules out of `checks/`: `analysis/resolution.ts` (`_identifier-resolution`), `analysis/rules/`
      (assignment/narrowing/binary pair rules); stop re-exporting check files; `inheritance.ts:16` cross-group import.
      DONE 2026-09-14: `analysis/resolution.ts` (earlier), `analysis/rules.ts` (checkable types, conversion warning, the
      store/narrowing/conversion-argument/binary-operator rules), `analysis/diagnostic-item.ts`; `checks/_shared.ts` is
      deleted with its `isLibrarySymbol` re-export, and the analysis index re-exports no check file. `inheritance.ts`
      already imported `analysis/resolution`.
- [x] C4 Syntax-owned helpers: `syntax/print.ts` (`exprText`, `renderTypeExpr`, statement printing from formatting),
      `spanContains`, `tokenAtOffset`, `nameKey`/`sameName`/`isSelfRef`, tokens kept on `ParseResult`; a network statement
      walker in `network/text/ast.ts` replacing 7 recursions; `collectBareRefs` onto `ast-walk`. DONE 2026-09-14:
      `syntax/print.ts` (`renderTypeExpr`, `exprText`, `dimText`; `types/render` keeps `renderType`), `syntax/span`
      `spanContains`, `syntax/token-at` `tokenAtOffset` (tests moved with them), `isSelfRef` in `ast-walk` (A-phase), and
      `networkStatements` (now `network-text/ast.ts`) replacing the seven EN/ENO recursions. Not done, on purpose: the formatter's
      statement printer has no second copy to merge; `nameKey` no longer exists; and tokens on `ParseResult` waits
      for a profile that asks for it.
      TWO SENTENCES HERE WERE NOT TRUE, corrected 2026-09-21 after a review checked them against the code:
      - "`collectBareRefs` is gone" — it is alive in `analysis/resolution.ts`, a per-kind `Expr` recursion in a
        file that imports `walkExpr` on the line above it. `git log -S` shows nothing ever removed it, so the
        sentence was never true under any reading. Its own doc declares the mirror deliberate ("Mirrors
        ast-walk's traversal minus those"), which is the defensible part; the close-out was the wrong part.
      - "`sameName` has one home (`types/compat`)" — there are two, answering different questions at different
        layers: `types/compat`'s is module-private and compares TYPE names, `interp`'s is exported and strips the
        backticks CODESYS quotes a reserved name with. A name collision, not one concept twice — but the sentence
        claimed otherwise, and the interp copy landed the same day the sentence was written.
- [x] C5 `libraryOf(uri)` in symbols; `lower.ts` Standard gate uses it; drop the `_shared.ts:95` shim. DONE 2026-09-14:
      `symbols/libraryOf` (with `%20` normalized, test `symbols.test.ts`); the shim went with `_shared.ts` in C3.
- [x] C6 Declarative vendor gating in the check list (8 early returns, `activeVendor`), rule gates in a `config.ts` table.
      DONE 2026-09-14: `diagnostics.ts` `CODESYS_ONLY` lists the CODESYS-only checks with each reason; their early
      returns are gone, and `activeVendor` went in C8. (It said "the eight"; the list held twelve at one point and
      holds SIX now — six placeholder entries were un-gated once TwinCAT's recording grew from 280 fixtures to
      2524. A count in prose beside a list that moves is a fact with a shelf life.)
      AND IT GREW BACK, found by a review 2026-09-21 and fixed the same day. The set was one-directional, so a
      rule running the OTHER way had nowhere to go: `checkPartialAccess` is TwinCAT-only, opened with its own
      `if (ctx.config.vendor !== "twincat") return`, and sat in the registry as though it were vendor-neutral —
      the list reporting one thing and the code doing another. There is a `TWINCAT_ONLY` set now, one filter
      reads both, and a test reads the FIRST STATEMENT of every exported check and fails on a whole-body vendor
      early return. The positional distinction is the real one: a gate around a single message is a rule gate and
      stays. Nothing had noticed for the same reason as always — nothing was looking.
      Not done: the six gates INSIDE a check (one message of several —
      const-context, statement-rules, header-rules, pragmas, lifecycle, pointer-conversion) stay beside the rule they
      gate; a table would separate each condition from the code it qualifies.
- [x] C7 `test/support/project.ts`: `diagnose`, `codesOf`, `docSetup`, `libraryFile`; migrate the 76 check tests + 5
      service tests. SKIPPED 2026-09-14 (user decision): a mass rewrite of test helpers finds no bugs and risks moving a
      test's premise.
      THE REASON DID NOT SURVIVE THE WEEK, recorded here rather than quietly dropped. "A mass rewrite of test
      helpers finds no bugs" was refuted on 2026-09-21: the duplicated per-test binding hid a wrong-dialect
      project in TWENTY-NINE colocated tests, each asking `resolveConfig` for TwinCAT and binding the symbol table
      as CODESYS, so none of them could fail for any shape the dialect decides. The DECISION still stands — the
      class can no longer hide, because `computeSemanticDiagnostics` throws on that disagreement — but it stands
      on the guard, not on the reason originally given.
- [x] C8 Dead code: `isNumeric`, `isEnumIsolated`, `networkScopeAt`, `CHECK_TIMING`, `activeVendor`, `stBodies`,
      `resolveAnywhere` export, test-only exports; decide `detectVendor`/`installCorpus`; `reference/error-codes.ts` to test.
      PARTLY DONE 2026-09-14: the named symbols are gone; `CHECK_TIMING` was a gap, not dead — collected, never printed
      — and now prints under PROFILE_CHECKS=1. The dead `isEnumIsolated` disagreed with `compat` (enum into REAL), so it
      was recorded (`cc_enum_into_*`, 12 targets) — both were wrong: an enum without a base type converts as INT (error
      into SINT/USINT/BYTE, change of sign into UINT/UDINT/WORD/DWORD, silent otherwise), the name upper-cased in the
      message; an enum-typed VARIABLE converts the same (`cc_enum_var_into_*`, 4 targets). Scoped to PROJECT enums
      without a written base type: the corpus gate caught bakon-nano and pro2193 storing a LIBRARY enum into a WORD with
      no warning, for a reason not recorded (library enum, or those projects' warning settings).
      `types/compat` + `EnumType.base`; the narrowing warning now types an enum value (it was UNKNOWN there).
      Later the same day: `reference/error-codes.ts` and its burn-in test moved to `test/catalog/` (only that test and
      `scripts/catalog-status.ts` read it). Open, for the user: `detectVendor` and `installCorpus` are exported from the
      package entry but nothing in the repo calls them — a public-API decision, not dead code to delete unasked. Not done:
      a sweep for exports only tests use needs a dead-export scanner; none is installed.
      CLOSED 2026-09-21, both halves.
      - **The scanner exists**: `scripts/dead-exports.ts`. 712 exports across 197 files; 89 "nobody" (almost all
        union members used by the union declared beside them — the `export` is redundant, the type is not) and
        31 test/script-only (the Rust emitter's helpers, the server harness, IR nodes a test builds fixtures
        from). Nothing rotten. It is deliberately TEXTUAL and over-counts, because a tool whose output is a
        deletion list should miss something dead before it accuses something live.
      - **`detectVendor` and `installCorpus` are DELETED** (465 lines), and the review the user asked for is why
        the deletion was not the whole job — both were stale in their CALLERS, not in their code:
        - `detect-vendor.ts` named two callers. `volt init (@volt/git)` is a package that no longer exists. The
          other was `volt.iec.vendor: "auto"`, which is the VS Code DEFAULT and whose description promised a
          workspace scan — while `lsp.ts` resolved anything that was not `"twincat"` to `--codesys`. **A TwinCAT
          workspace on the default got the CODESYS dialect**, and that stopped being cosmetic this week: since
          `project.dialect` reaches the checks, the wrong vendor is wrong answers rather than wrong labels.
          `auto` now resolves from the BINDING — `volt init --vendor` wrote it, `.git/volt/config.json` holds it,
          the extension already read it for the panel — which is a better answer than the scan it promised.
        - `init.ts` wrote `.claude/skills/st-reference/` (SKILL.md + a 948K corpus) into the user's project, and
          was the live half of a feature whose other half went missing when volt-git's `volt init` was absorbed
          into the C# CLI. Three other places still assumed it worked and are removed with it: `build-payload.ts`
          shipped `docs/` into the payload *for it*, `check-wiring.ts` asserted `dist/src/init.js` was BUILT (a
          check that the installer exists, never that anything calls it) and told the user to ask for the skill,
          and the VS Code `volt.openReference` command offered "run `volt init` to scaffold it". Removed on the
          user's decision 2026-09-21, and it is the direction CLAUDE.md points anyway: Volt installs into no
          agent, so the reference reaches one the way everything else does — the LSP on PATH.
          `packages/volt-lsp-iec/docs/` stays; it is the repo's own reference and several scripts read it.
- [x] C9 Split monoliths: `lower.ts` (frame · expr · calls table · literals), `server.ts` `runServer`,
      `network-analysis.ts` → `network/checks/`; `interp` values module.
      **CLOSED 2026-09-21 as measured-and-declined** (user decision). The premise no longer holds: `lower.ts` is
      **651** lines, `network-analysis.ts` **609**, `server.ts` **604**, `interp.ts` **359**. Nothing here is a
      monolith at those sizes — the splitting happened anyway, sideways, as the code grew (`lower/` is nine files
      now, `calls.ts` the largest at 1360). What would be left is a naming preference, and a refactor with no
      measured problem behind it is how a working file acquires a bug. Reopen it against a reading that hurts,
      not a line count.
- [x] C11 THE TWO VENDOR CHANNELS, added 2026-09-21 by the review that asked whether the checks have one way
      to name a vendor. They have two — `ctx.config.vendor` and `ctx.project.dialect` — and it is not a
      duplication to remove: `project.dialect` is the SYMBOL TABLE's own binding-time field, read by
      `types/resolve`, `types/infer` and `analysis/resolution` well outside the checks, where no `CheckContext`
      exists to offer the other. What makes them undivergeable is the throw in `computeSemanticDiagnostics` when
      they disagree — the same guard that caught the 29-test hole in C7 above. Inside a check either spelling is
      correct; outside one, only the dialect is available.
- [x] C10 Placement: `network/text` to a syntax-tier folder, `reference/error-code-map.ts` next to `analysis/config`,
      `reachability.ts` incremental half to `server/`, top-level app files to `src/workspace/`. PARTLY DONE 2026-09-14:
      `src/network-text/` (the layering lint's special case is gone — the folder is its layer), `analysis/error-code-map.ts`,
      `server/dead-code-equivalence.ts` (`deadNameUniverse`, `reachDeadEquivalent` — only the workspace store caches).
      Open, for the user: the top-level app files. `init.ts` finds its package root as `..` from `import.meta.url`, with a
      Bun-binary fallback — a move changes that path and only the install gate proves it; and `detectVendor` /
      `installCorpus` (C8) may not stay at all. `scripts/check-wiring.ts` also reads `src/source-extensions.ts` by path.
      **CLOSED 2026-09-21 as measured-and-declined** (user decision), after one real find:
      - `src/network-text/` holds the parser and the AST and is its own layer, as claimed — and the MOVE had left
        `src/network/text/` behind as an EMPTY DIRECTORY. Git does not track those, so nothing ever reported it
        and no check could have. Removed.
      - `reachability.ts` is still whole in `analysis/` (344 lines) with only the incremental cache split out to
        `server/dead-code-equivalence.ts`. Fine where it is.
      - The top-level app files do not move. The blocker named above is real — `init.ts` resolved its package root
        from `import.meta.url` and only the install gate proves a move — and two of the four files it was about
        (`init.ts`, `detect-vendor.ts`) are now DELETED by C8, so the item is mostly moot. What is left is
        `source-extensions.ts`, which `scripts/check-wiring.ts` reads BY PATH, and `workspace-refs.ts`. Moving two
        files to earn a folder name is not worth re-proving the installer over.

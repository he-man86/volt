## 0. Census and design

- [x] 0.1 Every diagnostic code: frequency on the six corpora and the fixtures, the user's fixing edit, class (mechanical /
      choice / no fix). Navigation breadth (workspace symbols, call hierarchy, rename across libraries) measured on the
      corpora: what is answered, what is missing.
      **Measured 2026-10-12** with `scripts/fix-census.ts` (2 min 41 s) and `scripts/nav-breadth.ts` (57 s), both
      offline, kept for 2.4 / 3.1 to re-run.

      **The weighting problem, and the default taken.** The six corpora compile clean, so the LSP shows them only
      243 findings: 216 are one Volt-format error (below), the other 27 are warnings — C0197 16, C0373 6, C0139 4,
      C0228 1 — all confirmed by the recorded builds. An ERROR a user fixes while editing never survives into a
      committed project, so the corpora cannot rank errors at all; every error code has 0 corpus occurrences. The
      census therefore ranks warnings by corpus occurrences and errors by FIXTURE occurrences (each fixture is a shape
      the compiler was asked about once: CS 5839 findings, 5720 confirmed; TC 7290, 6907 confirmed; 170 codes). The
      owner's niche rule ("≈0 corpus occurrences and not trivial") would read every error code as niche under this
      measurement, so for this change it is applied on the fixtures instead: a fix that is NOT a one-token edit and
      whose code fires on ≤ 3 fixtures per vendor is "niche: accepted loss". Overturn by saying so; design.md names
      the one code it removes. (Restated after review: "not a one-token edit" read as "not a LOCAL edit" — design.md
      §1.)
      **OWNER DECISION 2026-10-12 — overrides the niche default above:** "please fix whatever is possible, even niche
      situations if possible — this was just so you don't have to jump all loops for very niche ones" / "but if fixable
      then please do". So: EVERY mechanical and choice code gets its fix, however few fixtures it fires on — the code
      design.md §1 removed included. "Niche: accepted loss" is allowed ONLY for a fix that needs disproportionate machinery
      (a new analysis or model, not just a text edit); each such exclusion is listed by name with the reason in the close
      report. A small fixture count is never a reason on its own.

      **Classes (codes · corpus · fixtures CS · TC):** mechanical 29 · 17 · 591 · 530; choice 21 · 4 · 4336 · 5521
      (of which C0002 is 2958 · 3906 and only its "expected X" subset is fixable: 97 · 91, measured by
      `fix-census.ts`'s C0002 family table); no fix 113 · 6 · 894
      · 1223; out of scope 7 (network text, and the Volt-format finding) · 216 · 18 · 16. **Fix coverage today:** the
      one wrap fix answers 8 of 243 corpus findings (8 of the 16 C0197 — the other 8 are not `x := y` sites) and
      721 / 697 fixture findings (C0032 691 / 668, C0197 30 / 29). None of it is compiler-proven: there is no recorded
      AFTER for the wrap, so under this change's rule it must get its AFTERs in 1.1 or be withdrawn.

      Mechanical and choice codes, census order (corpus, then fixtures):

      | code | slug | sev | corpus | fixtures CS / TC | fixable today (corpus · CS · TC) | class | the user's fixing edit |
      |---|---|---|---|---|---|---|---|
      | C0197 | narrowing-conversion | warning | 16 | 66 / 59 | 8 · 30 · 29 | mechanical | wrap the source in TO_<target>(…) (today: `x := y` only) |
      | C0139 | no-op-statement | warning | 4 | 180 / 192 | 0 · 0 · 0 | choice | remove the statement — not on a property read (`t.P;` calls the getter) or anything that calls, and no fix at all on a recovery leftover (`NS;`, `RUE;`, `NETWORK;`) / call it (`x();`) when it names an FB instance |
      | C0228 | constant-no-initial-value | warning | 1 | 1 / 1 | 0 · 0 · 0 | mechanical | add `:= <the value the compiler gives it>` — its BASE type's zero, a named subrange's lower bound (measured in 1.1's review) |
      | C0002 | syntax-error | error | 0 | 2958 / 3906 | 0 · 0 · 0 | choice | subset only: `';' expected instead of end of POU` (65/59) / `';'` before `END_*` (10/10) -> insert `;`; `'END_*' expected` (10/10) / end of file (6/6) -> insert the END_*; `'THEN' expected` (6/6) -> insert THEN — 97 / 91 in all; the rest is recovery cascade, no fix |
      | C0032 | assignment-type-mismatch | error | 0 | 812 / 787 | 0 · 691 · 668 | choice | wrap in TO_<target>(…) where the pair converts; `REF=` for a REFERENCE target; `E.member` for a strict-ENUM value |
      | C0195 | sign-change-conversion | warning | 0 | 373 / 316 | 0 · 0 · 0 | mechanical | wrap in TO_<target>(…) |
      | C0046 | unresolved-identifier | error | 0 | 97 / 288 | 0 · 0 · 0 | choice | declare it (VAR, the type inferred from its use) / each near-miss visible name |
      | C0077 | unknown-type | error | 0 | 21 / 180 | 0 · 0 · 0 | choice | each near-miss type name |
      | C0198 | string-constant-too-long | warning | 0 | 86 / 42 | 0 · 0 · 0 | choice | widen the destination to STRING(<literal length>) / shorten the literal |
      | call-argument-type |  | error | 0 | 45 / 39 | 0 · 0 · 0 | mechanical | wrap the argument in TO_<parameter type>(…) |
      | C0351 | unknown-attribute | warning | 0 | 46 / 0 | 0 · 0 · 0 | choice | each near-miss known attribute / remove the attribute |
      | C0118 | jump-label-unreferenced | warning | 0 | 10 / 34 | 0 · 0 · 0 | mechanical | remove the label |
      | C0004 | unknown-member | error | 0 | 20 / 20 | 0 · 0 · 0 | choice | each near-miss member of the type |
      | C0136 | ambiguous-global | error/warning | 0 | 19 / 18 | 0 · 0 · 0 | choice | qualify with each GVL that declares it (`GVL_A.g`) |
      | C0094 | override-mismatch-base | error | 0 | 14 / 14 | 0 · 0 · 0 | choice | make the override's declaration the base's (not preferred: changing the base is as valid) |
      | C0089 | override-mismatch-interface | error | 0 | 18 / 9 | 0 · 0 · 0 | choice | make the method's declaration the interface's (not preferred: changing the interface is as valid) |
      | C0013 | empty-block | error/warning | 0 | 12 / 12 | 0 · 0 · 0 | mechanical | insert the empty statement `;` |
      | C0142 | duplicate-declaration | error | 0 | 12 / 12 | 0 · 0 · 0 | choice | remove the first / remove the second declaration (preferred only when type and initial value agree) |
      | C0090 | base-class-not-found | error | 0 | 11 / 11 | 0 · 0 · 0 | choice | each near-miss FB name |
      | C0203 | bit-wrong-container | error | 0 | 11 / 10 | 0 · 0 · 0 | mechanical | BIT -> BOOL |
      | unknown-struct-field |  | error | 0 | 10 / 10 | 0 · 0 · 0 | choice | each near-miss field |
      | signature-name-mismatch |  | error | 0 | 8 / 8 | 0 · 0 · 0 | mechanical | rename the declaration to the object's name |
      | C0037 | unknown-named-argument | error | 0 | 8 / 8 | 0 · 0 · 0 | choice | each near-miss input |
      | C0117 | jump-label-undefined | error | 0 | 7 / 7 | 0 · 0 · 0 | choice | each near-miss label |
      | C0051 | attribute-value-string | error | 0 | 6 / 6 | 0 · 0 · 0 | mechanical | quote the attribute value |
      | C0119 | fb-lifecycle-signature | error | 0 | 6 / 6 | 0 · 0 · 0 | mechanical | add the inputs `bInitRetains : BOOL; bInCopyCode : BOOL;` |
      | access-only-on-methods |  | error | 0 | 7 / 5 | 0 · 0 · 0 | mechanical | remove the access modifier |
      | C0086 | interface-not-found | error | 0 | 4 / 4 | 0 · 0 · 0 | choice | each near-miss interface name |
      | abstract-keyword-missing |  | warning | 0 | 8 / 0 | 0 · 0 · 0 | mechanical | add ABSTRACT |
      | C0175 | retain-not-allowed | error | 0 | 4 / 4 | 0 · 0 · 0 | mechanical | remove RETAIN/PERSISTENT |
      | C0087 | missing-interface-implementation | error | 0 | 4 / 4 | 0 · 0 · 0 | mechanical | add the missing METHOD/PROPERTY stub with the interface's signature |
      | C0204 | bit-wrong-block | error | 0 | 4 / 4 | 0 · 0 · 0 | mechanical | BIT -> BOOL |
      | C0038 | unknown-named-output | error | 0 | 4 / 4 | 0 · 0 · 0 | choice | each near-miss output |
      | C0237 | external-no-global | error | 0 | 3 / 3 | 0 · 0 · 0 | choice | each near-miss global |
      | C0097 | duplicate-inherited-variable | error | 0 | 3 / 3 | 0 · 0 · 0 | choice | remove the redeclaration in the derived FB, titled with the base's type and initial value it then gets (preferred only when they agree) |
      | C0130 | method-referenced-without-parens | error | 0 | 3 / 3 | 0 · 0 · 0 | mechanical | add `()` |
      | conversion-source-mismatch |  | error | 0 | 3 / 3 | 0 · 0 · 0 | mechanical | replace `X_TO_Y(e)` by `TO_Y(e)` |
      | unterminated-conditional-pragma |  | error | 0 | 3 / 3 | 0 · 0 · 0 | mechanical | insert `{END_IF}` |
      | abstract-and-final |  | error | 0 | 3 / 3 | 0 · 0 · 0 | choice | remove ABSTRACT / remove FINAL |
      | indexof-removed |  | error | 0 | 2 / 2 | 0 · 0 · 0 | mechanical | INDEXOF -> ADR |
      | dynamic-creation-pragma |  | error | 0 | 2 / 2 | 0 · 0 · 0 | mechanical | add `{attribute 'enable_dynamic_creation'}` to the FB (its file) |
      | C0182 | return-type-not-allowed | error | 0 | 2 / 2 | 0 · 0 · 0 | mechanical | remove the return type |
      | border-order |  | error | 0 | 2 / 2 | 0 · 0 · 0 | mechanical | swap the bounds |
      | C0238 | external-initializer | error | 0 | 1 / 1 | 0 · 0 · 0 | mechanical | remove the initializer |
      | C0533 | abstract-output-default | warning | 0 | 2 / 0 | 0 · 0 · 0 | mechanical | remove the default value |
      | C0550 | pack-mode-not-allowed | error | 0 | 2 / 0 | 0 · 0 · 0 | mechanical | remove the attribute |
      | C0421 | interface-implements | warning | 0 | 1 / 1 | 0 · 0 · 0 | mechanical | IMPLEMENTS -> EXTENDS |
      | function-without-parens |  | error | 0 | 1 / 1 | 0 · 0 · 0 | mechanical | add `()` |
      | case-range-inverted |  | error | 0 | 1 / 1 | 0 · 0 · 0 | mechanical | swap the bounds |
      | C0206 | bit-array-base | error | 0 | 1 / 1 | 0 · 0 · 0 | mechanical | BIT -> BOOL |

      No fix (judgement, or the fix is the root finding's — `unknown-source` and `refused-initializer` are the
      follow-on of an unresolved name), fixtures CS/TC: C0373 6/6, unknown-source 151/330, C0035 31/191, C0049 53/53, C0208 48/43, refused-initializer 15/74, C0371 33/23, C0124 23/23, C0001 22/22, C0040 19/25, external-non-input-write 21/21, C0066 21/21, unary-operand-type 20/20, C0125 20/20, C0357 14/14, C0041 14/14, conditional-call 14/14, C0018 11/11, reference-to-bit 13/8, C0230 10/10, C0068 9/9, test-and-set-operand 9/9, typed-literal 18/0, C0039 8/8, subrange-out-of-range 8/8, C0122 7/7, C0030 7/7, interface-member-variable 8/6, C0201 6/6, C0076 6/6, C0441 6/6, C0199 6/6, C0044 6/6, C0081 6/6, property-without-accessor 6/6, reference-base-type 6/6, C0045 6/5, C0132 5/5, C0091 5/5, C0149 5/5, C0080 5/5, abstract-instantiation 5/5, variable-length-placement 4/6, C0144 5/5, C0020 5/5, C0048 4/4, C0143 4/4, C0185 4/4, non-callable-call 4/4, fb-init-argument-missing 4/4, C0169 4/4, C0266 4/4, C0075 4/4, C0216 4/4, C0218 4/3, C0140 3/3, C0179 3/3, C0178 3/3, C0141 3/3, C0064 3/3, in-out-string-too-short 3/3, C0072 3/3, C0116 3/3, C0074 3/3, generic-instantiation 6/0, C0219 3/3, enum-conversion 3/3, variable-length-nested 3/3, self-not-structured 3/3, C0114 3/3, C0543 5/0, C0232 4/1, in-out-constant-needs-variable 3/2, C0047 2/2, C0224 2/2, C0096 2/2, C0168 2/2, C0101 2/2, message-pragma-error 2/2, C0145 2/2, C0069 2/2, C0354 2/2, C0240 2/2, C0003 2/2, C0234 2/2, C0217 2/2, case-label-type 2/2, C0022 2/2, for-control-type 2/2, constant-cycle 4/0, C0511 3/0, C0525 3/0, C0233 2/1, C0526 3/0, C0355 2/1, C0126 1/1, C0061 1/1, C0222 1/1, C0177 1/1, C0566 2/0, C0162 1/1, C0070 1/1, C0242 1/1, reference-init-target 1/1, C0161 1/1, string-length-non-const 1/1, vector-base-type 2/0, C0227 1/1, C0205 1/1, bounds-fixed-array 0/2, C0509 1/0, C0454 1/0, C0542 1/0.

      Out of scope: (none) 216c 0/0, NETWORK_UNRESOLVED_BOX 0c 8/8, network-undeclared-identifier 0c 3/3, network-unknown-source 0c 3/3, network-missing-en 0c 2/0, network-unknown-member 0c 1/1, network-unknown-pin 0c 1/1 (c = corpus). The network-text codes wait for `ld-fbd-coverage`.

      **Navigation breadth (corpora, project source only):**
      - *Workspace symbols* answer only project-level symbols: every POU, DUT, GVL variable, GVL, interface and device
        (e.g. pro2193 FB 187/187, interface 97/97, gvl_var 246/246) — and NO member: method 0/1274+19+3, property
        0/272+5, action 0/7+20+19, interface_method 0/182, interface_property 0/96, enum_value 0/4558 (pro2193) and
        0/25..226 elsewhere (locals, parameters and struct fields 0/… too, which is right). Every empty-query answer
        also carries 10 328–11 716 library symbols on the CODESYS projects, with no container name to tell them apart.
      - *Call hierarchy:* incoming agrees with an independent count on the 25 most-called targets of every project
        (2035/2035 pro2193, 269/269 bakon-nano, 54/54 lenze-mid and awa-palletizer), outgoing on every prepared body
        (4263/4263 pro2193). What it does NOT see: calls of an FB INSTANCE (`inst()` resolves to the variable, not a
        callable — 693 `var` + 62 `gvl_var` call sites over the corpora, plus array-element instances
        `SetError[1]()` ≈ 70 unresolved in pro2193), calls of a PROGRAM (67 sites; a PROGRAM is not "callable", so
        98 program bodies prepare nothing), the bodies of PROPERTY accessors (340 bodies that prepare nothing,
        pro2193 330, lenze-mid 10), and `SUPER^()` (127 unresolved sites, pro2193). The other unresolved callees are
        operators and standard functions with no symbol (`MAX`, `ADR`, `SEL`, `TO_*`, `__POUNAME`…).
      - *Rename* refuses a library symbol (`isLibrarySymbol`), but follows no OVERRIDE CHAIN: pro2193 has 885 project
        methods/properties that override or implement a project member (lenze-mid 1), and renaming the base edited
        the override in 0 of the 40 tried — every such rename leaves C0094/C0087 behind. 6 project members (pro2193)
        override or implement a LIBRARY member, and renaming them is accepted although no edit can make the project
        whole again.

      **Other findings:**
      - twincat-project14 materializes its libraries under `References/` (TwinCAT's name for the library manager,
        `TcObjectModel.cs`); `isLibraryUri` knows only `Library Manager`, so on TwinCAT library signatures are project
        source: 216 "states no language" errors on `References/Tc2_Standard/*.pou`, their symbols renameable and in
        workspace symbols as the project's. `corpus-diagnostics.test.ts` gated only the CODESYS projects, which is why
        nothing went red. Filed for 2.4 (it is a rename-across-libraries gap) — fix there if a vendor-aware rule is
        cheap, else file it on its own. The GATE is in place from step 0 (review below).
      - VAR sections (source action "organize"): of 1271 project units with a VAR section, 42 have two ADJACENT
        sections of the same kind and qualifiers (56 any two), 90 are not in input/output/in_out/var order — and that
        order is not free to change (a positional call follows declaration order).
      **Review 2026-10-12, fixed in step 0** (no finding skipped):
      - *C0139's remove option on the wrong statements* — design.md F2 and §3: no remove on a property read or anything
        that calls (`t.P;` builds clean without it and behaves differently), no fix at all on a parse-recovery leftover
        (`ExprStatement.resumed`/`unterminated`: `NS;`, `RUE;`, `NETWORK;`, `!!!'ERROR'!!!;`). §3 now says a clean
        build is necessary, not sufficient, and every excluded class gets a fixture whose test asserts the option is
        ABSENT.
      - *`preferred` on fixes with two meanings* — C0142, C0097 (now F10), C0094 and C0089 reclassified mechanical →
        choice (table above, class totals updated); `preferred` only where the alternatives mean the same (§3).
      - *TwinCAT `References/` with no gate* — `test/corpus/corpus-diagnostics.test.ts` now reads each project's
        own vendor (`corpusVendor`) and `expected-build.<vendor>.json`; twincat-project14 is gated for the first time
        and its 216 false positives run as a known divergence (`CORPUS_DIVERGENCES`): every one must be under
        `References/`, and the test fails, naming the mark, the day there are none. Fixed or filed in 2.4.
      - *Niche rule applied inconsistently* — design.md §1 restates it as the owner's "not trivial" read as "not a
        LOCAL edit" (in the reporting file, inside the reported construct, from the check's own facts); the
        multi-token fixes the list kept are local, `dynamic-creation-pragma` (another file) is not. F9 no longer says
        "one-token". Owner approval still pending.
      - *The C0002 subset was not measured* — `fix-census.ts` now prints a C0002 table by message family
        (`C0002_FIXABLE`, cascade shapes ≥ 20 findings listed): 97 of 2958 (CS), 91 of 3906 (TC). Every other census
        figure re-ran unchanged (170 codes; corpus 243; CS 5839 / 5720, TC 7290 / 6907; fixable 8 · 721 · 697).
      - *nav-breadth's override chain* — `renameBreadth` now reads the IMPLEMENTS of every FB in the ancestry (not
        only the FB's own) and files a member as a LIBRARY chain when ANY base in it is a library member (not the
        first found). Re-run: pro2193 6 library / 885 project, 0 of 40 followed; lenze-mid 0 / 1; the rest 0 —
        unchanged, so B6's sizing holds.
      Gate (2026-10-12): typecheck clean; full LSP suite `VOLT_REQUIRE_FULL=1` (no `VOLT_FIXTURES`) 9674 pass, 0 fail,
      34 skip, 421 todo, 10 129 tests across 356 files, 700 s; no fixture or transpiler change, so no map regeneration.
- [x] 0.2 design.md: the fix model (`DiagnosticItem.fixes`, produced by the reporting check; `code-actions.ts` renders), the
      fixes to build in census order, the proof rule (compiler-recorded), source actions worth building, the breadth gaps to
      fix vs file.
      Written 2026-10-12: fixes travel as `DiagnosticItem.fixes` → LSP `Diagnostic.data`, rendered without
      re-derivation; F1–F10 in census order (F1 the conversion wrap, moved onto the model and proven at every site
      kind); one niche removal (`dynamic-creation-pragma`); fix-all for F1 only; organize-VAR filed; breadth B1–B6
      fixed in 2.4, TwinCAT `References/` and workspace-answer ranking filed.

## 1. Red first

- [x] 1.1 Per planned fix: a fixture BEFORE (the diagnostic) and the expected AFTER text; the AFTER recorded with
      `record:language` on CODESYS (and TwinCAT where the code applies) — it must build clean; a test that the action
      produces exactly that text. Red until the fix exists.
      **Done 2026-10-12** — `test/conformance/fixtures/quick-fixes/` (one file per F-row, F9 in two), 143 new fixtures:
      68 BEFOREs and 75 AFTERs (F1 9, F2 3, F3 16, F4 6, F5 4, F6 2, F7 1, F8 9, F9 19, F10 6; design.md §7 "As built"
      says why 75, not 63), plus `fixAbsent` on three: `qf_c0046_absent_declare` (no type to infer), and the recorded
      `flw_noop_property_read` (property read) and `cc_time_nanosecond_literal` (recovery leftover). Recorded in ONE run
      per vendor (`RECORD_ONLY`, instance `lsp-quick-fixes`, TwinCAT `-Fixture 13`): CODESYS 143, TwinCAT 143; and
      `record:exec` 90 (every build-clean one, 0 failed). **All 75 AFTERs build with zero diagnostics on both vendors**;
      no option refused. The action test (`src/services/assist/code-actions.test.ts`, the old inline wrap test replaced)
      walks every `fixOf` per vendor the LSP reports the code on: 74 pairs red (`RED`, `test.failing`, each failing for
      "no action" or — `qf_c0197_wrap_assign`, `_return`, which the old wrap answers — "not `preferred`"), 1 green
      (`qf_c0032_wrap`), 3 `fixAbsent` green. Measured departures from 0.2 (design.md §7): C0197's pairs are LREAL→REAL
      (an integer narrowing is C0032 on both vendors); C0032's `E.member` option dropped (no shape has one member to
      offer); C0077 is CODESYS's here (the LSP judges a bare type on CODESYS only until 2.4's `References/` rule).
      **Conformance, rule by rule** (every new fixture × vendor against its recording, 286): every AFTER agrees
      exactly; 6 BEFOREs on 10 fixture-vendor pairs carry a follow-on message the LSP does not give, each the gap a
      sibling already pins, niche (0 corpus occurrences — an undeclared name or unknown type never builds):
      `KNOWN_DIVERGENCES` via `support/divergences-quick-fixes.ts`, the census GAPs as `CEILING_EXCEPTIONS_C`
      (`test/baseline/baseline-c.ts`). One root cause FIXED test-first: the AST fold gave a CONSTANT with no initial
      value no value where CODESYS runs it as its BASE type's zero (`qf_c0228_before`: cap 0, out 1;
      `fold-agreement.test.ts` found it) — `const/values.ts` `noInitialValue`, `fold.test.ts`; fold-dump: 2 more bodies fold
      per vendor. Two ratchets moved by reading: the source map's renamed targets 539 → 540 (`qf_c0032_ref`, the image
      class) and type-dump's call UNKNOWN +1 per vendor (`qf_indexof_before`'s INDEXOF, untyped on both vendors).
      Evidence: confirmed 3055 → 3141, refused 2038 → 2091, not-lowered 378 → 382 (ceiling 394: JMP/label and two
      no-op statements the transpiler refuses — `qf_c0117_change`, `qf_c0118_before`, `qf_c0139_before`,
      `_before_instance`), unasked 0.
      **Review of step 1 fixed (2026-10-12)** — design.md §7 "Review of step 1": 24 fixtures recorded on both vendors (and
      `record:exec`); the fold of a C0228 constant measured as its BASE type's zero (an alias's own `:=` and an inline
      subrange's bound are not it; a named subrange's is no constant), the border check and the transpiler's slot start
      fixed to match (`fold.test.ts`, `declared-type.test.ts`, `initial-values.test.ts`); `Add ()` absent on any callable
      with a parameter, "call it" absent on an FB with a VAR_IN_OUT, remove absent on `list[F()];` (now warned, both
      vendors); recovery leftovers `RUE;` and `b;` held; 6 new AFTERs red (C0228 ×2, C0087 ×2, C0119 ×2). The action test
      now holds which vendors report each BEFORE's code against the recordings (`VENDOR_GAPS`: `qf_c0077_before` TwinCAT,
      2.4). Evidence: confirmed 3150, refused 2101, not-lowered 385, lsp-gap 88 → 89 (`qf_c0228_bound_subrange`, niche).
      **Gate of step 1 (2026-10-12)** — the review's six findings, none skipped (design.md §7 "Gate of step 1"). 9 fixtures
      recorded in one run per vendor (CODESYS 8 + 1 re-asked for the boundary, TwinCAT 9, instance `lsp-quick-fixes`,
      TwinCAT `-Fixture 13`; `record:exec` 6, 0 failed), both vendors agreeing on each:
      - *T4 asserted an unrecorded answer* (high) — FIXED: `ARRAY[1..0]` builds clean written literally
        (`qf_c0228_bound_literal_empty`), from `cap : INT := 0` (`_init_zero`); `ARRAY[2..0]` is refused
        (`_literal_two_below`). border-order on an array dimension is now `lower > upper + 1`; `namesUninitializedConstant`
        deleted; T4 rewritten to the recordings. The transpiler refused `1..0` as `array-reversed` too — it now lowers an
        empty dimension (`checks.ts`, `totality.test.ts`: `ARRAY[3..2]` was asserted reversed, a premise the recording
        refutes; `4..2` keeps the refusal).
      - *A constant initialized FROM an uninitialized one* (medium) — FIXED by the same rule: `qf_c0228_bound_chained`
        builds clean and the LSP is now silent on it.
      - *The inline subrange's 0 at compile time; the init list* (medium) — FIXED: `qf_c0228_bound_inline_subrange` is
        refused "Array border cap does not evaluate…" exactly as the named one, so the fold gives ANY subrange's
        uninitialized constant no value (`values.ts` `isSubrange`; `fold.test.ts` `ci`/`cz` → none); niche lsp-gap
        (`deferred.lsp`, 0 corpus occurrences), fold-agreement `SUBRANGE_BARE_CONSTANT`, census `ROOT_GAPS`.
        `qf_c0228_bound_init_list` records "Too many initializers for array" on both vendors — what the LSP said.
      - *Subrange constant WITH an initializer* (medium) — the uninitialized-only rule HOLDS: `qf_c0228_bound_subrange_init`
        and `_inline_subrange_init` build clean, and the LSP is silent on both.
      - *`m[F()][1];` unwarned* (low) — FIXED: `qf_c0139_absent_call_nested` records both statements warned on both
        vendors; `callsInSubscriptOnly` walks the base chain (`no-op-statement.test.ts`, red first); `fixAbsent` remove.
      - *Stale records* (low) — FIXED: the C0228 row and 1.1's `defaultValue` (now `noInitialValue`, the BASE type's zero),
        `fold.test.ts`'s comment and test name, `qf_c0228_initialize`'s description, design.md's "four more AFTERs" (six:
        C0228 ×2, C0087 ×2, C0119 ×2).
      Numbers: confirmed 3150 → 3156, refused 2101 → 2103, not-lowered 385 (−1 `qf_c0228_bound` now lowered, +1 the
      nested no-op statement), lsp-gap 89 → 90 (`qf_c0228_bound_inline_subrange`, niche; ceiling moved with its reason),
      edge agree 3383. Census: TP 5832 → 5839 (CS); new GAPs excepted by name (`baseline-c.ts`: the inline subrange's
      two, CODESYS's project-config "variable is too large" after `ARRAY[2..0]`). Gate: typecheck clean; full LSP suite
      `VOLT_REQUIRE_FULL=1` (no `VOLT_FIXTURES`) 10 065 pass, 0 fail, 34 skip, 428 todo, 10 527 tests across 356 files,
      760 s; fixture map regenerated (`rate:fixtures`).

## 2. Build

- [ ] 2.1 The fix model; the existing conversion wrap moved onto it.
- [ ] 2.2 The fixes, in census order, each green against its recorded AFTER.
- [ ] 2.3 Source actions and "fix all in file" where 0.2 chose them.
- [ ] 2.4 The cheap navigation-breadth gaps; the rest filed with their measurement.

## 3. Close

- [ ] 3.1 Coverage: share of corpus diagnostics (by occurrence) that now offer a fix, before/after. Docs (`docs/behavior.md`
      or the services section of architecture.md); full suite cold green; archive.

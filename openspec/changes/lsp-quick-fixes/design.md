# Design — lsp-quick-fixes

The numbers this design rests on are task 0.1's (`tasks.md`), measured by `scripts/fix-census.ts` and
`scripts/nav-breadth.ts`. Both stay in `scripts/` because 2.4 and 3.1 re-run them.

## 1. What the census says, and how it is weighted

- The corpora compile clean, so they rank WARNINGS only: C0197 16, C0373 6, C0139 4, C0228 1 (and 216 Volt-format
  errors in twincat-project14's `References/`, a library-folder bug, §6). No error code ever occurs in a corpus, because
  the errors a user fixes while editing never get committed.
- So errors are ranked by FIXTURE occurrences. A fixture is one shape the compiler was asked about, so this measures
  how many shapes a code has, not how often a user meets it. It is the only ranking the repo can measure; edit-time
  frequency would need telemetry Volt does not collect.
- **Niche rule for this change (default taken, PENDING the owner's approval):** the owner's rule is "≈ 0 corpus
  occurrences AND not trivial to fix". For errors the corpus count is always 0, so applied literally it would remove
  every error fix; this change counts FIXTURES instead (≤ 3 per vendor). "Trivial" is read as the owner wrote it, not as
  "one token": a fix is trivial when its edits are LOCAL — insert, delete, replace or swap text inside the reported
  construct, in the reporting file, from facts the reporting check already resolved. A fix that edits another file, or
  builds code from facts outside the finding, is not trivial. A code on ≤ 3 fixtures per vendor whose fix is not
  trivial is "niche: accepted loss (N fixtures, 0 corpus)". (The first draft said "one-token edit" and then kept
  several multi-token fixes under it — review 2026-10-12; the rule above is the one the list below actually follows.)
- Today one fix exists (wrap in `TO_<T>(…)`, `services/assist/code-actions.ts`). It answers 8 of the 243 corpus
  findings and 721 / 697 fixture findings (CS / TC). It has no recorded AFTER, so it is not proven yet.

## 2. The fix model

A fix is DATA ON THE FINDING. The check that reports the finding produces it, from the facts it already resolved. The
code-action service only renders it. A fix and its finding are made in the same place, so they cannot drift apart. The
service also never has to re-derive what the check knew; today `wrapConversionFix` re-walks the body and re-infers the
type the check had already inferred.

```ts
// analysis/shared/diagnostic-item.ts
interface DiagnosticItem { …; fixes?: readonly Fix[] }
interface Fix {
  title: string                 // "Wrap in TO_INT(…)", "Declare 'x' : INT", "Change to 'counter'"
  edits: readonly FixEdit[]     // applied together, as one WorkspaceEdit
  preferred?: true              // only where no OTHER edit builds clean with a different meaning (§3), never on a choice
  fixAll?: true                 // safe to apply with every other fixAll fix of the file (§5)
}
interface FixEdit { uri?: string; span: Span; newText: string }  // uri absent = the reporting document
```

- **Produced by the check.** `emit(out, span, code, message, severity, fixes?)` gets an optional last parameter. A
  check offers a fix only when its facts are sufficient, for example an elementary target type. When they are not, it
  offers no fix, which is the honest answer for a fix it cannot prove. It does not guess one.
- **The policy keeps them.** `applyPolicy` copies a finding when it forces the finding's severity, and the copy must
  carry `fixes`.
- **Parse errors.** A C0002 "expected X" error is produced in the parser's recovery, so the insertion is attached at
  that point (the error records the expected token and the insertion offset). It is then carried through
  `checkParseErrors` like any other finding.
- **On the wire.** `toLspDiagnostic` puts the fixes in the LSP `Diagnostic.data` field. LSP 3.16+ clients return
  `data` unchanged in `codeAction`'s `context.diagnostics`. This works for both the pushed and the pulled diagnostics
  path.
- **Rendering.** `code-actions.ts` maps each `data.fixes[i]` to one `CodeAction` (kind `quickfix`, `diagnostics: [d]`,
  `isPreferred` from `preferred`, edits grouped by uri). It re-derives nothing. A diagnostic without `data` gets no
  action, because there is no fallback recomputation. The current `wrapConversionFix` is deleted, and the conversion
  checks emit the same fix as data (task 2.1).
- **Network text** findings get no fixes in this change (proposal, Order and scope).

## 3. The proof rule

A fix ships only with a recording that shows the compiler accepts its result:

- For EACH option a fix offers, and each site kind it handles, there is a pair of conformance fixtures:
  - BEFORE: the source that reports the diagnostic. Usually an existing fixture.
  - AFTER: the BEFORE text with exactly that action's edits applied, named `qf_<code>_<option>[_<site>]`.
- The AFTER fixture is recorded with `record:language` on CODESYS, and on TwinCAT where the code fires on TwinCAT (the
  census's TC column). The recording must say `buildSuccess` with no error, and no diagnostic of the fixed code. A
  warning that remains is allowed only if the AFTER fixture names it.
- A src test applies the action to the BEFORE fixture's text and expects the AFTER fixture's source byte for byte.
  `lsp-replay` then holds the LSP to the AFTER recording, so the LSP must also stay silent on the fixed text.
- Site kinds are covered systematically, not by example. The wrap is proven at every position the conversion checks
  report: assignment, call argument, initializer and return value. It is proven on the conversion pairs the recorded
  conversion fixtures show to compile with `TO_<T>`. A pair with no such recording gets no fix.
- If the compiler rejects an AFTER, that option is not shipped, and the finding is recorded in tasks.md.
- **A clean build is necessary, not sufficient** (review 2026-10-12). It proves the result compiles, not that it means
  what the user meant, and the recordings show both ways that goes wrong:
  - *An edit that deletes code is offered only where the deleted code does nothing the compiler cannot see.* C0139 also
    fires on a property read (`t.P;` calls the getter): removing it builds clean and changes what the program does. So
    a remove option is never offered on a statement that calls anything or reads a property.
  - *A finding the parser's recovery produced gets no fix of its own.* C0139 also fires on recovery leftovers (`NS;`
    from `T#5NS`, `RUE;`, `NETWORK;`, `!!!'ERROR'!!!;` — `ExprStatement.resumed` / `unterminated`); the repair is the
    root C0002's, and deleting the leftover is not one.
  - *`preferred` (the fix auto-apply picks) needs ONE meaning, not one clean build.* Where two edits each build clean
    and mean different things — which of two duplicate declarations survives, the override's signature or the base's —
    the clean build cannot choose, so the LSP must not: the options are offered unmarked. `preferred` is set only where
    the alternatives mean the same (for example, two duplicate declarations with the same type and initial value).
  - Each excluded class gets its own BEFORE fixture and a src test that the excluded option is ABSENT, so a later change
    cannot re-offer it unnoticed.

## 4. The fixes, in census order

| # | Codes (fixtures CS/TC; corpus) | Fix | Class |
|---|---|---|---|
| F1 | C0197 (66/59; 16), C0195 (373/316), C0032 elementary pairs (812/787), `call-argument-type` (45/39), `conversion-source-mismatch` (3/3) | wrap in `TO_<target>(…)` at every reported site; `X_TO_Y(e)` → `TO_Y(e)` for the source mismatch. C0032 adds `REF=` for a REFERENCE target and `E.member` for a strict-ENUM value | mechanical (C0032 choice) |
| F2 | C0139 (180/192; 4) | remove the statement — only on a COMPLETE statement (not `resumed` / `unterminated`: a recovery leftover gets no fix, §3) whose expression calls nothing and reads no property (`t.P;` gets no remove, §3); when the expression names an FB instance or a method, also offer calling it (`x();`) | choice |
| F3 | C0046 (97/288) and the near-miss family: C0077 (21/180), C0004 (20/20), `unknown-struct-field` (10/10), C0090 (11/11), C0037 (8/8), C0117 (7/7), C0086 (4/4), C0038 (4/4), C0237 (3/3), C0351 (46/0) | ONE near-miss engine (case-insensitive edit distance ≤ 2, over the names the reporting check already looked up in that scope): "Change to 'x'", one action per candidate, best first, at most 3. C0046 also gets "Declare 'x' : T", a local `VAR` whose type is inferred from the use: the other side of an assignment, the parameter type of an argument, BOOL for a condition. No inferred type means no declare fix. C0351 also gets "Remove the attribute" | choice |
| F4 | C0002 subset (97 / 91 of 2958 / 3906, measured by `fix-census.ts`'s C0002 family table: `';' expected instead of end of POU` 65/59, `';'` before `END_*` 10/10, `'END_*' expected` 10/10, end-of-file `END_*` 6/6, `'THEN' expected` 6/6), `unterminated-conditional-pragma` (3/3) | insert the expected token at the parser's recovery point | mechanical |
| F5 | C0198 (86/42) | widen the destination to `STRING(<literal length>)`; or shorten the literal | choice |
| F6 | C0136 (19/18) | qualify with each GVL that declares the name (`GVL_A.g`) | choice |
| F7 | C0228 (1/1; 1) | `:= <the type's initial value>`, i.e. the value the compiler already assumes | mechanical |
| F8 | C0094 (14/14), C0089 (18/9), C0087 (4/4), C0119 (6/6), `abstract-keyword-missing` (8/0), `abstract-and-final` (3/3) | C0094/C0089: "make the override's declaration the base's / the interface's", NOT preferred, because changing the base or the interface is just as valid (that edit is not offered: it touches another file and every other override, §1); add the missing METHOD/PROPERTY stub with the interface's signature; add `bInitRetains`/`bInCopyCode`; add ABSTRACT; remove ABSTRACT or remove FINAL | C0094, C0089 and `abstract-and-final` choice; the rest mechanical |
| F9 | LOCAL edits (§1's "trivial"): C0013 (12/12) `;`, C0130 (3/3) and `function-without-parens` (1/1) `()`, C0051 (6/6) quote, C0175 (4/4) RETAIN, `access-only-on-methods` (7/5), C0182 (2/2) remove `: T`, C0238 (1/1) remove the initializer, C0533 (2/0) remove the default value, C0550 (2/0) remove the pragma, C0421 (1/1) IMPLEMENTS→EXTENDS, `indexof-removed` (2/2) INDEXOF→ADR, C0203/C0204/C0206 (11/10, 4/4, 1/1) BIT→BOOL, `border-order`/`case-range-inverted` (2/2, 1/1) swap the bounds, C0118 (10/34) remove the label, `signature-name-mismatch` (8/8) rename to the object's name | the edit named | mechanical |
| F10 | C0142 (12/12), C0097 (3/3) | C0142: "remove the first" and "remove the second" declaration; C0097: "remove the redeclaration", its title naming what the derived FB then gets (`inherit FB_Base.x : INT := 0`). `preferred` only when the declarations agree in type and initial value (§3) | choice |

- **Niche (not built):** `dynamic-creation-pragma` (2/2 fixtures, 0 corpus). Its fix edits ANOTHER file (the FB's
  declaration), which is not trivial.
- **Kept although below the threshold:** C0087 (4/4) is above it. C0237 and the other ≤ 3 near-miss codes are free
  once F3's engine exists. The ≤ 3 rows of F9 and F10 (C0097, C0182, C0238, C0533, C0550, `border-order`,
  `case-range-inverted`, C0130, C0421, C0206, `function-without-parens`, `indexof-removed`) and
  `unterminated-conditional-pragma` (F4, an insertion at the recovery point the parser already records) are LOCAL edits,
  which §1's rule exempts — not "one-token" edits, as the first draft called them.
- **No fix:** the 113 codes tasks.md 0.1 lists (judgement), and `unknown-source` / `refused-initializer`, whose fix is
  their root finding's; likewise any finding on a parse-recovery leftover (§3).

Order of work: F1 first, because it moves the existing fix onto the model (2.1) and covers the only corpus warning
with a fix. Then F2 (the other corpus warning), F3, F4, and F5–F10.

## 5. Source actions

- **Fix all in file** (`source.fixAll.volt`, and "Fix all of this kind" on each quick fix) is built for F1 only. It
  applies every `fixAll` fix in the document whose edits overlap no other. It pays only where a code fires many times
  in one project: the 16 C0197 findings are all in bakon-nano. Every other code fires about once per file in the
  corpora and the fixtures.
- **Organize VAR sections** is NOT built; it is filed with its measurement. Only 42 of 1271 project units have two
  adjacent sections of the same kind to merge. Sorting sections changes declaration order, which a positional call
  binds by, so it is not semantics-free. The formatter has no section order to follow.

## 6. Navigation breadth (task 2.4)

Fixed (cheap, measured in 0.1):

- **B1 Call hierarchy through instances:** a call whose callee is an FB INSTANCE (var, GVL var, array element) counts
  as a call of that FB type's body; 755 + ≈ 70 sites.
- **B2 Programs are callable:** 67 sites; 98 program bodies that prepare nothing today.
- **B3 Property accessors:** a call hierarchy prepares on a property; its outgoing calls come from its accessors (340
  bodies).
- **B4 `SUPER^()`:** a call of the base FB's body, 127 sites.
- **B5 Workspace symbols include members:** methods, properties, actions, interface members and enum values, with
  `containerName` set to the owner. Library symbols carry their library as the container. Locals, parameters and
  struct fields stay out.
- **B6 Rename follows override chains:** renaming a method or property renames every member of its override /
  implementation chain, including the interfaces a BASE FB implements (885 pairs in pro2193, 0/40 followed today;
  re-measured after the review counted base FBs' IMPLEMENTS and "a library member anywhere in the chain": unchanged). A rename whose chain reaches a LIBRARY member is
  refused by name (6 pro2193 members), because no edit could make that project whole again.

Filed (not this change):

- **TwinCAT libraries under `References/`.** `isLibraryUri` does not know this folder, so on a TwinCAT project its
  signatures are project source: 216 errors, renameable, listed as the project's. The fix needs a vendor-aware library
  rule in `frontend/library`, which every gate and check reads, so it is not a navigation tweak (the folder carries the
  IDE's node name, which `TcObjectModel` finds by item type because the name can be localized or renamed). 2.4 fixes it
  only if that rule turns out to be a few lines; otherwise it is filed as its own change. **The gate exists now** (step
  0, review 2026-10-12): `corpus-diagnostics.test.ts` reads each project's own vendor and recording, so
  twincat-project14 is gated; its 216 findings run as a known divergence (`CORPUS_DIVERGENCES`, every one under
  `References/`) that fails the suite the day they stop. Remove the mark then.
- **Ranking a 10–12k-symbol workspace answer.** The client filters by query, so the cost is only latency. Filed
  unless B5's bench shows it.

## 7. Red first (task 1.1)

**Target.** Every option §4 builds, at every site kind §3 names, has a recorded BEFORE → AFTER pair and an action test
that is red until its fix exists. Tally from §4: 63 AFTERs (F1 7, F2 2, F3 15, F4 6, F5 2, F6 1, F7 1, F8 7, F9 19,
F10 3) and 4 ABSENT cases (§3: F2 property read, F2 recovery leftover, F3 use with no inferred type, F10 declarations
that disagree — offered, not `preferred`).

**Choice: the AFTER is an ordinary fixture with its source written out, linked to its BEFORE by one new field.**

- `LanguageTest.fixOf?: { before: string; title: string }` on the AFTER (`qf_<code>_<option>[_<site>]`), in a new
  category `fixtures/quick-fixes/` (one file per F-row, registered in `fixtures/index.ts`). Being a plain fixture, the
  AFTER is recorded, rated and replayed by what exists: `record:language` records it, `lsp-replay` holds the LSP to it,
  `rate:fixtures` renders `fixOf` in `map.generated.ts`.
- The BEFORE is an existing fixture only when it reports exactly ONE finding of the code (the action has one target);
  otherwise a new `qf_<code>_before[_<site>]` beside its AFTERs. The ABSENT cases are BEFOREs carrying
  `fixAbsent: { title, why }`.
- ONE table-driven test beside the renderer (`src/services/assist/code-actions.test.ts`) walks every `fixOf`: binds the
  BEFORE as the replay does (`conformance/support/replay.ts`), takes its finding of the code through `toLspDiagnostic`
  (so `Diagnostic.data` is on the path), calls `codeActions`, applies the action titled `title`, and expects the AFTER's
  source byte for byte. It also asserts the recordings: BEFORE reports the code; AFTER `buildSuccess`, no error, no
  finding of the code. Each `fixAbsent` asserts no action with that title.
- Red is `test.failing` per pair (the lsp-server-scheduling precedent), so a fix that lands fails the suite until its
  mark goes. The F1 assignment pairs the current `wrapConversionFix` already answers run as plain tests from step 1.

Rejected:
- *AFTER derived by applying the LSP's own action* — the code would write its own oracle.
- *AFTER derived from BEFORE by a hand-written substitution* — compact, but recordings carry no source digest
  (`recordings/*.build.json` stores verdicts only), so editing a BEFORE would silently change an AFTER whose recording
  then proves a different text. A written-out AFTER fails the byte-for-byte test instead.
- *Variants on the BEFORE (`fixes: [{ title, after }]`)* — the recorder, rater and replays key one recording per fixture
  name; a variant would need a second key everywhere. `fixOf` costs one field.
- *A pairing table in the test file* — a second truth beside `map.generated.ts`.

**Recording.** All step-1 fixtures written first, then ONE `RECORD_ONLY=<qf_… list>` run per vendor, CODESYS and
TwinCAT (`VOLT_E2E_INSTANCE=lsp-quick-fixes`); CS-only codes (C0351, `abstract-keyword-missing`, C0533, C0550) still
record on TwinCAT, where the BEFORE builds clean and the test asserts the code only on the vendor that reported it.

**Refused by name.** An AFTER the compiler rejects is not shipped: its fixture is deleted, the BEFORE gets `fixAbsent`
with the compiler's words, and tasks.md records it. Network-text codes and §4's niche and no-fix codes get no pair.

**Migration.** The inline wrap test in `code-actions.test.ts` is replaced by the F1 pairs. `types.ts` gains `fixOf` /
`fixAbsent`; the rater learns to render them. Nothing else moves.

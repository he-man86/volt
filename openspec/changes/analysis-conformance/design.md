# Design: analysis-conformance

Paths are relative to `packages/volt-lsp-iec/`. The census numbers below come from the 2026-10-01 scratch census
(`check-census.ts`, run while `frontend-conformance` was still open at 2.3.6). Treat them as the expected shape of the
problem, not as the answer. Task 0.1 measures them again on the archived front-end, and only the committed baselines count.
The file facts (importers, helpers, file lists) were re-measured on the tree of 2026-10-01 while this design was written;
where a review claim disagreed with the tree, the tree is what is written here.

This change starts only after `frontend-conformance` is archived (execute-change `requires: ["frontend-conformance"]`).
That change owns every P6/P7 move out of analysis: `resync`, `refused-name`'s cascade, `unsupported-operator`,
`partial-access`, `call-result-access`, the IL call form, `nameResolves`, the operator tables, attribute and conditional
pragma parsing, `compilerArrayText`, and the base resolution by name. This design does NOT redo any of them. Task 0.5
lists what that change left in `src/analysis/`, and only those leftovers are placed here (§2, `checks/syntax/`).

Owner constraint (2026-10-01): network text (LD/FBD) will change in a later LD/FBD coverage change. This change touches it
only where it is INTEGRATED into the LSP — how a network body enters diagnostics, services and the server. No design effort
goes into its parser, model or checks.

Contents:

1. Principles
2. Target structure of `src/analysis`
3. The network-text seam
4. Old → new map
5. Check catalogue
6. Measure plan
7. What this change does not do

---

## 1. Principles

**P1. One pipeline.** Exactly one function turns a parsed document into Volt's diagnostics: `computeDiagnostics`
(today `computeSemanticDiagnostics`). It runs every check, including the network-text check, in one registry, and then
applies the policy once:

- vendor gating;
- configurable severity and "off";
- TwinCAT's per-line dedupe.

The server adds only server policy on top (§3 "Server merge" lists it exhaustively): the library-file gate, dead POUs and
members, unstated bodies, the other-materialization gate, the missing-language, retired-comment and manifest findings, and
the LSP shape. Every test and script that needs "what the LSP says about a source" calls that one function. Today the
composition exists four ways (server, `fixtures.test.ts` `runLsp`, `evidence.ts` `diagnosed`,
`scripts/agreement-residue.ts`), and they give different answers: evidence double-counts parse errors, the network pass
skips config, and the server shows every top-level parse error twice.

**P2. One home per check group, one owner per rule.** Each check lives in one group folder. A rule that more than one
check applies lives in `shared/` (the store, narrowing, conversion-argument and binary-operator rules, resolution,
holes, the expression echo, the body context, lost declarations). A check imports `shared/`, `messages`, `config` and
`pipeline/context`. It never imports another check or the registry.

**P3. The registry is data, and its order is a stated contract.** Each entry carries:

- its group;
- its vendor scope (`both | codesys | twincat`), each with the note of what was measured;
- the codes it `reads` from earlier findings.

A test asserts that every producer of a code a check reads runs before that check. Today this contract is implicit, and
only `unknown-source` is documented as "LAST".

**P4. Analysis reads the front-end and network text only through an index, and nobody reads analysis except through
its index.** Production code already follows the first half. The second half is broken by six files (measured: §4 row
"index.ts"). Both halves become gate rules A1–A6 in `scripts/check-layering.ts` (§2), with an allow-list that may only
shrink.

**P5. Analysis owns no grammar and no typing.** A refusal of the parser's, or a type rule, that the front-end now owns
is not re-decided here (frontend P6/P7). If something is still in analysis after `frontend-conformance`, 0.5 lists it by
a mechanical test (§2 "Parser-cascade test"). It sits in `checks/syntax/` (refusals) or is named as a known divergence.
It is not redesigned.

**P6. Network text at its seams only** (owner, 2026-10-01). Its parser, model and network checks will change in the
LD/FBD coverage change. Here a network body crosses into analysis, services and the server through ONE interface (§3).
Files move whole. Only the entry signature changes. Nothing inside `network-text/parser.ts`, `ast.ts`, `exprs.ts`,
`network-analyze.ts`'s model or the network check bodies is reworked, and no field of `NetworkTextAnalysis` is renamed.
Known network-internal problems (the duplicate jump-label rule, the SCREAMING `NETWORK_*` codes, no `Cnnnn` mapping for
network codes, the `.vg` field name) are handed off in task 5.3. They are not fixed here.

**P7. Restructure first, output-neutral, measured against the parent commit.** Phase 1 changes no diagnostic. Snapshot
**A** (§6) is compared against `HEAD~1` the way frontend-conformance P9 compares F. A move that would change A is not
done in phase 1. It is filed as a phase-2 (seam) or phase-3 (conformance) task. A step never mixes an output-neutral (R)
task with an output-changing (N) one: tasks.md's sub-sections are the step boundaries.

**P8. Measure first; baselines may only fall.** Every false positive (LSP-only) and every gap (IDE-only) is counted per
vendor, per check, per message builder, on fixtures and corpora. The counts are committed baselines with ceilings
(`test/frontend/baseline.ts` discipline). A conformance task lowers a ceiling, or names why its number stayed.

**P9. The recordings decide; the niche rule triages.** A disagreement gets one of three outcomes:

- fixed test-first against a recorded fixture;
- or, if cheap, fixed directly;
- or, if it has about zero occurrences in the six corpora and is not trivial, it becomes a known divergence with the
  reason `niche: accepted loss (N occurrences in the corpora)`.

A builder no vendor ever emits is deleted, not kept "for completeness".

---

## 2. Target structure of `src/analysis`

```
analysis/
  index.ts                 explicit export list (no `export *`): the public API — §2 "Index contents"
  config.ts (+ config.test.ts)
                           Vendor, VendorSetting, CONFIGURABLE_CHECKS/CODES, resolveConfig, WorkspaceRefs,
                           EMPTY_WORKSPACE_REFS, projectDiagnosticsFrom   (configurableCodeFor becomes module-private)
  messages.ts              Messages + messagesFor(vendor): EVERY message text (incl. the parse-error templates and the
                           three network-text builders), sections ordered like checks/; no duplicate builders
  error-code-map.ts        slug → Cnnnn + docs URL (display); exported through the index
  pipeline/
    context.ts             CheckContext (uri REQUIRED), Check type
    registry.ts            CHECKS: { check, group, vendors, reads?, note } in run order — the ONE vendor table
    policy.ts              configurable severity/off, TwinCAT dedupePerLine
    diagnostics.ts         computeDiagnostics(args) — dialect assertions, run registry (optionally restricted to
                           `args.groups`), policy; PROFILE_CHECKS timing; runRegistry(ctx, onCheck?) for the census
    diagnostics.test.ts    (was analysis/analysis.test.ts — the pipeline-level tests)
    registry.test.ts       the order contract (`reads`), the vendor table, registry entry ↔ file (A6)
  shared/                  rules more than one check applies (a check imports these, never a sibling check)
    diagnostic-item.ts     DiagnosticItem, SOURCE, emit(out, span, code, message, severity?), pushForDeclaration
    codes.ts               the code slugs read ACROSS checks (hole's RESOLUTION_FAILURE / REFUSED_OUTRIGHT inputs,
                           the network codes among them) — no check hard-codes another's string
    rules.ts               store / narrowing / conversion-argument / binary-operator message rules
    resolution.ts          what frontend-conformance 3.1.5 left: unresolvedInExprs, unresolvedMembers, refusedSystemNames,
                           unknownTypeName, dialectMissingType (or their index re-reads, if moved)
    hole.ts                isHole, reported, literalHole, enumTypedLiteral, passThroughOperand, bareConversionArgument
    expr-echo.ts           compilerExprText (+ the STRUCT(...) echo struct-init builds inline today)
    body-context.ts        bodyContext
    lost-declaration.ts    reportLostUses (its one caller today is external-global; it is shared so a later caller
                           never has to import a check)
  checks/
    types/         assignment narrowing binary-operators conversion unary-operand comparison constant-overflow
                   string-constant pointer-conversion deref subrange array-bounds bit-number indexing array-init
                   struct-init reference-assign data-recursion enum-init typed-literal unsupported-operator°
                   partial-access° unknown-source
    declarations/  const-context declared-type constant-initializer external-initializer external-global
                   input-default bit-usage output-rules non-instantiable obsolete-usage at-address° header-rules
                   attribute-placement var-section-placement inout-initializer unknown-type system-initializer°
                   refused-initializer dynamic-creation signature-name
    names/         duplicate-declaration unresolved-identifier ambiguous-global type-as-value reserved-keyword
                   refused-name° conditional-call°
    oop/           inheritance property-access method-reference inherited-variable external-write
                   inout-access (inout-external-access + inout-own-access: one home for the inout codes)
                   fb-init-inout fb-init-instantiation generic-instantiation abstract-assign lifecycle
                   abstract-instantiation interface-implementation method-signature abstract-output-default
    calls/         call-arguments call-result-access° fb-instantiation intrinsic-operands non-callable-call recursive-call
    flow/          case-labels statement-rules new-in-expression jump-labels no-op-statement empty-block loop-exit
                   this-super-context
    pragmas/       pragmas
    syntax/        parse-errors (the drain of front-end errors in vendor wording) + every ° check that 0.5's
                   parser-cascade test moves here
    network/       network-text — the network body check, moved whole from src/network/network-analysis.ts (§3),
                   with its tests (§3 "Tests")
  test-uri.ts              test support (uriFor) — kept: colocated tests import it, and it is excluded from the build
```

`°` marks the seven **parser-cascade candidates**. Each one's DEFAULT home is its folder today, listed above. Task 0.5 can
only move a candidate to `syntax/` (or record that frontend-conformance deleted it); it never invents a third home. Every
candidate is reviewed in exactly one 3.x group whatever 0.5 decides (tasks.md §3 names each).

**0.5 measured (2026-10-06).** Four of the seven are GONE — frontend-conformance deleted `unsupported-operator`,
`partial-access`, `refused-name` and `system-initializer` (no file, no registry entry; their wording reaches the editor as
the parser's, through `parse-errors`). The other three STAY in their folder, each failing both halves of the test:
`at-address` (builder `directAddressMalformed`, a type/symbol builder; 14 findings, 0 on a line with a parse error),
`conditional-call` (`parenExpectedInsteadOf` and `expressionExpectedInsteadOf` are parser wording, but
`conditionalCallSecondParameter` and `notSupportedInDeclaration` are not; 28 findings, 0 on a parse-error line) and
`call-result-access` (`callResultAccess`, a type builder; 6 findings, 0 on a parse-error line). `checks/syntax/` therefore
receives none: 1.15 is skipped with that note.

**Parser-cascade test (0.5, mechanical).** A candidate moves to `syntax/` only if BOTH hold on the census:

1. every builder it calls is parser wording (`unexpectedToken`, `*ExpectedInsteadOf`, `percentNotAMember`, or
   `codeHasNoEffect` emitted at a refused span), and no type/symbol builder (`cannotConvert`, `unknownType`,
   `callResultAccess`, `directAddressMalformed`, …);
2. every finding it emits on the fixtures and corpora sits on a span where the front-end recorded a parse error or a
   refusal (the census attributes the span; one counterexample keeps the check in its group).

Otherwise it stays in its group and is reviewed there as an ordinary check.

**Leaving analysis:**

- `reachability.ts` (and its test) → `server/reachability.ts`. Its consumers are the server and `scripts/corpus-fp.ts`;
  it is server suppression policy.
- `incremental-index.test.ts` → `server/`.
- `conversion-name.test.ts` → merged into `checks/types/conversion.test.ts`.
- `checks/types/implicit-conversion.test.ts` and `checks/types/negation-sign-change.test.ts` (tests with no subject file:
  both pin `narrowing`'s warnings) → merged into `checks/types/narrowing.test.ts`.
- `analysis.test.ts` → `pipeline/diagnostics.test.ts`.
- `resync.ts` → gone by frontend 2.8.3. If 0.5 finds it alive, it moves to `shared/` unchanged.

**Import rules** (gate `scripts/check-layering.ts`, run by `test/frontend/layering.test.ts`):

| Rule | Statement |
|---|---|
| A1 | analysis imports the front-end only via `frontend/<layer>/index.js`, and network text only via `network-text/index.js`. `reference/index.js` is allowed. |
| A2 | Outside `src/analysis/`, the only analysis file anyone imports is `analysis/index.js`. This covers `src/`, `test/` (including the new `test/analysis/`) and `scripts/`, and is the P4 analogue. A dynamic `import()` counts. |
| A3 | A non-test file in `checks/` imports nothing in `checks/`, and never `pipeline/registry` or `pipeline/diagnostics`. A colocated `*.test.ts` may import its own subject and `analysis/index.js` (the pipeline), nothing else in `checks/`. |
| A4 | `shared/`, `messages`, `config` and `pipeline/context` import no check. |
| A5 | No analysis file, tests included, imports a rank above analysis (server, network, workspace-refs). This fixes `incremental-index.test.ts` and `obsolete-usage.test.ts`. |
| A6 | Both directions: every `checks/**/<name>.ts` has a `<name>.test.ts` beside it, and every `checks/**/<name>.test.ts` has a `<name>.ts` subject beside it; every registry entry's file exists in its stated group folder. |

`test/analysis/` is not under `src/`, so it needs no layer rank (the "folder with no rank" rule covers `src/` only). It
is covered by A2: it imports `analysis/index.js`, the front-end through its indexes, and the conformance/corpus support
modules. `test/README.md` and `TESTING.md` list it as a concern in the same commit that creates it (0.1).

**Index contents:**

- `computeDiagnostics`, `DiagnosticsArgs`, `CheckGroup`, `DiagnosticItem`, `SOURCE`;
- `Vendor`, `VendorSetting`, `resolveConfig`, `ResolvedConfig`, `AnalysisInitOptions`, `CONFIGURABLE_CODES`,
  `WorkspaceRefs`, `EMPTY_WORKSPACE_REFS`, `projectDiagnosticsFrom`;
- `Messages`, `messagesFor`;
- `codesysCodeFor`, `CODESYS_CODE_MAP`;
- the shared surface census tools consume: `assignmentPairError`, `narrowingPairError`, `conversionArgError`,
  `binaryOpError`, `stringLiteralMessageType`, `unresolvedInExprs`, `unresolvedMembers`, `compilerExprText`, `isHole`,
  `reported`, `bareConversionArgument` (the network check reads them through `shared/` once it lives in analysis);
- `runRegistry` and `CHECK_REGISTRY` (read-only, for the census).

`parseErrorMessage` and `vendorReportsParseError` leave the index once the server's raw stream is gone (2.5). The
reachability exports leave with the file.

---

## 3. The network-text seam — PARKED

> **Parked (owner, 2026-10-01): the network language will still change, so this section is NOT executed here.** Nothing
> of `src/network` or `src/network-text` moves or is rewired in this change; A1's network clause and the
> `checks/network/` folder of §2 do not apply. The section stays as the analysis for the LD/FBD coverage change (task 5.3).

**Today** network text crosses at nine places (S0–S9 in the map). Three of them are wrong for diagnostics:

- a second orchestrator, `computeNetworkTextDiagnostics(doc, project, messages, refs)`, sits beside the ST one;
- that orchestrator gets no config, so `jump-label-unreferenced` (C0118, configurable) ignores the project's switch,
  dedupe and the vendor table never apply, and the server's `quiet()` is applied to ST findings only;
- `services/structure/semantic-tokens.ts` imports `network/` upward, which is the one `KNOWN_OTHER_VIOLATIONS`.

**Target: one interface, `network-text/index.ts`, rank 2.5.** It is what every layer above reads:

```ts
// what crosses: a BodySpan the front-end already routed to the 'network' reader (bodyReader), the unit it belongs to,
// the project Scope, the uri. What comes back is data, never diagnostics or LSP shapes.
export { parseNetworkText, STRUCTURE_ONLY, NETWORK_TEXT_KEYWORDS, NETWORK_TEXT_WORDS } from "./parser.js"
export { analyzeNetworkText, instanceFb, networkNetworkAt, type NetworkTextAnalysis } from "./analyze.js"
export { networkValueExpr, statementExprs, callReading, executeBoxes } from "./exprs.js"
export { walkValues, statementTargets, type NetworkTextStatement /* … */ } from "./ast.js"
```

The list above is indicative. **The export list is the measured union** of what `services/`, `network/`, `analysis/` and
`test/`/`scripts/` import from `network-text/*` and `network/network-analyze.ts` at task 2.1 (a grep written under the
task), so the step's "no deep import" gate cannot fail on a missed symbol.

`network/network-analyze.ts` only imports the front-end and network text, so it is the network front-end's bind step.
It moves whole to `network-text/analyze.ts`. Analysis (rank 4) and services (rank 5) may then import it, and the
services→network violation disappears without a line of semantic-token logic changing.

**What remains of `src/network/` (rank 6).** After phase 2 it is the services-side of network text only:
`network-services.ts` (the network position services), `network-symbols.ts` (document symbols) and their tests
(`highlight-network-text.test.ts`). `network/index.ts` exports only those; it no longer re-exports `network-text/ast`,
`parser` or `exprs`, so there is ONE network-text interface. `src/index.ts` (the package barrel) gains
`export * from "./network-text/index.js"`, so the names the package exposed stay public; `computeNetworkTextDiagnostics`
leaves the public API (no consumer outside the package: measured, `@volt/lsp-iec` is imported by no other package's TS),
replaced by `computeDiagnostics`, which now covers network bodies. The final folder names are `lsp-package-structure`'s.

**Diagnostics:**

- `network/network-analysis.ts` moves whole to `analysis/checks/network/network-text.ts`.
- Its entry becomes the registry check `checkNetworkText(ctx: CheckContext, out)`. It reads `ctx.parseResult`,
  `ctx.uri`, `ctx.project`, `ctx.messages` and `ctx.references`, and calls `graphicalBodies(ctx.parseResult.units)`
  itself.
- **It keeps a local slice.** It runs its body pass into a local array, calls its hole pass's `reported(local)` on that
  array exactly as today (network-analysis.ts:403), and only then appends to `out`. It does not read ST findings.
- **It runs LAST,** after `unknown-source`. So no ST check ever sees a network finding in `out`, and the network pass
  sees no ST finding: neither direction of `reported()` changes. Its `reads` is empty. 0.4 still measures both directions
  (which network codes are in hole's sets; which ST codes a shared `out` would expose) so the registry note records why
  "last" is safe.
- Its codes that `hole.ts` reads come from `shared/codes.ts`.
- `computeNetworkTextDiagnostics` is deleted from `network/index.ts`.
- **Network text OFF.** The shipped editor runs with `VOLT_GRAPHICAL` unset (`server/config.ts` `NETWORK_TEXT_ENABLED`);
  every test preloads `test/network-text-on.ts`. When the parse was not network-enabled, `graphicalBodies` is empty and
  the check emits nothing. 2.4 adds a pipeline-level test that asserts it (`network-text-switch.test.ts` keeps covering
  the server). Snapshot A and the census measure network-text ON (the test preload) and say so in their headers.

Each body still goes to exactly one analyzer by the front-end's `bodyReader`: the ST checks see `isStBody` bodies
through `scoped-bodies`, and `checkNetworkText` sees `graphicalBodies`. The split was implicit and is now stated in
`registry.ts`'s note on the entry.

**Tests.** `src/network/network.test.ts`, `network-real-shapes.test.ts` and `network-wire-type.test.ts` call
`computeNetworkTextDiagnostics`. They move to `analysis/checks/network/` in 2.4: the diagnostic tests merge into
`network-text.test.ts` (the A6 partner of the moved check), and the shape/wire-type files keep their names beside it.
They call `computeDiagnostics` through `analysis/index.js` (A3 allows a colocated test that), filtered to the network
codes, so they test the check through the one pipeline. Any of their tests that exercises `analyzeNetworkText` alone
(no diagnostics) stays in `network-text/` instead.

What this changes in output is exactly four classes, and 2.4/2.5 list each one from snapshot A's diff:

- config forcing and "off" now reach network codes (`jump-label-unreferenced`, C0118);
- TwinCAT's dedupe now reaches network findings (and dedupes across ST and network findings on one line);
- the server's `quiet()` now covers network findings inside unstated bodies;
- the duplicate codeless parse error vanishes (2.5).

The other-materialization gate is NOT a fifth class: it is kept as server policy (below), with a test pinning it.
The recordings decide which of the four are right.

**Server merge.** `documentDiagnostics(store, d)` becomes `computeDiagnostics` plus server policy. Its separate
`messages` parameter goes (2.5): the pipeline builds its messages from `store.config` (`messagesFor(config.vendor)`), so
a second source that could disagree no longer exists. Callers: `server.ts`, `bench.test.ts`, `diagnostics.test.ts`.

The server policy, exhaustively:

| Policy | Today | Target |
|---|---|---|
| library-file gate | `isLibrarySymbol` → `[]` | unchanged |
| dead POU | semantic pass skipped; raw parse errors still shown | nothing at all, parse errors included (recorded: `dead_fb_*`, see "Recorded" below; the `groups: ["syntax"]` plan was wrong) |
| dead member | `inDeadMember` filters ST findings and network findings, not raw parse errors | one `quiet()` over every item, exempting the parse-error codes (`PARSE_ERROR_CODES`, see below) |
| unstated body | `inUnstated` filters ST findings and raw parse errors, not network findings | the same `quiet()`, so network findings inside an unstated body go too (class 3) |
| other materialization (`materializationMismatch`) | drops all network findings, keeps ST findings | `groups` excludes `"network"` when it holds — the same output as today; 2.4 pins it with a test |
| missing language, retired comments, manifest findings | appended | unchanged |
| raw `parseResult.errors` stream | appended (the duplicate) | dropped (2.5) |

The raw stream is the confirmed duplicate: every top-level parse error is shown once with code C0002 and once with no
code. Task 0.4 first proves that the raw stream ⊆ `checkParseErrors` output on the corpora and fixtures. If any raw
error has no partner, that is a finding fixed in `parse-errors.ts` before the stream goes.

**As built (2.5, 2026-10-06): the dead-member exemption is every parse-error code, not `syntax-error` alone.**
`checkParseErrors` gives a parse error one of four codes (`syntax-error`, and the three a conditional pragma or a
`hasattribute` operand keeps: `orphan-conditional-pragma`, `unterminated-conditional-pragma`, `attribute-value-string`).
The raw stream showed all four in a dead member; exempting `syntax-error` alone would have quieted the other three
there, a silent loss the "parse errors still shown" rule does not allow. So `parse-errors.ts` exports
`PARSE_ERROR_CODES` (the set `parseErrorCode` draws from) and the server exempts it. One side effect, named:
`attribute-value-string` is also the pragmas check's code for an unquoted `hasattribute` operand OUTSIDE a body, which
is therefore shown in a dead member too (0 occurrences in the six corpora, none of which has a parse error at all).
`parseErrorMessage` and `vendorReportsParseError` stay in the index: the server no longer reads them, but the
front-end's parse-error dumps (`test/frontend/dumps.ts`) do.

**Recorded (gate 2, 2026-10-06) — the dead POU row above was WRONG, the dead member row right.** The first build ran
`groups: ["syntax"]` on a dead POU and showed its parse errors, with no recording behind it. Four fixtures
(`test/conformance/fixtures/grammar/dead-code.ts`) asked both vendors: an FB nothing instantiates builds CLEAN with a
statement parse error (`dead_fb_missing_then`) and with a declaration parse error (`dead_fb_declaration_parse_error`) —
the build never reads a dead POU, so the server gives it nothing (`dead ? []`, as before 2.5 for the semantic pass;
HEAD's raw-stream copy of its top-level parse errors was a false positive too). A method nothing calls inside a live FB
IS read: its statement parse error is reported on both (`dead_method_missing_then`), as its declaration parse error was
(`sig_empty_type`) — so the dead-member exemption stands. The C0051 side effect is right as well: an unquoted
`hasattribute` operand in the declaration of a method nothing calls is reported by CODESYS exactly as in a live one
(`dead_method_hasattribute_unquoted` vs `prag_hasattribute_unquoted_in_declaration`); TwinCAT is silent in both, the
existing accepted loss. So the exemption stays keyed by code, which here coincides with what the vendor shows. In the
replay (no reachability) the two dead-FB fixtures are a known divergence (`DEAD_POU_NOT_IN_THE_REPLAY`).

**Services** (owner: "maybe the way it is integrated in the LSP might need improving"). Kept small:

- **Routing.** `inNetworkText` and the private `vgBodyAt` are replaced by one front-end query,
  `bodyAtOffset(units, offset)` in `frontend/syntax/format/bodies.ts`, which returns the body and its reader. Every
  caller switches to it: the server's four position handlers (hover, definition, typeDefinition, completion) through one
  `routeAt(doc, offset)` helper, and inside `network-services.ts` `resolveAnywhere` (line 150) and the two functions that
  call `vgBodyAt` (lines 134, 273). The five `*Anywhere` combinators stay: references, highlight and rename are
  cross-language by nature, and that is the one sanctioned home for "both languages". They are documented as such and
  not merged.
- **`readOnlyBodyHover`** (the `IMPLEMENTATION <LANG> UNSUPPORTED` line, which is about CFC/SFC/IL as well) moves to
  `services/assist/hover`.
- **Routing tests first.** Snapshot A covers diagnostics only, so 2.2 writes named routing tests BEFORE the change and
  they must pass unchanged after it: a position in an ST body, in a graphical body and on an `UNSUPPORTED` line, through
  each of the four handlers and through `resolveAnywhere`.
- **One parse per body per project.** Task 0.4 measures how often `parseNetworkText` runs per edit (expected up to 4×
  plus once per position query) and its time on the corpus graphical bodies.
  - If the measured cost is below 5% of a `documentDiagnostics` pass, nothing is cached (P9: no speculative work).
  - Otherwise a memo is added AT THE SEAM, in `network-text/index.ts`, wrapping the exported functions without touching
    their bodies: `STRUCTURE_ONLY` parses per `BodySpan` (a WeakMap — it does not depend on the project), and
    `analyzeNetworkText` per (`BodySpan`, project object) in a nested WeakMap. A new symbol table is a new object, so no
    invalidation stamp is needed.
- **Vocabulary at the seam.** "Vg" is retired from EXPORTED names only: `documentSymbolsWithVg` →
  `documentSymbolsWithNetworks`; `vgBodyAt` disappears with the routing. The internal field `NetworkTextAnalysis.vg` is
  network-text internals (P6) and is handed off in 5.3, not renamed here. "graphical" (the language family:
  `isGraphicalBody`, `graphicalBodies`) and "network text" (the encoding) both stay. They name different things.

**Not crossing, by decision:** signature help, implementation, inlay hints, code lens, code actions and hierarchy stay
ST-only (S8). Inside a network body they see no ST statements and return nothing.

---

## 4. Old → new map

| Old | New | Task | Kind |
|---|---|---|---|
| `analysis/diagnostics.ts` CheckContext/Check | `pipeline/context.ts` (`uri` required) | 1.6, 1.13 | R |
| `analysis/diagnostics.ts` CHECKS + CODESYS_ONLY + TWINCAT_ONLY | `pipeline/registry.ts` (one table, groups corrected, `reads`) | 1.6, 1.7 | R |
| `analysis/diagnostics.ts` severity forcing, dedupePerLine | `pipeline/policy.ts` | 1.6 | R |
| `analysis/diagnostics.ts` computeSemanticDiagnostics | `pipeline/diagnostics.ts` computeDiagnostics (+ `groups`); old name kept as an alias until 4.4, then deleted | 1.6, 4.4 | R |
| `analysis/analysis.test.ts` | `pipeline/diagnostics.test.ts` | 1.14 | R |
| `rules.ts`, `resolution.ts`, `hole.ts`, `expr-echo.ts`, `body-context.ts`, `diagnostic-item.ts`, `lost-declaration.ts` | `shared/` | 1.8 | R |
| the local `push()` helpers (measured 2026-10-01: 4 — intrinsic-operands, bit-usage, const-context, array-init) | `shared/diagnostic-item.ts` `emit` | 1.9 | R |
| `index.ts` `export *` | explicit list; the measured deep importers (`src/network/network-analysis.ts` → expr-echo, hole; `src/server/diagnostics.ts` → error-code-map; `test/frontend/bound-census.ts` → expr-echo, hole; `test/catalog/catalog.test.ts` → error-code-map (dynamic import); `scripts/coverage-doc.ts` → config; `scripts/probe-projectsettings-effect.ts` → config) through it | 1.3 | R |
| `reachability.ts` (+test), `incremental-index.test.ts` | `server/` | 1.4 | R |
| `conversion-name.test.ts`; `implicit-conversion.test.ts`, `negation-sign-change.test.ts` | `checks/types/conversion.test.ts`; `checks/types/narrowing.test.ts` | 1.14 | R |
| `oop/inout-external-access.ts` + `oop/inout-own-access.ts` | `oop/inout-access.ts` (two functions, adjacent registry slots kept) | 1.12 | R |
| messages `fbInitNoOutput`, `enumInitNotConvertible` | deleted (callers use `noInput` / `cannotConvert`) | 1.11 | R |
| parse-errors.ts inline templates; struct-init STRUCT echo | `messages.ts`; `shared/expr-echo.ts` | 1.11 | R |
| parser-cascade candidates that pass 0.5's test | `checks/syntax/` (the rest stay in their folder) | 1.15 | R |
| `network/network-analyze.ts` | `network-text/analyze.ts` behind new `network-text/index.ts` | 2.1 | R |
| semantic-tokens / folding / network deep imports into `network-text/*`, `network/network-analyze` | `network-text/index.js`; `KNOWN_OTHER_VIOLATIONS` empty | 2.1 | R |
| `network/index.ts` re-exports of network-text; `src/index.ts` | network/index exports services only; `src/index.ts` exports `network-text/index.js` | 2.1 | R |
| `network-services.ts` `vgBodyAt`, `inNetworkText`, `resolveAnywhere`'s routing; server's 4 ternaries | `frontend/syntax/format/bodies.ts` `bodyAtOffset`; server `routeAt` | 2.2 | R |
| `network-services.ts` `readOnlyBodyHover` | `services/assist/hover.ts` | 2.2 | R |
| `documentSymbolsWithVg` | `documentSymbolsWithNetworks` | 2.3 | R |
| `network/network-analysis.ts` (`computeNetworkTextDiagnostics`) + its three test files | `analysis/checks/network/network-text.ts` (`checkNetworkText`, last in the registry) + tests beside it | 2.4 | N |
| `hole.ts` network code literals | `shared/codes.ts` | 2.4 | R |
| server `otherFormat` drop of network findings | `computeDiagnostics({ groups })` without `"network"` | 2.4 | R |
| server `documentDiagnostics` raw parse stream; split quiet/inDeadMember; `messages` parameter; semantic skip on dead | dropped; one `quiet` exempting the parse-error codes (`PARSE_ERROR_CODES`, §3 "as built"); parameter gone; nothing on a dead POU (recorded, gate 2) | 2.5 | N |
| `evidence.ts diagnosed`, `fixtures.test.ts runLsp` network call, `agreement-residue.ts`, `audit-check.ts`, `corpus-fp.ts`, `verify-catalog.ts` | call `computeDiagnostics` only; `runLsp` and `agreement-residue.ts` share one composition, `support/replay.ts` `replayDiagnostics`; `corpus-fp.ts` asks the server's `projectDocuments` | 2.6 | N |

R = output-neutral (snapshot A identical). N = an output change that snapshot A lists class by class, with the
recordings deciding.

**What frontend-conformance left (0.5, measured 2026-10-06).** `resync` — gone (one word in a test comment,
`no-op-statement.test.ts`). `nameResolves` — present in `resolution.ts`, now a two-line wording of the front-end's
`resolveBareName` (callers `inheritance`, `assignment`, `unknown-type`); it moves with `resolution.ts` to `shared/` (1.8).
Operator tables — present as three local sets: `MATH_OPS` (`intrinsic-operands`), `CMP_OPS` (`comparison`),
`PASS_THROUGH_CALLS` (`hole`). Attribute and conditional pragma parsing — gone (`pragmas` and `attribute-placement` call the
front-end's `readAttribute` / `directiveOf`). `compilerArrayText` — present in `messages.ts` (caller `comparison`). The
parser-cascade row above moves nothing (§2, 0.5).

**Review claim not taken.** A review said `lost-declaration.ts` has four importers (external-global, call-result-access,
partial-access, unsupported-operator). Measured on 2026-10-01: `reportLostUses` has ONE caller, `external-global.ts`.
It moves to `shared/` anyway (P2), which is correct for one caller and for four.

---

## 5. Check catalogue

This is the human index; it is not gated. **The generated truth is `test/analysis/baselines/*`** (§6): the census test
asserts that its rows are exactly the registry's entries (a registry check with no census row, or a row with no
registry entry, fails it), and lists every builder with its TP/FP/GAP per vendor. Rows below are placed by the §2
folders; `°` rows are reviewed in the group named, whatever folder 0.5 gives them.

Columns:

- **cs / tc**: fixtures firing / FP (raw replay, before KNOWN_DIVERGENCES).
- **GAP**: no recorded fixture fires the check, or (for a builder) fires that message.
- **div**: the FP is a recorded divergence.

### types/

| Check | Messages (builders) | cs | tc | Status |
|---|---|---|---|---|
| assignment | cannotConvert, unknownType | 475 / 2 | 457 / 1 | 3.1: a literal 0/1 into a STRUCT/FB/ARRAY is BIT (`litc_*`, LITERAL_ONE_IS_BIT closed), a literal into an ARRAY and by a STATEMENT checked; FP sysop_position_* ×2 niche (0 `__POSITION` in the corpora) |
| narrowing | narrowing, signChange, cannotConvert (via rules) | 231 / 0 | 242 / 0 | OK |
| binary-operators | modNotDefined, cannotConvert (via rules) | 22 / 0 | 22 / 0 | OK. meet_bool_mod_int is CODESYS triage; re-measure |
| conversion | cannotConvert | 3 / 0 | 3 / 0 | OK |
| unary-operand | cannotConvert | 19 / 0 | 19 / 0 | OK |
| comparison | compareNotPossible, compareNotPossibleTwo, enumComparison, cannotCompare, signChange | 34 / 0 | 34 / 0 | 3.1: every builder fires (`cmpop_*`, 33 cells); two arrays one type by FOLDED bounds, each named as written with an operation in a bound parenthesized (gate review), array/struct/FB vs a named operand = C0066, enum variable vs another enum's value warns, pointer vs integer by width (`compat` `pointerComparison`) |
| constant-overflow | constantTooLarge | 19 / 0 | 19 / 0 | OK |
| string-constant | stringConstantTooLong | 35 / 3 | 26 / 3 | FP ir_initializer_warning_no_instance (div DEAD_POU_NOT_IN_THE_REPLAY), decl_string_length_expression (div STRING_LENGTH_AS_WRITTEN, 3.1: niche, 0 operation-lengths in the corpora) |
| pointer-conversion | cannotConvert, signChange | 25 / 0 | 27 / 0 | 3.1: NOT C0033 — the ordinary conversion ERROR (SEV 19 → 0 per vendor); signed LINT (and __XINT) = change of sign, REAL silent on CODESYS / refused on TwinCAT, every other elementary refused (DATE/DT/TOD/LTIME/WSTRING measured in the gate review), initial values checked, a REFERENCE's too (`compat` `pointerIntoElementary`) |
| deref | dereferenceRequiresPointer | 2 / 0 | 2 / 0 | OK |
| subrange | cannotConvert, subrangeAssignTarget | 3 / 0 | 3 / 0 | OK |
| array-bounds | arrayIndexOutOfBounds | 2 / 0 | 2 / 0 | OK |
| bit-number | bitAccessOnCall, invalidBitNumber | 3 / 0 | 3 / 0 | OK |
| indexing | pointerIndexArity, arrayIndexCount, indexingNonArray | 3 / 0 | 3 / 1 | FP tc cc3_pointer_conversions |
| array-init | arrayInitCountNonConst, unexpectedArrayInit, arrayInitExpected, initListExpected, tooManyArrayInit, cannotConvert | 9 / 1 | 9 / 0 | 3.2: every builder fires (`arrinit_*`, 11 cells); C0232/C0233 per scalar with its conversion, C0075 over every dimension and beside C0232, C0074 with the `'[1, 2]'` conversion; FP cs decl_nested_aggregate (div: CODESYS's compiler throws) |
| struct-init | unexpectedStructInit, undefinedIdentifier, notAssignmentTarget, cannotConvert, unknownType | 6 / 0 | 6 / 0 | OK |
| reference-assign | refInitNeedsReference, referenceAssignTarget, cannotConvert, referenceAssignWriteAccess | 4 / 0 | 4 / 1 | FP tc cc3_reference_assign (TwinCAT triage) |
| data-recursion | dataRecursion | 2 / 0 | 2 / 0 | OK |
| enum-init | invalidEnumInitialisation, cannotConvert, constInitNonConst, enumConversion | 9 / 0 | 9 / 0 | 3.2: each value kind (`eninit_*`, 12 cells: REAL, STRING, BOOL, TIME, non-constant global, another enum's member; taken: typed INT, sibling expression, global CONSTANT); the duplicate-value warning a refused value leaves is 3.11's |
| typed-literal | notAMember | 17 / 0 | — | CODESYS only by rule (the TwinCAT lexer refuses first) |
| unsupported-operator° | semicolonExpectedInsteadOf, unexpectedToken, codeHasNoEffect | 4 / 0 (with partial-access) | 4 / 0 (with partial-access) | frontend 2.5.3; 0.5 decides syntax/ or stay; reviewed in 3.2 |
| partial-access° (TwinCAT) | percentNotAMember, unexpectedToken | (counted with unsupported-operator) | (idem) | frontend 2.5.4; 0.1 splits the count; reviewed in 3.2 |
| unknown-source (LAST of the ST checks) | cannotConvert, unknownType, notAssignmentTarget, notStructuredVariable | 50 / 9 (div) | 88 / 10 (div) | 3.2: an undeclared REF= target said once (`refdecl_target_undeclared`, the open FP; `assignment` no longer says it too); every FP re-confirmed a divergence with its reason |

### declarations/

| Check | Messages | cs | tc | Status |
|---|---|---|---|---|
| const-context | arrayBoundNonConst, stringLengthNonConst, constInitNonConst, defaultNotConstant | 6 / 0 | 2 / 0 | 3.3: every builder fires; C0526 not for an FB's or a PROGRAM's input (`dflt_fb_*`, `dflt_program_*` silent), a FUNCTION's and a METHOD's warn; the arrayBoundNonConst GAPs are recovery cascades (niche, 0 in the corpora) |
| declared-type | referenceAsBaseType, borderOrder, vectorBaseType, variableLengthPlacement, variableLengthNested | 14 / 0 | 14 / 0 | OK |
| constant-initializer | constantNoInitialValue | 1 / 0 | 1 / 0 | OK |
| external-initializer | noInitForExternal | 1 / 0 | 1 / 0 | OK |
| external-global | externalNoGlobal, undefinedIdentifier (via shared/lost-declaration) | 1 / 0 | 1 / 0 | OK |
| input-default (CODESYS) | noDefaultForType | 3 / 0 | — | 3.3: a STRUCT default too, and a METHOD's input as a FUNCTION's (`indf_*`) |
| bit-usage | pointerToBit, bitArrayBase, bitInWrongBlock, bitInWrongContainer | 12 / 0 | 12 / 0 | 3.3: every FB section, FUNCTION, METHOD, PROGRAM (`bitu_*`); CODESYS adds C0203 to an FB's VAR_TEMP; "References to bits" (VAR_IN_OUT) is 3.11's |
| output-rules | outputCantBeReference | 1 / 0 | 1 / 0 | OK |
| non-instantiable | notInstantiable | 1 / 0 | 1 / 0 | OK |
| obsolete-usage | pouObsolete | 9 / 0 | 9 / 0 | 3.3: an obsolete STRUCT as a type and an obsolete FB in an EXTENDS are uses (`obs_*`); no value, no warning |
| at-address° | directAddressMalformed | 7 / 0 | 7 / 0 | OK; frontend P6 parser move, so check whether it survives (0.5) |
| header-rules | propertyWithoutAccessor, multipleInheritance, returnTypeNotAllowed, interfaceImplementsMisused, varInInterface, functionImplements, baseClassNotFound, unionInheritance, inheritanceNotAllowed | 9 / 2 | 9 / 2 | 3.4: C0182 on an FB too (`hdr_fb_return_type`: the parser reads an FB's return type), three bases, an FB PROPERTY with no accessor, VAR_OUTPUT in an implemented interface, two interface bases legal (`hdr_*`); FP cc2_var_in_interface, itf_var_section_declaration (reachability, div); an access modifier on a FUNCTION / PROGRAM niche (`hdr_function_private`, `hdr_program_protected`, 0 in the corpora) |
| attribute-placement (CODESYS) | packModeNotAllowed | 1 / 0 | — | 3.4: on a FUNCTION (CODESYS; TwinCAT builds it), a PROGRAM legal (`attrp_*`) |
| var-section-placement | varConfigOnlyInList, retainNotAllowedHere, sectionNotAllowed | 3 / 0 | 3 / 0 | 3.4: VAR_GLOBAL in an FB / PROGRAM, RETAIN in a FUNCTION's VAR and VAR_INPUT, VAR_CONFIG in a FUNCTION, VAR_OUTPUT RETAIN in an FB legal (`vsp_*`) — all agree |
| inout-initializer | notAssignmentTarget, inoutInInitializer | 1 / 0 | 1 / 0 | 3.4: a VAR_IN_OUT read inside an ARRAY or STRUCT initializer, and an FB instance initialized through its FB's VAR_IN_OUT (`ioinit_*`, `cc5_fb_init_inout`); CODESYS records the aggregate case twice, said once |
| unknown-type | unknownType | 8 / 0 | 40 / 0 | OK |
| system-initializer° | semicolonExpectedInsteadOf, expressionExpectedInsteadOf, cannotConvert, unknownType | — | 2 / 0 | TwinCAT by rule, but in no vendor table → registry note (1.7) |
| refused-initializer | cannotConvert, unknownType | 9 / 0 | 9 / 0 | OK |
| dynamic-creation | dynamicCreationPragma | 2 / 0 | 2 / 0 | OK |
| signature-name | signatureNameMismatch | 4 / 1 | 4 / 1 | 3.4: an ENUM, ALIAS, UNION mismatch (the object read from the document's uri — an alias has no scope), case alone silent (`sn_*`); `sn_dut_mismatch_used` agrees (the replay analyses a fixture's dependencies); FP sn_dut_mismatch (reachability, div) |

### names/

| Check | Messages | cs | tc | Status |
|---|---|---|---|---|
| duplicate-declaration | duplicateMethod, duplicateDeclaration | 2 / 1 | 2 / 1 | 3.5: a name twice in one GVL, named after the list's object; a METHOD and a variable of one name no duplicate (`dupn_*`); two methods / a method and an action of one name are refused by Volt's push (DUPLICATE_CHILD), so `duplicateMethod` is unmeasurable; FP decl_implicit_enum_duplicate (div, the implicit enum's type name) |
| unresolved-identifier | undefinedIdentifier, callTargetExpected, notAMember | 30 / 1 | 75 / 15 | 3.5: a global two lists declare, and a global beside an own enum's member, name nothing (`types/names` `globalClash`: not defined, a hole); FP xf_l*_to_* (div LDATE, re-confirmed), itf_var_section_inherited (div, the vendor stops) |
| ambiguous-global | ambiguousGlobalName | 0 | 0 | 3.5: two lists, bare, in every position (`ambg_*`, legal when qualified or shadowed); a global beside an own enum's member (EN5); CODESYS warns a bare name that is both a variable and a METHOD of its POU (`dupn_method_named_as_variable`) |
| type-as-value | typeNameNotExpected | 1 / 0 | 1 / 0 | 3.5: an ALIAS's name (no hole beside it), and a type's name as an operand or a condition (`tav_*`); the vendors' further conversions of the type there are niche (0 in the corpora) |
| reserved-keyword (CODESYS) | reservedKeyword | 2 / 0 | — | 3.5: a STRUCT field and a METHOD's input (`rkw_*`); a global of the name cannot be a fixture (every fixture using the word as a local would depend on it) |
| refused-name° | unexpectedToken, expressionExpectedInsteadOf, semicolonExpectedInsteadOf, codeHasNoEffect | 23 / 0 (347 diags) | 23 / 0 | gone (frontend-conformance, 0.5); 3.5: no census row, no FP |
| conditional-call° | parenExpectedInsteadOf, notSupportedInDeclaration, conditionalCallSecondParameter, expressionExpectedInsteadOf | 5 / 0 | 5 / 0 | 3.5: 0 FP; its 2 CODESYS GAPs (`notSupportedInDeclaration` in a declaration's `{IF}`) are the niche PRAGMA_DIVERGENCES |

### oop/

| Check | Messages | cs | tc | Status |
|---|---|---|---|---|
| inheritance | circularInheritance, baseClassNotFound, unknownType, interfaceNotFound | 3 / 0 | 3 / 0 | 3.6: EXTENDS an INTERFACE / STRUCT is no base found (alone), IMPLEMENTS a STRUCT no interface (`oopa_*`) |
| property-access | propertyLacksGetter | 2 / 0 | 2 / 0 | 3.6: a set-only property in a condition and as an argument; a get-only property written is no valid assignment target |
| method-reference | cannotConvert | 1 / 0 | 1 / 0 | 3.6: as an operand both vendors type the method as a type ('VALUE') — deferred, niche (`oopa_method_ref_in_operand`) |
| inherited-variable | duplicateInheritedVariable | 1 / 0 | 1 / 0 | 3.6: a grandparent's variable, a base's VAR_INPUT redeclared as a VAR — agree |
| external-write | noInput | 15 / 0 | 15 / 0 | 3.6: a VAR_OUTPUT is not writable from outside; a VAR_TEMP is no input of '__MAIN'; a VAR read from outside builds |
| inout-access (external + own) | inoutNoExternalAccess, inoutOwnAccess | 10 / 0 | 10 / 0 | 3.6: an initializer is an access — an FB instance's VAR_IN_OUT field from the declaring FB, an aggregate reading the own VAR_IN_OUT from 'FB_INIT'; a read alone, a property GET |
| fb-init-inout | noInput (was fbInitNoOutput) | 1 / 0 | 1 / 0 | 3.6: the value binds the parameter's REFERENCE — another type is "Cannot convert … to type 'REFERENCE TO T'" (TwinCAT reversed; `shared/reference-bind`) |
| fb-init-instantiation | fbInitInstantiation, fbInitArrayCount | 1 / 0 | 1 / 0 | 3.6: a wrong argument count is the same message; an ARRAY with no initializers counts them (not `ARRAY OF FB(args)`) |
| generic-instantiation | genericCount | 4 / 0 | — | CODESYS by rule, but in no vendor table → registry note |
| abstract-assign (CODESYS) | abstractAssignTarget | 1 / 0 | — | OK |
| lifecycle | fbReInitShape, lifecycle | 3 / 0 | 3 / 0 | OK |
| abstract-instantiation | abstractInstantiation | 2 / 0 | 2 / 0 | OK; no colocated test (A6, 1.14) |
| interface-implementation | missingInterfaceImpl | 1 / 0 | 1 / 0 | OK |
| method-signature | overrideMismatchInterface, overrideMismatchBase | 0 | 0 | **GAP: no fixture** |
| abstract-output-default (CODESYS) | defaultOutputUnused | 1 / 0 | — | OK |

### calls/

| Check | Messages | cs | tc | Status |
|---|---|---|---|---|
| call-arguments | inputAssignmentMissing, functionRequiresInputs, unknownNamedOutput, unknownNamedArgument, functionRequiresInputRange, inOutMustBeAssigned, inOutNeedsWritable, inOutConstantNeedsVariable, inOutTypeMismatch, cannotConvert, signChange | 44 / 0 | 44 / 1 | FP tc lex_vector_twincat_return_type (div); builders GAP (0.3) |
| call-result-access° | semicolonExpectedInsteadOf, codeHasNoEffect, callResultAccess | 2 / 0 | 2 / 0 | frontend 2.5.4; reviewed in 3.8 |
| fb-instantiation | fbMustBeInstantiated, interfaceMustBeInstantiated, cannotCallObjectOfType | 2 / 0 | 2 / 0 | OK |
| intrinsic-operands | 14 builders (operatorNeedsExactly … queryInterfaceSecond) | 25 / 0 | 25 / 0 | builders GAP (0.3) |
| non-callable-call | cannotCallType, callTargetExpected | 5 / 0 | 5 / 0 | OK |
| recursive-call | callTargetExpected | 1 / 0 | 1 / 0 | OK |

### flow/

| Check | Messages | cs | tc | Status |
|---|---|---|---|---|
| case-labels | caseLabelNonConst, cannotConvert, caseRangeInverted, caseLabelDuplicate, caseLabelInRange, caseOverlappingRanges | 1 / 0 | 0 | 5 of 6 builders **GAP** |
| statement-rules | notAssignmentTarget, multipleAssignmentNew, noEnclosingLoop | 3 / 0 | 3 / 0 | OK |
| new-in-expression (CODESYS) | newInExpression | 1 / 1 | — | div cc5_new_in_expression (rule unmeasured on CODESYS) |
| jump-labels | jumpLabelDuplicate, jumpLabelUndefined, jumpInvalidDestination, jumpLabelUnreferenced | 1 / 0 | 1 / 0 | 2 builders GAP |
| no-op-statement | codeHasNoEffect | 16 / 1 | 16 / 1 | FP lit_time_fraction_ms |
| empty-block | emptyStatementBlock | 1 / 0 | 1 / 0 | OK |
| loop-exit | loopExitConstantFalse | 2 / 1 | 2 / 1 | FP cc6_loop_cannot_exit |
| this-super-context | superWithoutBase, thisNotAllowed, superNotAllowed | 5 / 0 | 5 / 0 | OK |

### pragmas/, syntax/, network/

| Check | Messages | cs | tc | Status |
|---|---|---|---|---|
| pragmas | abstractKeywordMissing, attributeValueString, unterminatedConditional, invalidSymbolAttributeValue, invalidAttributeValue, unknownAttribute, orphanPragma, message pragmas | 27 / 0 | 5 / 0 | builders GAP (0.3) |
| parse-errors | unexpectedToken, directAddressExpectedAt, operatorNeedsAtLeast, operatorNeedsExactly, varConfigOnlyInList, sectionNotAllowed, + the templates 1.11 moves into `messages.ts` (named builders, so the census can attribute them) | 474 / 20 | 547 / 117 | all front-end recovery: re-measure after frontend archive |
| network-text (seam only) | undefinedIdentifier, notAMember, unresolvedOperand, unresolvedOperandToken, unresolvedAssignTarget, jumpLabel*, rules.* | 14 / 0 | 14 / 0 | not reviewed (P6); census rows kept so 5.3 hands the numbers off |

**Measured (tasks 0.1–0.3, 2026-10-06; the rows above are the 2026-10-01 scratch census, kept as the design's
starting shape).** `test/analysis/diagnostic-census.test.ts` over 4,768 CODESYS and 4,757 TwinCAT recorded fixtures (every fixture the
replay compares, the 139 per vendor whose code sits only in PLC_PRG among them; the replay's composition, network text
ON). Every FP but one is on a fixture the replay already pins (open FP: 1 CODESYS, 0 TwinCAT), so the FP column below is
the divergence backlog. The one open FP: `refdecl_target_undeclared` — the LSP gives `Cannot convert type 'Unknown type:
'nope'' to type 'REFERENCE TO INT'` twice where CODESYS recorded it once; the replay compares as a set, so it sees that
fixture only as a disagreement, the census as a multiset. GAP counts only the IDE-only messages whose builder ONE check
can emit, resolved through the helpers that call a builder for several checks (`rules.ts` `conversionWarning`,
`storeConversionError`, …): 293 CODESYS / 566 TwinCAT more sit on a builder several checks share, 70 / 115 are
unowned. The registry has
changed since the rows above: `unsupported-operator`, `partial-access`, `refused-name` and `system-initializer` are gone
(frontend-conformance), `constant-cycle` is new. `—`: the registry does not run the check for that vendor.

| group | check | cs fired / TP / SEV / FP / GAP | tc fired / TP / SEV / FP / GAP |
|---|---|---|---|
| types | checkAssignmentTypes | 463 / 709 / 0 / 3 / 0 | 445 / 688 / 0 / 2 / 0 |
| types | checkNarrowingConversion | 272 / 411 / 0 / 0 / 0 | 281 / 360 / 0 / 1 / 0 |
| types | checkBinaryOperators | 31 / 41 / 0 / 0 / 0 | 31 / 39 / 0 / 0 / 0 |
| types | checkConversionCalls | 3 / 3 / 0 / 0 / 0 | 3 / 3 / 0 / 0 / 0 |
| types | checkDeref | 3 / 3 / 0 / 0 / 0 | 3 / 3 / 0 / 0 / 0 |
| types | checkSubrange | 7 / 8 / 0 / 0 / 0 | 7 / 8 / 0 / 0 / 0 |
| types | checkArrayBounds | 42 / 42 / 0 / 0 / 3 | 42 / 41 / 0 / 1 / 2 |
| types | checkConstantOverflow | 19 / 19 / 0 / 0 / 0 | 19 / 19 / 0 / 0 / 0 |
| types | checkBitNumber | 3 / 3 / 0 / 0 / 0 | 3 / 3 / 0 / 0 / 0 |
| types | checkIndexing | 4 / 7 / 0 / 0 / 0 | 4 / 6 / 0 / 1 / 3 |
| types | checkComparison | 6 / 10 / 0 / 0 / 1 | 6 / 10 / 0 / 0 / 0 |
| types | checkArrayInit | 2 / 1 / 0 / 1 / 0 | 2 / 2 / 0 / 0 / 0 |
| types | checkStructInit | 6 / 16 / 0 / 0 / 0 | 6 / 16 / 0 / 0 / 0 |
| types | checkPointerConversion | 11 / 0 / 19 / 0 / 0 | 11 / 0 / 19 / 0 / 0 |
| types | checkStringConstant | 42 / 78 / 0 / 3 / 0 | 33 / 37 / 0 / 2 / 0 |
| types | checkReferenceAssign | 10 / 15 / 0 / 0 / 0 | 10 / 15 / 0 / 0 / 0 |
| types | checkDataRecursion | 2 / 2 / 0 / 0 / 0 | 2 / 2 / 0 / 0 / 0 |
| types | checkEnumInit | 1 / 2 / 0 / 0 / 3 | 1 / 2 / 0 / 0 / 1 |
| types | checkUnaryOperand | 19 / 20 / 0 / 0 / 0 | 19 / 20 / 0 / 0 / 0 |
| types | checkTypedLiteral | 18 / 18 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| types | checkUnknownSource | 102 / 119 / 0 / 10 / 0 | 257 / 275 / 0 / 24 / 0 |
| declarations | checkConstantContext | 3 / 3 / 0 / 0 / 2 | 3 / 3 / 0 / 0 / 3 |
| declarations | checkDeclaredType | 15 / 15 / 0 / 0 / 0 | 15 / 15 / 0 / 0 / 0 |
| declarations | checkConstantInitializer | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 0 |
| declarations | checkConstantCycle | 3 / 4 / 0 / 0 / 1 | — |
| declarations | checkExternalInitializer | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 0 |
| declarations | checkExternalGlobal | 2 / 3 / 0 / 0 / 2 | 2 / 3 / 0 / 0 / 1 |
| declarations | checkInputDefault | 1 / 1 / 0 / 0 / 0 | — |
| declarations | checkBitUsage | 6 / 6 / 0 / 0 / 0 | 6 / 6 / 0 / 0 / 0 |
| declarations | checkOutputRules | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 0 |
| declarations | checkNonInstantiable | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 0 |
| declarations | checkObsoleteUsage | 7 / 12 / 0 / 0 / 0 | 7 / 12 / 0 / 0 / 0 |
| declarations | checkAtAddress | 7 / 7 / 0 / 0 / 0 | 7 / 7 / 0 / 0 / 0 |
| declarations | checkHeaderRules | 31 / 34 / 0 / 2 / 4 | 26 / 29 / 0 / 2 / 4 |
| declarations | checkAttributePlacement | 1 / 1 / 0 / 0 / 0 | — |
| declarations | checkVarSectionPlacement | 3 / 4 / 0 / 0 / 0 | 3 / 4 / 0 / 0 / 0 |
| declarations | checkInoutInitializer | 1 / 2 / 0 / 0 / 1 | 1 / 2 / 0 / 0 / 1 |
| declarations | checkUnknownType | 15 / 15 / 0 / 0 / 0 | 152 / 177 / 0 / 0 / 0 |
| declarations | checkRefusedInitializer | 13 / 15 / 0 / 0 / 0 | 67 / 71 / 0 / 0 / 0 |
| declarations | checkDynamicCreation | 2 / 2 / 0 / 0 / 0 | 2 / 2 / 0 / 0 / 0 |
| declarations | checkSignatureName | 4 / 3 / 0 / 1 / 9 | 4 / 3 / 0 / 1 / 9 |
| names | checkDuplicateDeclarations | 9 / 8 / 0 / 1 / 1 | 9 / 8 / 0 / 1 / 1 |
| names | checkUnresolvedIdentifiers | 76 / 92 / 0 / 7 / 0 | 244 / 415 / 0 / 27 / 0 |
| names | checkAmbiguousGlobal | 10 / 9 / 0 / 1 / 7 | 10 / 9 / 0 / 1 / 3 |
| names | checkTypeAsValue | 5 / 6 / 0 / 0 / 0 | 5 / 6 / 0 / 0 / 0 |
| names | checkReservedKeyword | 2 / 3 / 0 / 0 / 0 | — |
| names | checkConditionalCall | 5 / 14 / 0 / 0 / 2 | 5 / 14 / 0 / 0 / 0 |
| oop | checkInheritance | 12 / 19 / 0 / 0 / 0 | 12 / 13 / 0 / 0 / 0 |
| oop | checkPropertyAccess | 2 / 2 / 0 / 0 / 0 | 2 / 2 / 0 / 0 / 0 |
| oop | checkMethodReference | 2 / 3 / 0 / 0 / 0 | 2 / 3 / 0 / 0 / 0 |
| oop | checkInheritedVariable | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 0 |
| oop | checkExternalNonInputWrite | 17 / 19 / 0 / 0 / 0 | 17 / 19 / 0 / 0 / 0 |
| oop | checkInoutExternalAccess | 1 / 4 / 0 / 0 / 0 | 1 / 4 / 0 / 0 / 0 |
| oop | checkInoutOwnAccess | 10 / 19 / 0 / 0 / 0 | 10 / 10 / 0 / 0 / 0 |
| oop | checkFbInitInout | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 0 |
| oop | checkFbInitInstantiation | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 1 |
| oop | checkGenericInstantiation | 4 / 4 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| oop | checkAbstractAssign | 1 / 1 / 0 / 0 / 0 | — |
| oop | checkLifecycleSignatures | 3 / 3 / 0 / 0 / 0 | 2 / 2 / 0 / 0 / 0 |
| oop | checkAbstractInstantiation | 2 / 3 / 0 / 0 / 0 | 2 / 3 / 0 / 0 / 0 |
| oop | checkInterfaceImplementations | 3 / 3 / 0 / 0 / 1 | 3 / 3 / 0 / 0 / 1 |
| oop | checkMethodSignatures | 12 / 19 / 0 / 0 / 6 | 12 / 17 / 0 / 0 / 0 |
| oop | checkAbstractOutputDefault | 1 / 1 / 0 / 0 / 0 | — |
| calls | checkCallArguments | 68 / 95 / 0 / 0 / 4 | 67 / 92 / 0 / 1 / 4 |
| calls | checkCallResultAccess | 3 / 3 / 0 / 0 / 0 | 3 / 3 / 0 / 0 / 0 |
| calls | checkRecursiveCall | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 0 |
| calls | checkNonCallableCall | 9 / 10 / 0 / 0 / 0 | 6 / 7 / 0 / 0 / 0 |
| calls | checkIntrinsicOperands | 28 / 30 / 0 / 0 / 2 | 22 / 25 / 0 / 0 / 2 |
| calls | checkFbInstantiation | 6 / 8 / 0 / 0 / 1 | 6 / 8 / 0 / 0 / 1 |
| flow | checkCaseLabels | 7 / 7 / 0 / 0 / 0 | 6 / 6 / 0 / 0 / 0 |
| flow | checkStatementRules | 15 / 16 / 0 / 0 / 0 | 14 / 15 / 0 / 0 / 0 |
| flow | checkNewInExpression | 1 / 0 / 0 / 1 / 0 | — |
| flow | checkJumpLabels | 8 / 9 / 0 / 4 / 0 | 17 / 9 / 0 / 23 / 0 |
| flow | checkNoOpStatement | 148 / 178 / 0 / 4 / 10 | 156 / 185 / 0 / 7 / 16 |
| flow | checkEmptyBlock | 8 / 10 / 0 / 0 / 0 | 8 / 9 / 0 / 0 / 1 |
| flow | checkLoopExit | 1 / 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 0 |
| flow | checkThisSuperContext | 9 / 13 / 0 / 0 / 0 | 9 / 12 / 0 / 0 / 0 |
| pragmas | checkPragmas | 37 / 38 / 0 / 0 / 0 | 4 / 3 / 0 / 1 / 0 |
| syntax | checkParseErrors | 793 / 2893 / 0 / 70 / 33 | 920 / 3629 / 0 / 240 / 70 |
| network | network-text | 17 / 24 / 0 / 0 / 3 | 15 / 22 / 0 / 0 / 2 |

**Checks firing on no fixture: 0** — `loop-exit` fires on one PLC_PRG fixture per vendor (its builder
`loopExitConstantFalse` has 1 TP each). bit-usage, obsolete-usage, ambiguous-global and method-signature, the four the
scratch census listed, all fire now (6 / 7 / 10 / 12 CODESYS fixtures). Builders with 0 TP: 21 on CODESYS, 43 on TwinCAT,
19 of them on both (`test/analysis/baselines/coverage.json`, written under task 0.3; `semicolonExpectedInsteadOf` is called by no
check at all since frontend-conformance moved its callers into the parser).

**Out of census: server policy.** These are LSP-emitted findings outside the registry, so the fixture census (which runs
`runRegistry`) never sees them: missing language (`missingLanguage`, the push's `StReader.Unmarked` wording), retired
comments (`reportRetiredComments`), `libraryManifestDiagnostics`, and the suppressions (library-file gate, dead POU/member,
unstated bodies, other materialization). The corpus census runs the server's path, so they appear there as rows keyed
`server:<code>`; they are reviewed only if a corpus shows one as FP.

**Unowned gaps.** These are IDE messages no builder produces: 289 CODESYS / 441 TwinCAT. Most are parser wording
(`_ expected instead of _`, `Unexpected token`, `Type definition expected`), which frontend-conformance owns, and project
configuration (`No memory for dynamic object creation`). Task 0.2 classifies each shape as owned-by-frontend /
project-config / missing-rule, and 3.11 triages the missing-rule ones by the niche rule.

---

## 6. Measure plan

**Census — `test/analysis/diagnostic-census.test.ts`** (new concern, listed in `test/README.md` and `TESTING.md` in
the commit that creates it), builder `test/analysis/census.ts`, baselines in `test/analysis/baselines/`.

`test/frontend/baseline.ts` gains a directory parameter (default: its own `baselines/`), so the discipline, the ceilings
and `baseline.test.ts`'s history check are shared, not copied. Two requirements on that refactor:

- the front-end baselines (`test/frontend/baselines/*.json`) stay byte-identical;
- `baseline.test.ts`'s history check runs over BOTH ceilings files (`test/frontend/baselines/ceilings.json` and
  `test/analysis/baselines/ceilings.json`), and its error texts name the file they read instead of a hard-coded
  `baselines/ceilings.json`.

For each conformance fixture × vendor (both vendors' build recordings), with network text ON (the test preload):

- **Composition.** Use the conformance composition: the fixture plus PLC_PRG on the shared project, which after 2.6 is
  `computeDiagnostics`. Run `runRegistry` with an `onCheck` hook that attributes each finding to the check that emitted
  it (its slice of `out`). The order contract is untouched.
- **Builder attribution.** `messagesFor(vendor)` is wrapped in a counting Proxy, so each finding is also attributed to
  the builder that produced it.
- **Matching.** Compare against the recorded build with the fixture contract's own normalizer
  (`support/compare-message.ts`), as a multiset.
  - TP: an LSP finding with a matching recorded message.
  - FP: LSP-only, attributed to (check, builder).
  - GAP: IDE-only. A gap is attributed to the builder whose normalized shape (quoted parts → `…`) matches, and to its
    check. Otherwise it goes to `unowned:<shape>`.
  - SEV: the message matches but the severity differs.
- **Divergences.** `KNOWN_DIVERGENCES` and the triage sets are a column (`div`). They are not subtracted silently:
  `open = FP − div`.
- **Registry ↔ rows.** The census test fails if a registry entry has no row or a row has no registry entry (this is the
  gate the human catalogue §5 does not have).

**Corpora — `test/analysis/corpus-census`**, inside the same test file and one walk. This reuses
`test/corpus/support/diagnostics.ts` `projectDocuments` (the server's function), compared against each project's
recorded build (5 CODESYS, 1 TwinCAT). Findings are attributed by (code, shape), since the server path has no trace;
server-policy findings are `server:<code>` rows. FP and GAP are counted per project and per code.

**Baselines (committed):**

- `fixtures.codesys.json` and `fixtures.twincat.json`: counts per check and per builder (fired, TP, FP, div, GAP, SEV),
  plus findings lines `vendor fixture check builder FP|GAP message`.
- `corpus.json`: per project, per code.
- `coverage.json`: builders with 0 TP on either vendor (the catalogue's GAP list), and registry checks firing on 0
  fixtures.
- `ceilings.json`: per vendor, totals and per group — open FP, GAP, unowned GAP, never-fired builders. These may only
  fall. The writer refuses a rise; `baseline.test.ts` fails a ceilings file that rose against git history.

**Seam measures — task 0.4.** These are numbers written under the task, not baselines:

- whether raw `parseResult.errors` ⊆ `checkParseErrors`, on corpora and fixtures;
- the count of duplicate parse errors the server emits on the corpora;
- network findings whose code is configurable, per corpus project, and how many the project's settings would turn off;
- the four compositions' outputs diffed per fixture;
- `parseNetworkText` calls per edit and time over the corpus graphical bodies, against one `documentDiagnostics` pass;
- both directions of a shared `out`: which network codes are in hole's RESOLUTION_FAILURE / REFUSED_OUTRIGHT sets, and
  which ST findings the network hole pass would see (both are expected 0 effect with "network last + local slice");
- the cost of running the registry restricted to `["syntax"]` on dead POUs versus today's skip (expected ≈ equal).

**Snapshot A (output neutrality).** `scripts/frontend-snapshot.ts` gets one more aspect, `fixture-diagnostics`: every
`DiagnosticItem` (code, severity, span, message) per fixture × vendor from the conformance composition, network text ON.
It sits next to its existing corpus `diagnostics` aspect, and `check --aspects diagnostics,fixture-diagnostics` is
snapshot **A**. It is compared against the parent commit with the same worktree machinery, so there is no second snapshot
tool. An `N` task prints the A diff and lists every changed class. A covers diagnostics only; services routing is covered
by 2.2's named routing tests.

---

## 7. What this change does not do

- Network text's parser, AST, exprs, wire model, the `NetworkTextAnalysis` fields and the bodies of the network checks.
  That includes the duplicate jump-label rule, the `NETWORK_*` code spelling, `Cnnnn` entries for network codes and the
  `.vg` field name, all handed off in 5.3.
- Any P6/P7 move frontend-conformance owns, beyond placing what it left (0.5).
- `messages.ts` is not split. One file is the one home for wording, ordered by group.
- Services or server behaviour beyond routing and the diagnostics merge.
- Folder moves `lsp-package-structure` will make (`network-text/` → `frontend/syntax/network/`, network checks'
  final home, what is left of `network/`). The homes chosen here are already the ones that change names:
  `analysis/checks/network/`.

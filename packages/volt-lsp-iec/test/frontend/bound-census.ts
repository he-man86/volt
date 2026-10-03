/**
 * ONE WALK OF EVERYTHING BOUND, EVERY BOUND QUESTION ASKED OF IT — the measurements behind 0.3 (resolution) and 0.4
 * (types, folds), computed once per process and read by `resolution-dump.test.ts`, `type-dump.test.ts` and
 * `fold-dump.test.ts` (test/README.md: one walk per input).
 *
 * Each group is summarized as counts, and what a recording can decide is cross-checked against it:
 *
 *   types   a build message that names a type — "Cannot convert type 'X' to type 'Y'", the two sign-change
 *           warnings, the loss-of-information warning — is explained by a store (an assignment, an initializer, a call
 *           argument, an operand) whose target the front-end types Y and whose value it types X, each store explaining
 *           ONE copy of a message (the recordings carry no position, so the count is all there is to hold); the other
 *           way, every store the front-end types as not implicitly convertible (`classifyConversion` "incompatible")
 *           must be matched by a recorded "Cannot convert" for it; and every path a CODESYS run recorded, read as an
 *           expression in PLC_PRG, must infer the type its value is printed as;
 *   folds   a variable a run recorded that no body of its fixture names still holds its initializer, so when that
 *           initializer reads nothing the init step runs (`readsRuntime`, asked of the AST and name resolution — never of
 *           the fold under test) the value the declaration holds (`declaredValue`: the
 *           fold stored into the declared type — wrapped to its width, a string cut at its capacity) must equal the
 *           recorded value — every recorded value this cannot be asked of is counted by why, so the values the check sees
 *           plus the ones it does not add up to every recorded value. An initializer that reads a variable or calls a
 *           user function is run by the init step, not folded: no constant to ask (frontend-conformance 4.6.1).
 *
 * Fixtures are bound and measured once per vendor, each against that vendor's build recording; the run recording is
 * CODESYS's alone, so the run cross-checks (types and folds) are CODESYS-bound.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  allUnits,
  decodeStringLiteral,
  isStBody,
  lex,
  isTrivia,
  parseExprFromTokens,
  bodyStatements,
  unitBodies,
  walkStatements,
  walkExpr,
  exprText,
  type Expr,
  type TopLevel,
} from "../../src/frontend/syntax/index.js"
import { bodyConditionWorld, gvlBlockOf, lookup, lookupLocal, lookupMember, rootOf, scopeForUnit, targetOf, type Scope, type Symbol } from "../../src/frontend/symbols/index.js"
import {
  checkedMeetType,
  classifyConversion,
  constEval,
  declaredValue,
  elementaryRef,
  elementaryType,
  elementaryTypeRef,
  atomicOperand,
  integerOfWidth,
  operandConversion,
  resolveNamedType,
  inferExprType,
  isIntegerType,
  isSfcStepBase,
  operandFamilyRule,
  parseConversionName,
  unaryOperandConversion,
  durationScaleConversion,
  literalCheckType,
  literalErrorType,
  renderType,
  resolveBareName,
  resolveCallee,
  resolveMemberChain,
  resolveTypeExpr,
  isElementaryTypeName,
  negativeLiteralComparisonTarget,
  selectionValueArguments,
  SHORT_CIRCUIT_OPERATORS,
  strictEnum,
  temporalArithmeticType,
  UNKNOWN,
  type Type,
} from "../../src/frontend/types/index.js"
import { tally } from "./baseline.js"

/** Every kind of `Expr`, for the UNKNOWN counts (`summarize`). */
const EXPR_KINDS: readonly Expr["kind"][] = [
  "ident_expr", "literal", "binary", "unary", "member", "index", "deref", "call", "paren", "assign_expr", "global_expr",
]
import { boundCorpus, boundLibrary, withBoundFixture } from "./bound.js"
import { KNOWN_DIVERGENCES } from "../conformance/support/divergences.js"
import { at, foldDump, refusedIn, resolutionDump, sites, typeRows, undecidedExprCount, unparsedIn, valueChildren, valueExprs, type Bound } from "./dumps.js"
import { corpusProjects, fixtureSources, isLibraryManagerFile, unanswered, type FixtureSources } from "./sources.js"
import { compilerTypeText, type Dialect, type TypeExpr } from "../../src/frontend/syntax/index.js"
import { compilerExprText } from "../../src/analysis/expr-echo.js"
import { bareConversionArgument } from "../../src/analysis/hole.js"
import { isStructInit, structEcho } from "../../src/analysis/checks/types/struct-init.js"
import { initializerWarnedTwice, messagesFor, stringLiteralMessageType } from "../../src/analysis/index.js"

export interface BoundCensus {
  resolution: Record<string, number>
  /** Every fixture occurrence that binds to nothing — few enough to pin one by one. */
  fixtureUnresolved: string[]
  types: Record<string, number>
  typeDisagreements: string[]
  folds: Record<string, number>
  foldDisagreements: string[]
}

const RUN = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "conformance", "recordings", "codesys.run.json"), "utf8"),
).tests as Record<string, { values?: Record<string, string> }>

let cached: BoundCensus | undefined

export function boundCensus(): BoundCensus {
  if (cached !== undefined) return cached
  const c: BoundCensus = {
    resolution: {},
    fixtureUnresolved: [],
    // the run paths inferred UNKNOWN are measured at 0 too, so a ceiling that reached 0 stays pinned there (frontend-
    // conformance 3.2: the inherited-member class closed at 41 → 0, the rest 2 → 0)
    types: { "run: path inferred UNKNOWN": 0, [INHERITED_THROUGH_INSTANCE]: 0 },
    typeDisagreements: [],
    // measured at 0 too, so the ceiling that reached 0 stays pinned there (frontend-conformance 4.6.1: 33 → 0)
    folds: { "run: initializer does not fold": 0 },
    foldDisagreements: [],
  }
  /**
   * `vendor` — a fixture's, measured against that vendor's build: `known` when `support/divergences.ts` already pins the
   * fixture as disagreeing with that build (the suite replays it as an expected failure and fails the day it agrees), so
   * its resolution and types are held there, once, and only counted here; `notDefined`, the names that build reports
   * "Identifier 'x' not defined" — a bare name that binds to NONE, or is typed UNKNOWN, there AGREES with the oracle
   * (0.3 asks whether the LSP says "not defined" exactly where the vendor does), so it is counted, not a finding;
   * `unknownTypes`, every text that build names "Unknown type: '<text>'" (alone or inside a "Cannot convert") — an
   * expression typed UNKNOWN whose compiler echo is one of them is untyped on the vendor too: the build says so of THAT
   * expression (`ABS(%M?0.1)`, `(INT#0 - E#V)`, frontend-conformance 2.2b), so it is counted, not an UNKNOWN.
   */
  const summarize = (
    group: string,
    b: Bound,
    pin: string | undefined,
    vendor: {
      known: boolean
      notDefined: ReadonlySet<string>
      noComponent: ReadonlySet<string>
      unknownTypes: ReadonlySet<string>
      /** every message the vendor recorded, lower case; undefined when it recorded no build (`dumps.ts` `unparsedIn`) */
      says: ReadonlySet<string> | undefined
    } = {
      known: false,
      notDefined: new Set(),
      noComponent: new Set(),
      unknownTypes: new Set(),
      says: new Set(),
    },
  ): void => {
    // an expression kind whose UNKNOWNs all came to be typed is a count of 0, not a measure gone missing — its ceiling
    // must still be able to say so (`assign_expr`, typed by its target since frontend-conformance 2.5.6)
    for (const kind of EXPR_KINDS) c.types[`${group}: ${kind} UNKNOWN`] ??= 0
    c.types[`${group}: unary UNKNOWN, a signed untyped number (context-typed, as a literal)`] ??= 0
    // …and a name shape whose NONEs all came to resolve, the same way (`fixtures codesys: bare name NONE` 5 → 0: the five
    // were names in a conditional branch CODESYS does not compile, which the one statement tree no longer holds —
    // frontend-conformance 2.7.1)
    for (const shape of ["bare name", "member"]) c.resolution[`${group}: ${shape} NONE`] ??= 0
    // …and a named argument's: every NO-CALLEE and NONE of the fixtures came to resolve or agree (frontend-conformance 3.6)
    if (group.startsWith("fixtures ")) {
      c.resolution[`${group}: parameter NONE`] ??= 0
      c.resolution[`${group}: parameter NO-CALLEE`] ??= 0
    }
    if (vendor.known) {
      tally(c.resolution, `${group}: files of a known divergence (support/divergences.ts), not measured`)
      tally(c.types, `${group}: files of a known divergence (support/divergences.ts), not measured`)
    }
    const agreed = new Set<string>()
    const refused = refusedIn(b.parsed.parseResult)
    // Where a bare name stands inside a REFUSED expression — the statement the parser resumed at after a refused token
    // (`NS;` in `t := T#5NS;`, `ExprStatement.resumed`) holds the vendor's error at its own name. Neither side resolves
    // it: the vendor resolves nothing in a body it could not parse and says only "no effect", the LSP analyses no such
    // body. So NONE there is no disagreement to ask 0.3 about — counted, as 0.4 counts it untyped (frontend-conformance 2.2).
    const refusedNames = new Set<string>()
    // …and every name in a BODY THAT DID NOT PARSE (`dumps.ts` `unparsedIn`): the vendor resolves nothing there, an
    // undefined name beside the refusal included (`expr_member_named_keyword_beside_undefined`, frontend-conformance 2.5)
    const unparsed = unparsedIn(b.parsed.parseResult, vendor.says)
    const unparsedSites = new Set<string>()
    if (!vendor.known)
      for (const { expr, line } of typeRows(b)) {
        const where = line.slice(0, line.indexOf(" "))
        if (expr.kind === "ident_expr" && refused(expr)) refusedNames.add(where)
        if (unparsed(expr)) {
          unparsedSites.add(where)
          // the dump keys a `.name` by its NAME, one column after the `.` its row starts at (`resolutionDump`)
          if (expr.kind === "global_expr") unparsedSites.add(at(expr.name.span))
          // …and a member by its MEMBER name, where its row is (`__CURRENTTASK^.szName` in a body neither side parses,
          // `sysop_currenttask_deref_member` — the row read `.szName -> NONE` as a finding, frontend-conformance 3.6)
          if (expr.kind === "member") unparsedSites.add(at(expr.member.span))
        }
      }
    // A member read off a name the vendor reports undefined (`Gvl.accD` with `Gvl` "not defined",
    // `decl_var_access_used`) starts where its root does, as 0.4 already counts it. The root is the AST's
    // (`memberShapes`), never the dump's previous line: a call's arguments and an index's subscripts are written between a
    // member and its base, so `arr[undefIdx].nope`'s `.nope` follows `undefIdx` and belongs to `arr`.
    const shapes = memberShapes(sites(b).map((s) => s.expr))
    const bases = memberBases(b)
    // …and a member whose chain stands on an INTEGER where the vendor refuses a bit access — `gw.GVL.cBit`, a bit numbered by
    // a list-qualified constant, is "Bit access requires literal or symbolic integer constant" (`sfc_step_bit_const_qualified`,
    // lsp-sfc-step-names gate 2): no component of the integer, and no type, on either side
    const bitRefusedSites = new Set<string>()
    if (!vendor.known && vendor.says?.has("bit access requires literal or symbolic integer constant") === true)
      for (const { expr, scope } of typeRows(b)) {
        if (expr.kind !== "member" || scope === undefined) continue
        let root: Expr = expr.base
        while (root.kind === "member") root = root.base
        const t = inferExprType(root, scope, b.project)
        if (t.kind === "elementary" && isIntegerType(t.name)) bitRefusedSites.add(at(expr.member.span))
      }
    const lines = vendor.known
      ? []
      : resolutionDump(b).map((line) => {
          const [lhs, binding] = line.split(" -> ") as [string, string]
          const where = lhs.slice(0, lhs.indexOf(" "))
          const name = lhs.slice(lhs.indexOf(" ") + 1)
          const shape = name.startsWith("(global) ")
            ? "global name"
            : name.startsWith(".")
              ? "member"
              : / (:=|=>)$/.test(name)
                ? "parameter"
                : "bare name"
          // `NONE ambiguous: …` is a NONE (`dumps.ts` `bareWord`, rule EN3)
          const verdict = binding === "NONE" || binding.startsWith("NONE ") ? "NONE" : binding === "NOSCOPE" || binding === "NO-CALLEE" ? binding : "resolved"
          return { line, where, name, shape, verdict }
        })
    for (const { where, name, shape, verdict } of lines)
      if (verdict === "NONE" && (shape === "bare name" || shape === "global name") && vendor.notDefined.has(name.toLowerCase()))
        agreed.add(where)
    // the members the vendor reports no component of their base, by the member's site: no type on either side (0.4 below)
    const noComponentSites = new Set<string>()
    // a named argument's PARAMETER the callee does not declare is looked up as a name and not found, on the vendor too:
    // `itfRef.M(zz := 5)` is "Identifier 'zz' not defined" (`inh_interface_method_unknown_param`, frontend-conformance 3.6)
    const parameterName = (name: string): string => name.replace(/ (:=|=>)$/, "").toLowerCase()
    for (const { where, name, shape, verdict } of lines)
      if (verdict === "NONE" && shape === "parameter" && vendor.notDefined.has(parameterName(name))) agreed.add(where)
    for (const { line, where, name, shape, verdict } of lines) {
      if (verdict === "NONE" && unparsedSites.has(where)) {
        tally(c.resolution, `${group}: ${shape} NONE, in a body that did not parse`)
        continue
      }
      // a member the vendor reports no component of THIS base — "'GET' is no component of 'DUT_LANG_…'" naming the base's
      // type, "'END_IF' is no component of 'bx'" the base as written (`expr_member_named_*`, frontend-conformance 2.5) —
      // is unknown on both sides. Keyed by member AND base: the same member name off another base is no agreement.
      if (
        verdict === "NONE" &&
        shape === "member" &&
        (bases.get(where) ?? []).some((base) => vendor.noComponent.has(`${name.slice(1).toLowerCase()}|${base}`))
      ) {
        tally(c.resolution, `${group}: member NONE, no component on the vendor too`)
        noComponentSites.add(where)
        continue
      }
      // …and a member read off a base the vendor reports has NONE — "'SUPER^' is no structured variable", "'THIS' is no
      // structured variable" (`expr_super_without_base`, `expr_this_member_without_deref`, frontend-conformance 2.5.6)
      if (
        verdict === "NONE" &&
        shape === "member" &&
        (bases.get(where) ?? []).some((base) => vendor.says?.has(`'${base}' is no structured variable`) === true)
      ) {
        tally(c.resolution, `${group}: member NONE, no structured variable on the vendor too`)
        continue
      }
      // …or off a SUPER the vendor does not allow at all — a function block that extends nothing: "Expression SUPER is
      // not allowed in this context" (TwinCAT quotes it), and `SUPER.Get` resolves on neither side
      // (`expr_super_without_deref_without_base`, frontend-conformance 2.5b)
      if (
        verdict === "NONE" &&
        shape === "member" &&
        (bases.get(where) ?? []).includes("super") &&
        (vendor.says?.has("expression super is not allowed in this context") === true ||
          vendor.says?.has("expression 'super' is not allowed in this context") === true)
      ) {
        tally(c.resolution, `${group}: member NONE, SUPER not allowed on the vendor too`)
        continue
      }
      if (verdict === "NONE" && shape === "member" && bitRefusedSites.has(where)) {
        tally(c.resolution, `${group}: member NONE, a bit access refused on the vendor too`)
        continue
      }
      if (verdict === "NONE" && shape === "member" && agreed.has(shapes.rootOf.get(where) ?? "")) {
        tally(c.resolution, `${group}: member NONE, on a name not defined on the vendor too`)
        continue
      }
      if (verdict === "NONE" && (shape === "bare name" || shape === "global name" || shape === "parameter") && agreed.has(where)) {
        tally(c.resolution, `${group}: ${shape} NONE, not defined on the vendor too`)
        continue
      }
      if (verdict === "NONE" && shape === "bare name" && refusedNames.has(where)) {
        tally(c.resolution, `${group}: bare name NONE, a refused expression`)
        continue
      }
      tally(c.resolution, `${group}: ${shape} ${verdict}`)
      if (pin !== undefined && verdict !== "resolved") c.fixtureUnresolved.push(`${pin}${b.parsed.id} ${line}`)
    }
    // …and the expressions of a statement the vendor says is NO VALID STATEMENT (`'(a + 1);' is no valid statement`): it
    // types nothing there — its echo leaves the literal untyped, `(a + 1)`, where a typed operation reads `(a + INT#1)`
    // (`stmt_bare_binary`, `stmt_case_nonconst_label`, both vendors, frontend-conformance 2.6)
    const invalidStatement = noValidStatementsIn(b, vendor.says)
    const undecided = vendor.known ? 0 : undecidedExprCount(b)
    if (undecided > 0) tally(c.types, `${group}: expressions in a conditional branch Volt cannot decide, not measured`, undecided)
    // a TYPE named where an operator takes one — `SIZEOF(LINT)`, `XSIZEOF(DINT)`, `__NEW(T)` — is no value and has no type
    // to ask for, on either side (rules AR23/AR24)
    const typeOperands = typeNameOperands(b)
    if (!vendor.known)
      for (const { expr, scope, line } of typeRows(b)) {
        const [where, kind, ...rest] = line.split(" ")
        const type = rest.join(" ")
        tally(c.types, `${group}: expressions`)
        if (type !== "?" && type !== "NOSCOPE") continue
        // a SIGN on an untyped number is that number, context-typed as the literal is (`-1`, the CASE label `-1:`,
        // `stmt_case_negative_label`, frontend-conformance 2.6). A RECLASSIFICATION, not a fix: the front-end still
        // types `-1` UNKNOWN, as it types `1` (`literal UNKNOWN`, uncapped: an untyped number's type is area 4's).
        // Every one of `unary UNKNOWN`'s 246/245 fixture rows was such a number; this key took them, plus the 7 the
        // 2.6 CASE-label fixtures add (`stmt_case_negative_label`, `_negative_range`, `_plus_label`) — 253/252, a
        // rise for measurement — and corpus 308 = 173 + 135, Library Manager 658, library 9 (no rise). Capped
        // (`baselines/ceilings.json`) at that start, so it may only fall from here.
        // Frontend-conformance 4.2 (rule LT13) made a negated untyped number a literal in the type rules, but it keeps
        // its OWN capped key: folded into the uncapped `literal UNKNOWN` its UNKNOWNs could rise unseen, and typing them
        // is LT14's (`literal-agreement` counts disagreements, not UNKNOWNs) — step 4a review. The 4.1.3/4.2 fixtures'
        // negated literals (22 per vendor) are named ceiling exceptions (`baseline.ts` `NEGATED_LITERAL_ROWS`).
        if (type === "?" && isSignedUntypedNumber(expr)) {
          tally(c.types, `${group}: unary UNKNOWN, a signed untyped number (context-typed, as a literal)`)
          continue
        }
        if (invalidStatement(expr)) {
          tally(c.types, `${group}: ${kind} untyped, no valid statement on the vendor too`)
          continue
        }
        // a refused expression (`dumps.ts` `refusedIn`) has no type to ask for; an undefined name the vendor also
        // reports undefined has none either, nor does an index, member or dereference BUILT on it (`vec4[0]` over an
        // undefined `vec4` starts where `vec4` does); and a call to a POU that returns nothing has no value — each
        // counted, none an UNKNOWN. Where a value belongs (`x := m.NoRet();`) the vendor says the same: "Cannot convert
        // type 'Unknown type: 'm.NoRet()'' to type 'INT'" (`refuse_method_no_result`), and the LSP agrees.
        if (refused(expr)) tally(c.types, `${group}: ${kind} untyped, a refused expression`)
        else if (unparsed(expr)) tally(c.types, `${group}: ${kind} untyped, in a body that did not parse`)
        else if (ON_ITS_ROOT_NAME.has(kind!) && agreed.has(where!))
          tally(c.types, `${group}: ${kind} UNKNOWN, not defined on the vendor too`)
        else if (type === "?" && returnsNothing(expr, scope, b)) tally(c.types, `${group}: call with no return value`)
        // a GVL's NAME qualifying its variable (`GVL.g`) is no value on either side — it names where `g` is, and has no
        // type to ask for (`use_gvl_field_access`, `decl_at_after_type_in_gvl`, frontend-conformance 2.3)
        else if (type === "?" && shapes.qualifiers.has(where!) && namesAGvl(expr, scope)) tally(c.types, `${group}: ${kind} untyped, a GVL's name qualifying its variable`)
        // a device-tree instance (rule Y24) is a name its `.device` descriptor states and nothing else, so the front-end has no
        // type to give it — but the vendor types it (`EtherCAT_Master.xRestart` builds, `sym_device_instance_bare`): a GAP, not
        // an agreement, so the key says UNKNOWN and is ceilinged like every other one (frontend-conformance 3.1 review)
        else if (type === "?" && expr.kind === "ident_expr" && scope !== undefined && resolveBareName(scope, expr.name).kind === "device")
          tally(c.types, `${group}: ${kind} UNKNOWN, a device instance (the front-end lacks the type the vendor gives it)`)
        // what the vendor reports unknown too is that agreement before it is anything else: the SIZEOF/ADR split below
        // is the LSP's own reason, and ahead of this it took agreements out of their measure
        else if (type === "?" && vendor.unknownTypes.has(compilerExprText(expr)))
          tally(c.types, `${group}: ${kind} UNKNOWN, unknown on the vendor too`)
        // a member the vendor reports no component of its base (0.3's `member NONE, no component on the vendor too`) has no
        // type there either, where the vendor names no unknown type for it: `PRG.S_Bot` is "'S_Bot' is no component of 'PRG_…'" (`sfc_step_typo_qualified`, lsp-sfc-step-names 1.1)
        else if (type === "?" && expr.kind === "member" && noComponentSites.has(at(expr.member.span)))
          tally(c.types, `${group}: member UNKNOWN, no component on the vendor too`)
        // …and a variable whose DECLARED TYPE the vendor names unknown — LDATE, LDT and LTOD on TwinCAT, which has none of
        // them ("Unknown type: 'LDATE'", the explicit-pair fixtures `xp_*ldate*`, `xp_*ldt*`, `xp_*ltod*`, task 4.5.3)
        else if (type === "?" && expr.kind === "ident_expr" && scope !== undefined && declaredTypeUnknown(expr.name, scope, vendor.unknownTypes))
          tally(c.types, `${group}: ident_expr untyped, its declared type unknown on the vendor too`)
        // a call of what the vendor says is no call target — "Program name, function or function block instance expected
        // instead of 'plain'" — has no result there either, as a statement too (`cc5_invalid_call_target`; the front-end
        // types such a call UNKNOWN since frontend-conformance 2.5b, `expr_global_namespace_call_non_callable`)
        else if (type === "?" && expr.kind === "call" && vendor.says?.has(`program name, function or function block instance expected instead of '${compilerExprText(expr.callee).toLowerCase()}'`) === true)
          tally(c.types, `${group}: call untyped, no call target on the vendor too`)
        // …and a call operator whose OPERANDS the vendor refuses — "'__QUERYINTERFACE' needs exactly '2' operands",
        // "Operand of __DELETE must be pointer" — gives the call no type there either (`lex_keyword_called_sys_delete`,
        // `_queryinterface`, `_querypointer`, both vendors, review 2.6)
        else if (type === "?" && expr.kind === "call" && expr.callee.kind === "ident_expr" && operandsRefused(expr.callee.name, vendor.says))
          tally(c.types, `${group}: call untyped, its operands refused on the vendor too`)
        // …and SUPER where the vendor does not allow it — a function block that extends nothing: "Expression SUPER is not
        // allowed in this context" (TwinCAT quotes it; `expr_super_without_deref_without_base`, `refuse_super_without_base`)
        else if (
          type === "?" &&
          expr.kind === "ident_expr" &&
          expr.name.toUpperCase() === "SUPER" &&
          (vendor.says?.has("expression super is not allowed in this context") === true ||
            vendor.says?.has("expression 'super' is not allowed in this context") === true)
        )
          tally(c.types, `${group}: ident_expr untyped, SUPER not allowed on the vendor too`)
        else if (type === "?" && operandTyped(expr, scope, b) === false) tally(c.types, `${group}: call UNKNOWN, on an untyped operand`)
        // …a SIZEOF of a TYPE NAME (`SIZEOF(SomeStruct)`), told apart from one of a typed expression since frontend-conformance
        // 4.1.1: the census resolved the name with the POU scope passed as the project, so a project type was "untyped"
        else if (type === "?" && operandTyped(expr, scope, b) === "type-name")
          tally(c.types, `${group}: call UNKNOWN, SIZEOF of a type name (no result type yet, task 4.3.4)`)
        else if (type === "?" && operandTyped(expr, scope, b) === true)
          tally(c.types, `${group}: call UNKNOWN, SIZEOF or ADR (no result type yet, task 4.3.4)`)
        // …and `__NEW`/`__DELETE` — `__NEW` is POINTER TO its type since 4.3.4, so what is left is `__DELETE`, whose value no
        // recording asks — split out when the five
        // TwinCAT `newdel_*` fixtures left KNOWN_DIVERGENCES (frontend-conformance 2.7.2: they diverged only because the
        // recorder had dropped their pragma) and their calls came to be measured: a reclassification, not a rise
        else if (type === "?" && expr.kind === "call" && expr.callee.kind === "ident_expr" && /^__(new|delete)$/i.test(expr.callee.name))
          tally(c.types, `${group}: call UNKNOWN, __NEW or __DELETE (no result type yet, task 4.3.4)`)
        // …and an expression over a TYPED LITERAL whose prefix names no type: `FOO#5 + n` is "'5' is no component of 'FOO'"
        // on CODESYS and nothing more — the operand has no type there, and neither has what is built on it
        // (`rec_unknown_literal_prefix_cascade`, frontend-conformance 2.8.3); the LSP says the same line
        else if (type === "?" && expr.kind === "member" && bitRefusedSites.has(at(expr.member.span)))
          tally(c.types, `${group}: member untyped, a bit access refused on the vendor too`)
        else if (type === "?" && unknownLiteralComponent(expr, vendor.says))
          tally(c.types, `${group}: ${kind} UNKNOWN, no component on the vendor too`)
        // …and arithmetic on a `strict` enum, which the vendor refuses — "Arithmetics not allowed on strict ENUM type 'X'"
        // — so the operation has no type there (`prag_strict_enum_add_literal`, both vendors, frontend-conformance 2.10;
        // the refusal itself is task 4.5.1's, `deferred.lsp`)
        else if (type === "?" && expr.kind === "binary" && strictArithmeticRefused(expr, scope, b, vendor.says))
          tally(c.types, `${group}: binary untyped, arithmetic on a strict enum refused on the vendor too`)
        // …and an expression the front-end WOULD type on a 64-bit target: a platform integer (`__XWORD`, `__UXINT`) has no
        // width in a project whose device's width nobody measured, so it — and what is built on it — is untyped there, by
        // the rule (`types/platform`, frontend-conformance 4.1.1). A GAP (TY6's), so the key says UNKNOWN and is ceilinged.
        else if (type === "?" && typeOperands.has(expr)) tally(c.types, `${group}: ident_expr untyped, a type named where the operator takes one`)
        else if (type === "?" && scope !== undefined && typedOnASixtyFourBitTarget(expr, scope, b))
          tally(c.types, `${group}: ${kind} UNKNOWN, a platform integer on a target nobody measured (TY6)`)
        else tally(c.types, `${group}: ${kind} ${type === "?" ? "UNKNOWN" : "NOSCOPE"}`)
      }
    // …and its folds (0.4) are counted, not measured, as its resolution and types are (refinement (c), frontend-conformance
    // 2.1; the fold count had been left out of it — `expr_pool_qualified_global`'s global, 2.5.6)
    if (vendor.known) tally(c.folds, `${group}: files of a known divergence (support/divergences.ts), not measured`)
    else for (const line of foldDump(b)) {
      const [, where, value] = line.split(" ")
      tally(
        c.folds,
        `${group}: ${where} ${value === "∅" ? "does not fold" : value === "NOSCOPE" ? "NOSCOPE" : "folds"}`,
      )
    }
  }

  /** Is `expr` an arithmetic operation on an enum the vendor refused as "Arithmetics not allowed on strict ENUM type 'X'"? */
  function strictArithmeticRefused(expr: Extract<Expr, { kind: "binary" }>, scope: Scope | undefined, b: Bound, says: ReadonlySet<string> | undefined): boolean {
    if (says === undefined || scope === undefined) return false
    return [expr.left, expr.right].some((operand) => {
      const t = inferExprType(operand, scope, b.project)
      return t.kind === "enum" && says.has(`arithmetics not allowed on strict enum type '${t.name.toLowerCase()}'`)
    })
  }

  /** Does `expr` hold a typed literal `P#V` the vendor refused as "'V' is no component of 'P'"? */
  function unknownLiteralComponent(expr: Expr, says: ReadonlySet<string> | undefined): boolean {
    if (says === undefined) return false
    let found = false
    walkExpr(expr, (x) => {
      if (x.kind !== "literal") return
      const hash = x.text.indexOf("#")
      if (hash > 0 && says.has(`'${x.text.slice(hash + 1)}' is no component of '${x.text.slice(0, hash)}'`.toLowerCase())) found = true
    })
    return found
  }

  for (const project of corpusProjects())
    for (const b of boundCorpus(project))
      summarize(isLibraryManagerFile(b.parsed.id) ? "corpus Library Manager" : "corpus", b, undefined)

  for (const vendor of ["codesys", "twincat"] as const)
    for (const f of fixtureSources()) {
      // an SFC fixture the push refuses and no build or refusal answers — TwinCAT's, which no recorder can create, and CODESYS's
      // that build (a run records values, not the build's messages): counted, not measured (`sources.ts` `unanswered`). ONLY
      // the SFC fixtures: every other push-refused fixture was measured here before them and still is — its names, types and
      // folds are the census's to hold (lsp-sfc-step-names 1, review: the rule taken whole dropped 45 fixture/vendor pairs).
      if (f.test.sfcStep !== undefined && unanswered(f, vendor)) {
        tally(c.resolution, `fixtures ${vendor}: SFC files the push refuses, no build or refusal recorded, not measured`, 2)
        tally(c.types, `fixtures ${vendor}: SFC files the push refuses, no build or refusal recorded, not measured`, 2)
        continue
      }
      withBoundFixture(f, vendor, (own, plc, deps) => {
        const known = KNOWN_DIVERGENCES[vendor].has(f.test.name)
        const notDefined = new Set(
          ((vendor === "codesys" ? f.codesys : f.twincat)?.diagnostics ?? []).flatMap((d) => {
            const m = /^Identifier '(.+)' not defined$/.exec(d.message)
            if (m !== null) return [m[1].toLowerCase()]
            // …and `.name` no GLOBAL declares — "There is no global definition for 'loc'" (rule E33): the dump's `(global) loc`
            const g = /^There is no global definition for '(.+)'$/.exec(d.message)
            return g === null ? [] : [`(global) ${g[1].toLowerCase()}`]
          }),
        )
        // "'<member>' is no component of '<base>'": each member the vendor found on no component, with the base it names
        // (`member|base`, lower case — `memberBases`)
        const noComponent = new Set(
          ((vendor === "codesys" ? f.codesys : f.twincat)?.diagnostics ?? []).flatMap((d) => {
            const m = /^'(.*)' is no component of '(.+)'$/.exec(d.message) // the member may be '': the end of the text (`rec_member_name_at_end`)
            return m === null ? [] : [`${m[1]!.toLowerCase()}|${m[2]!.toLowerCase()}`]
          }),
        )
        const unknownTypes = new Set(
          ((vendor === "codesys" ? f.codesys : f.twincat)?.diagnostics ?? []).flatMap((d) =>
            [...d.message.matchAll(/Unknown type: '(.+?)''? to type|^Unknown type: '(.+)'$/g)].map((m) => m[1] ?? m[2]),
          ),
        )
        const says = vendorSays(vendor === "codesys" ? f.codesys : f.twincat)
        summarize(`fixtures ${vendor}`, own, `${vendor} `, { known, notDefined, noComponent, unknownTypes, says })
        summarize(`fixtures ${vendor}`, plc, `${vendor} `, { known, notDefined, noComponent, unknownTypes, says })
        if (!known) crossCheckBuildTypes(f, vendor, [own, plc], c)
        if (vendor === "codesys") {
          crossCheckRunTypes(f, plc, c)
          crossCheckFolds(f, plc, [own, plc, ...deps], c)
        }
      })
    }

  for (const b of boundLibrary()) summarize("library", b, "")
  cached = c
  return c
}

// ─── types ───────────────────────────────────────────────────────────────────────────────────────────────────

const TYPE_MESSAGES: readonly RegExp[] = [
  /^Cannot convert type '(.+)' to type '(.+)'$/,
  /^Implicit conversion from (?:un)?signed Type '(.+)' to (?:un)?signed Type '(.+)' : Possible change of sign$/,
  /^Implicit conversion from '(.+)' to '(.+)': Possible loss of information$/,
]

const COMPARISONS: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="])

const typeKey = (t: string): string => t.toUpperCase().replace(/\s+/g, "")

/** A store the front-end types: the target's type, and every type its value may be checked as. */
interface Store {
  target: string
  value: Set<string>
  /** How the front-end converts the value's inferred type into the target's. */
  conversion: ReturnType<typeof classifyConversion>
  /** The two types as printed, for a finding. */
  printed: string
  /** A comparison operand's store: its two operands' types, `LEFT|RIGHT`. */
  compared?: string
  /** A store TwinCAT words with its two types swapped (a literal `REF=`). */
  reversedOnTwincat?: boolean
  /** A declaration's initializer whose WARNING the IDE says twice (`analysis` `initializerWarnedTwice`: in a FUNCTION_BLOCK,
   *  outside VAR CONSTANT — `ir_initializer_warning_*`): it explains two copies of a warning, one of a refusal. */
  warnedTwice?: boolean
}

/** The type an operation meets at, for the compiler's typed echo of a bare integer literal inside it (as `analysis/checks/
 *  types/unknown-source` `metType`). */
const metIn = (scope: Scope) => (e: Expr): string | undefined => {
  const t = inferExprType(e, scope, rootOf(scope))
  return t.kind === "elementary" ? t.name : undefined
}

/** What `S=` and `R=` read and set. */
const BOOL: Type = elementaryRef("BOOL")

/** An enum member's value folded in the project — what `strictEnum` reads its members by. */
const enumerator = (project: Scope) => (e: Expr): bigint | undefined => {
  const v = constEval(e, project)
  return typeof v === "bigint" ? v : undefined
}

/** Every message a recorded build holds, lower case — what `dumps.ts` `unparsedIn` asks of an LSP parse error; undefined
 *  when there is no build recording (the push refused the fixture). */
function vendorSays(build: { diagnostics: readonly { message: string }[] } | undefined): ReadonlySet<string> | undefined {
  return build === undefined ? undefined : new Set(build.diagnostics.map((d) => d.message.toLowerCase()))
}

function storesOf(b: Bound, says: ReadonlySet<string> | undefined): Store[] {
  const out: Store[] = []
  /** `named`: the target as the compiler names it where it is no `Type` — a bare conversion's parameter, `ANY`. */
  const store = (target: Type, value: Expr, scope: Scope, named?: string, compared?: string, reversedOnTwincat?: boolean, warnedTwice?: boolean): void => {
    // a store into a `strict` enum is refused in its own words, "'x' is not a valid value for strict ENUM type …" — no
    // conversion message explains or is explained by it (`types/enums` `strictEnum`, task 4.5.1)
    if (strictEnum(b.project, target, enumerator(b.project)) !== undefined) return
    const inferred = inferExprType(value, scope, b.project)
    const as = new Set([typeKey(renderType(inferred))])
    for (const t of [literalErrorType(value, target), literalCheckType(value, target)])
      if (t !== undefined) as.add(typeKey(renderType(t)))
    // CODESYS names an expression it cannot type by its text: "Cannot convert type 'Unknown type: 'x'' to type 'INT'" —
    // as written, or as the compiler echoes it (a malformed address with its `?`: 'Unknown type: '%M?0.1'',
    // `lit_address_unsized_in_body`, frontend-conformance 2.2.7)
    if (inferred.kind === "unknown") {
      as.add(typeKey(`Unknown type: '${exprText(value)}'`))
      // …with an untyped integer inside it typed as the operation it stands in, as `unknown-source` echoes it:
      // 'F_C2_loop(depth := (depth - INT#1))' (`cc2_call_recursion`)
      as.add(typeKey(`Unknown type: '${compilerExprText(value, metIn(scope))}'`))
    }
    // …and a string LITERAL by its message form, length-tagged: "Cannot convert type 'STRING(INT#3)' to type 'INT'" —
    // the front-end's type is STRING, the length is the message's (`analysis/rules` `stringLiteralMessageType`;
    // `cc_string_escape_literal_into_int`, `lit_uchar_two_chars`, `lit_utf8_*_into_wstring`, frontend-conformance 2.2.6)
    const literal = stringLiteralMessageType(value)
    if (typeof literal === "string") as.add(typeKey(literal))
    // …and a CONSTANT outside a SUBRANGE target by its value: "Cannot convert type '20' to type 'INT (0..10)'" (rule DT3,
    // `analysis/checks/types/subrange`; `subrange_*`, `dt_subrange_*`)
    if (target.kind === "elementary" && target.subrange !== undefined) {
      const v = constEval(value, scope)
      if (typeof v === "bigint" && (v < target.subrange.lower || v > target.subrange.upper)) as.add(typeKey(String(v)))
    }
    out.push({
      target: typeKey(named ?? renderType(target)),
      value: as,
      conversion: classifyConversion(target, inferred),
      printed: `${renderType(inferred)} → ${named ?? renderType(target)}`,
      ...(compared !== undefined ? { compared } : {}),
      ...(reversedOnTwincat === true ? { reversedOnTwincat } : {}),
      ...(warnedTwice === true ? { warnedTwice } : {}),
    })
  }
  /** A conversion a RULE of the front-end names by its two types, with no value expression to type: an operator's operand
   *  family (`operandFamilyRule`, `unaryOperandConversion` — 'STRING' into 'ANY_NUM', 'REAL' into 'ANY_BIT'), an
   *  output binding's parameter into its variable. */
  const pair = (target: string, from: Type | string, conversion: ReturnType<typeof classifyConversion>): void => {
    const fromName = typeof from === "string" ? from : renderType(from)
    out.push({ target: typeKey(target), value: new Set([typeKey(fromName)]), conversion, printed: `${fromName} → ${target}` })
  }
  /** Stores inside an expression: an operand converts to the type of its operator — for a comparison, whose BOOL is not
   *  what its operands convert to, to the two operands' checked meet — and an input argument to its parameter's type. */
  const inner = (e: Expr, scope: Scope, twice: boolean): void => {
    for (const x of valueExprs(e)) {
      if (x.kind === "unary") store(inferExprType(x, scope, b.project), x.operand, scope, undefined, undefined, undefined, twice)
      // …except where the operator computes in no integer the operand could convert to: `NOT aReal`, `NOT aString` name
      // ANY_BIT (`types/arith/operators` `unaryOperandConversion`; `uop_not_real`, `unary_not_on_string`)
      if (x.kind === "unary" && (x.op === "-" || x.op === "NOT")) {
        const operand = inferExprType(x.operand, scope, b.project)
        if (operand.kind === "elementary" && unaryOperandConversion(x.op, operand.elem.family) === "ANY_BIT") pair("ANY_BIT", operand, "incompatible")
      }
      // an arithmetic operand of the wrong FAMILY converts into what the rule names — a BOOL into the number beside it, a
      // string into ANY_NUM or that number (`types/arith/operators` `operandFamilyRule`; `cc_string_plus_string`,
      // `cc_int_plus_string`, `string_arithmetic_rejected`)
      if (x.kind === "binary") {
        const [lt, rt] = [inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project)]
        const rule = lt.kind === "elementary" && rt.kind === "elementary" ? operandFamilyRule(x.op, lt.name, rt.name) : undefined
        // …but a BOOL operand and a scaled duration, which the operand stores into the result and the duration store
        // below already hold
        const heldBelow = rule?.kind === "convert" && (rule.from === "BOOL" || (lt.kind === "elementary" && rt.kind === "elementary" && durationScaleConversion(x.op, lt.name, rt.name) !== undefined))
        if (rule?.kind === "convert" && !heldBelow) pair(rule.to, rule.from, "incompatible")
      }
      // an ATOMIC intrinsic's operand (`builtins` `atomicOperand`, `calls/atomic-operands.ts`): TEST_AND_SET stores it into a
      // DWORD; __XADD and __COMPARE_AND_SWAP refuse what they do not take, into the type they name
      if (x.kind === "call" && x.callee.kind === "ident_expr" && x.args[0]?.value !== undefined) {
        const atomic = atomicOperand(x.callee.name, b.project.dialect)
        const arg = x.args[0].value
        if (atomic?.store === true) store(atomic.type, arg, scope, undefined, undefined, undefined, twice)
        else if (atomic !== undefined && atomic.refuses(inferExprType(arg, scope, b.project))) pair(renderType(atomic.type), inferExprType(arg, scope, b.project), "incompatible")
      }
      // a BITWISE operator computes in the UNSIGNED integer of its operands' width: a signed operand of a same-width pair
      // converts into it (`types/arith/operators` `operandConversion` "unsigned"; `cc_bitwise_byte_and_sint`: BYTE AND
      // SINT is "signed Type 'SINT' to unsigned Type 'USINT'")
      if (x.kind === "binary" && operandConversion(x.op) === "unsigned") {
        const sides = [x.left, x.right].map((side) => [side, inferExprType(side, scope, b.project)] as const)
        const [l, r] = sides.map(([, t]) => (t.kind === "elementary" && (t.elem.family === "int" || t.elem.family === "bitstring") ? t.elem : undefined))
        if (l !== undefined && r !== undefined && l.bits === r.bits && l.signed !== r.signed)
          for (const [side, t] of sides)
            if (t.kind === "elementary" && t.elem.signed && side.kind !== "literal") store(elementaryTypeRef(integerOfWidth(t.elem.bits, false)), side, scope, undefined, undefined, undefined, twice)
      }
      // a CONVERSION's argument converts into its source type first (`analysis/rules` `conversionArgError`, rule CV2:
      // `REAL_TO_DINT(EXPT(…))` LREAL into REAL, `INT_TO_REAL(aReal)` REAL into INT — `cfold_expt`,
      // `conversion_int_to_real_wrong_source`)
      if (x.kind === "call" && x.callee.kind === "ident_expr") {
        const from = parseConversionName(x.callee.name, targetOf(b.project))?.from
        const arg = x.args[0]?.value
        if (from !== undefined && arg !== undefined) store(elementaryTypeRef(from), arg, scope, undefined, undefined, undefined, twice)
      }
      // an untyped NEGATIVE literal compared with an unsigned operand converts into the type the rule names (rule LT12,
      // `types/arith/operators` `negativeLiteralComparisonTarget`)
      if (x.kind === "binary" && COMPARISONS.has(x.op))
        for (const [lit, other] of [[x.left, x.right], [x.right, x.left]] as const) {
          const value = constEval(lit, scope)
          const operand = inferExprType(other, scope, b.project)
          if (!isSignedUntypedNumber(lit) || typeof value !== "bigint" || operand.kind !== "elementary") continue
          const into = negativeLiteralComparisonTarget(operand.elem, value, b.project.dialect)
          if (into !== undefined) store({ kind: "elementary", name: into.name, elem: into }, lit, scope, undefined, undefined, undefined, twice)
        }
      // date/time arithmetic converts no operand — a date and a duration stay as they are (`types/arith/temporal`, rule
      // AR17) — except a duration scaled by an integer (rule AR18, `durationScaleConversion`): into a WIDER integer the
      // duration converts ("Cannot convert type 'TIME' to type 'LINT'", `ar_time_scaled_by_wide_or_unsigned_int_type`), and
      // an integer no wider converts into the signed integer of the duration's width (CODESYS: "UDINT to DINT",
      // `ar_duration_scaled_by_same_width_unsigned_type`)
      const temporal = x.kind === "binary" ? temporalArithmeticType(x.op, inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project)) : undefined
      if (x.kind === "binary") {
        const [lt, rt] = [inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project)]
        const scaled = lt.kind === "elementary" && rt.kind === "elementary" ? durationScaleConversion(x.op, lt.name, rt.name) : undefined
        if (scaled !== undefined) store(elementaryRef(scaled.to), scaled.side === "left" ? x.left : x.right, scope, undefined, undefined, undefined, twice)
      }
      if (x.kind === "binary" && temporal === undefined) {
        const result = COMPARISONS.has(x.op)
          ? checkedMeetType(inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project))
          : inferExprType(x, scope, b.project)
        if (result !== undefined) {
          const compared = COMPARISONS.has(x.op)
            ? `${typeKey(renderType(inferExprType(x.left, scope, b.project)))}|${typeKey(renderType(inferExprType(x.right, scope, b.project)))}`
            : undefined
          store(result, x.left, scope, undefined, compared, undefined, twice)
          store(result, x.right, scope, undefined, compared, undefined, twice)
        }
      }
      // AND_THEN / OR_ELSE over integers: the integer their operands meet in is refused as the condition, "Cannot convert
      // type 'UINT' to type 'BOOL'" (`types/arith/operators` `shortCircuitType`, rule CB5) — the operands' own stores
      // into that integer are the binary branch's above
      if (x.kind === "binary" && SHORT_CIRCUIT_OPERATORS.has(x.op) && inferExprType(x, scope, b.project).kind === "elementary") {
        const met = inferExprType(x, scope, b.project)
        if (met.kind === "elementary" && met.elem.family !== "bool") store(BOOL, x, scope, undefined, undefined, undefined, twice)
      }
      if (x.kind !== "call") continue
      // a selection function's VALUE arguments convert into its result, their meet (`types/builtins` `selectionValueArguments`,
      // rules AR13/AR14) — the compiler's own name, unshadowed
      const values = x.callee.kind === "ident_expr" && resolveCallee(x, scope, b.project) === undefined ? selectionValueArguments(x.callee.name, x.args.map((a) => a.value)) : undefined
      const selected = values === undefined ? UNKNOWN : inferExprType(x, scope, b.project)
      if (selected.kind === "elementary") for (const v of values ?? []) if (v !== undefined) store(selected, v, scope, undefined, undefined, undefined, twice)
      // a BARE conversion converts its argument to ANY (`analysis/hole` `bareConversionArgument`, frontend-conformance 2.2b)
      const converted = bareConversionArgument(x)
      if (converted !== undefined) store(UNKNOWN, converted, scope, "ANY", undefined, undefined, twice)
      const callee = resolveCallee(x, scope, b.project)
      if (callee === undefined) continue
      x.args.forEach((a, i) => {
        if (a.value === undefined) return
        // an OUTPUT binding `p => v` stores the output into the variable (`accepts_output_into_other_type`: "Cannot convert
        // type 'INT' to type 'STRING'")
        if (a.output) {
          const output = a.param === undefined ? undefined : outputType(callee, a.param.name, b)
          const into = inferExprType(a.value, scope, b.project)
          if (output !== undefined && into.kind !== "unknown") pair(renderType(into), output, classifyConversion(into, output))
          return
        }
        const param =
          a.param === undefined
            ? callee.positional[i]
            : callee.positional.find((p) => p.name.text.toLowerCase() === a.param!.name.toLowerCase())
        // a VAR_IN_OUT is BOUND, not converted — its own rule and message (`calls/inout-*`; `cc5_in_out_type_mismatch`)
        if (param !== undefined && !param.inOut)
          store(resolveTypeExpr(param.type, b.project, 0, b.project, callee.sym.uri), a.value, scope, undefined, undefined, undefined, twice)
      })
    }
  }
  const visit = (units: readonly TopLevel[]): void => {
    for (const unit of allUnits(units)) {
      const scope = scopeForUnit(b.project, unit)
      if (scope === undefined) continue
      // an ENUM member's value converts into the enum (`cc5_enum_init_not_convertible`: "Cannot convert type 'LREAL' to type
      // 'DUT_C5_ODD'")
      if (unit.kind === "type_decl" && unit.body.kind === "enum") {
        const enumType = resolveNamedType(unit.name.text, b.project)
        for (const member of unit.body.values) if (member.value !== undefined) store(enumType, member.value, scope)
      }
      if ("varSections" in unit)
        for (const section of unit.varSections)
          for (const decl of section.decls) {
            // a STRUCT initializer on an elementary variable has no type, and is named by its text: "Cannot convert type
            // 'Unknown type: 'STRUCT(x := 1, y := 2)'' to type 'INT'" (`analysis/checks/types/struct-init`,
            // `cc3_unexpected_struct_init`)
            if (decl.init !== undefined && isStructInit(decl.init) && resolveTypeExpr(decl.type, b.project, 0, scope).kind === "elementary")
              pair(compilerTypeText(decl.type), `Unknown type: '${structEcho(decl.init)}'`, "incompatible")
            // a REFERENCE declared `REF= x` binds x, named as the reference: "Cannot convert type 'STRING' to type
            // 'REFERENCE TO INT'", 'Unknown type: 'nope'' for an undeclared one (`refdecl_target_wrong_type`,
            // `refdecl_target_undeclared`, both vendors)
            if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && decl.initOp === "REF=")
              store(resolveTypeExpr(decl.type, b.project, 0, scope), decl.init, scope)
            if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && decl.initOp === undefined)
              store(resolveTypeExpr(decl.type, b.project, 0, scope), decl.init, scope, unknownTarget(resolveTypeExpr(decl.type, b.project, 0, scope), decl.type), undefined, undefined, initializerWarnedTwice(unit, section))
            // a REFUSED initializer still stores the value the compiler kept — the placeholder where the malformed
            // literal stood (`RefusedInit.value`): "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'TIME'"
            // (`cc_time_microsecond_literal`, `lit_init_*`, frontend-conformance 2.2a)
            const refused = decl.refusedInit?.value
            if (refused !== undefined) store(resolveTypeExpr(decl.type, b.project, 0, scope), refused, scope, unknownTarget(resolveTypeExpr(decl.type, b.project, 0, scope), decl.type))
          }
      for (const body of unitBodies(unit)) {
        // a body that did not parse — on the vendor too — is typed by neither side (`dumps.ts` `unparsedIn`)
        if (!isStBody(body) || unparsed(body)) continue
        const bodyScope = scope.children.find((s) => s.span === body.span) ?? scope
        walkStatements(bodyStatements(body, bodyConditionWorld(b.project, unit, body)).statements, (s) => {
          // `a := b := c` stores c into b and b into a — each `:=` link its own store (`assign_chained_plain`)
          if (s.kind === "assign" && s.chained !== undefined) {
            const places = [s.target, ...s.chained]
            const ops = [s.op, ...(s.chainOps ?? [])]
            places.forEach((place, i) => {
              if (ops[i] === undefined) store(inferExprType(place, bodyScope, b.project), places[i + 1] ?? s.value, bodyScope)
            })
          }
          if (s.kind === "assign" && s.op === undefined && s.chained === undefined) {
            const target = inferExprType(s.target, bodyScope, b.project)
            const written = s.target.kind === "ident_expr" ? lookup(bodyScope, s.target.name)?.symbol.typeExpr : undefined
            // a SUBRANGE target of an assignment is named in its assignment form (`messages` `subrangeAssignTarget`)
            const subrange = target.kind === "elementary" && target.subrange !== undefined
              ? messagesFor(b.project.dialect === "twincat" ? "twincat" : "codesys").subrangeAssignTarget(target.name, target.subrange.lower, target.subrange.upper)
              : undefined
            store(target, s.value, bodyScope, subrange ?? (written === undefined ? undefined : unknownTarget(target, written)))
          }
          // `S=` / `R=` read and set a BOOL — both sides convert to it (`stmt_s_eq_non_bool_*`, frontend-conformance 2.6)
          if (s.kind === "assign" && (s.op === "S=" || s.op === "R=")) {
            store(BOOL, s.target, bodyScope)
            store(BOOL, s.value, bodyScope)
          }
          // a literal bound with `REF=` is stored into the reference (`cc3_reference_assign`, `stmt_ref_eq_literal_value`) —
          // TwinCAT names the pair the other way round (`analysis/messages` `refAssignCannotConvert`)
          if (s.kind === "assign" && s.op === "REF=" && s.value.kind === "literal")
            store(inferExprType(s.target, bodyScope, b.project), s.value, bodyScope, undefined, undefined, true)
          // …and a variable of another type is refused into it, named as itself (`analysis/checks/types/reference-assign`,
          // `dt_ref_assign_wrong_type`, `cv_pointer_to_reference`, `cv_reference_to_other_reference`, rule DT14)
          else if (s.kind === "assign" && s.op === "REF=")
            store(inferExprType(s.target, bodyScope, b.project), s.value, bodyScope, undefined, undefined, true)
          // a FOR counts in ANY_INT: its control variable converts to it (`stmt_for_real_control`, `stmt_for_bool_control`)
          if (s.kind === "for") store(UNKNOWN, s.controlVar, bodyScope, "ANY_INT")
          // a CASE label converts to the selector — a typed literal (`stmt_case_typed_label_other_type`) and an untyped one
          // (`lt_literal_case_label_out_of_range`, rule LT12) — and a FOR's TO bound to its counter
          // (`lt_literal_for_bounds_out_of_range`)
          if (s.kind === "case") {
            const selector = inferExprType(s.selector, bodyScope, b.project)
            for (const arm of s.arms)
              for (const label of arm.labels)
                if (label.value.kind === "literal" && (label.value.literalKind === "typed" || label.value.literalKind === "int")) store(selector, label.value, bodyScope)
          }
          if (s.kind === "for") store(inferExprType(s.controlVar, bodyScope, b.project), s.to, bodyScope)
        })
      }
    }
  }
  const unparsed = unparsedIn(b.parsed.parseResult, says)
  visit(b.parsed.parseResult.units)
  // the conversions INSIDE an initializer the IDE checks twice are said twice too (`narrowing` walks the initializer with
  // `pushForDeclaration`: `cfold_expt`'s `REAL_TO_DINT(EXPT(…))` in an FB)
  const twice = new Set<Expr>()
  for (const unit of allUnits(b.parsed.parseResult.units))
    if ("varSections" in unit)
      for (const section of unit.varSections)
        for (const decl of section.decls)
          if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && initializerWarnedTwice(unit, section)) twice.add(decl.init)
  for (const s of sites(b)) if (s.scope !== undefined && !unparsed(s.expr)) inner(s.expr, s.scope, twice.has(s.expr))
  return out
}

/** The declared type of the OUTPUT `name` of a callee — a member of an FB instance's scope (its base chain's too), or a
 *  VAR_OUTPUT of a function/method's own declaration. */
function outputType(callee: NonNullable<ReturnType<typeof resolveCallee>>, name: string, b: Bound): Type | undefined {
  const sym = callee.scope !== undefined ? lookupMember(callee.scope, name) : undefined
  const own = (callee.sym.ast as { varSections?: readonly { sectionKind: string; decls: readonly { names: readonly { text: string }[]; type: TypeExpr }[] }[] }).varSections
  const decl = own?.filter((sec) => sec.sectionKind === "VAR_OUTPUT").flatMap((sec) => sec.decls).find((d) => d.names.some((n) => n.text.toLowerCase() === name.toLowerCase()))
  if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, b.project, 0, sym.owner, sym.uri)
  return decl === undefined ? undefined : resolveTypeExpr(decl.type, b.project, 0, b.project, callee.sym.uri)
}

/** Does the vendor refuse the operands of the call operator `name` — its count, or its operand's kind? */
function operandsRefused(name: string, says: ReadonlySet<string> | undefined): boolean {
  const n = name.toLowerCase()
  return [...(says ?? [])].some((m) => m.startsWith(`'${n}' needs exactly `) || m.startsWith(`'${n}' needs at least `) || m.startsWith(`operand of ${n} must be`))
}

/** A `-`/`+` on an untyped integer or real literal. */
function isSignedUntypedNumber(e: Expr): boolean {
  return e.kind === "unary" && (e.op === "-" || e.op === "+") && e.operand.kind === "literal" &&
    (e.operand.literalKind === "int" || e.operand.literalKind === "real")
}

/** Does an expression stand in a bare-expression statement the vendor names "'<echo>;' is no valid statement"? */
function noValidStatementsIn(b: Bound, says: ReadonlySet<string> | undefined): (e: Expr) => boolean {
  const echoes = new Set(
    [...(says ?? [])].flatMap((m) => {
      const hit = /^'([\s\S]*);\s*' is no valid statement$/.exec(m)
      return hit === null ? [] : [hit[1]!]
    }),
  )
  if (echoes.size === 0) return () => false
  const spans: { start: number; end: number }[] = []
  for (const unit of allUnits(b.parsed.parseResult.units))
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      walkStatements(bodyStatements(body, bodyConditionWorld(b.project, unit, body)).statements, (st) => {
        if (st.kind === "expr_stmt" && echoes.has(compilerExprText(st.expr).toLowerCase())) spans.push(st.expr.span)
      })
    }
  return (e) => spans.some((sp) => e.span.start >= sp.start && e.span.end <= sp.end)
}

/** The type a recorded run value is printed as, or undefined when its text does not say. */
function recordedType(value: string): string | undefined {
  const prefixed = /^([A-Za-z_]+)#/.exec(value)
  if (prefixed !== null) return prefixed[1]
  if (value.startsWith("'")) return "STRING"
  if (value.startsWith('"')) return "WSTRING"
  if (value === "TRUE" || value === "FALSE") return "BOOL"
  const enumValue = /^([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*$/.exec(value)
  return enumValue === null ? undefined : enumValue[1]
}

/** Does an inferred type print as the recorded one? A string's capacity is not in a printed value; a BIT reads as a BOOL;
 *  an inline enum is `(implicit)` to the front-end and `Implicit_Enum__<POU>` to CODESYS. */
function sameType(recorded: string, inferred: string): boolean {
  const r = typeKey(recorded)
  // the capacity however written — `STRING(5)`, `STRING(n)` (a named length is rendered as written, frontend-conformance 4.6.2)
  const i = typeKey(inferred).replace(/^(W?STRING)\(.*\)$/, "$1")
  if (r === "BOOL") return i === "BOOL" || i === "BIT"
  if (r.startsWith("IMPLICIT_ENUM__")) return i === "(IMPLICIT)"
  return r === i
}

/** A run-recording path as an expression — the run recording is CODESYS's, so lexed as CODESYS. */
const pathExpr = (path: string): Expr | undefined =>
  parseExprFromTokens(lex(path, "codesys").filter((t) => !isTrivia(t.kind) && t.kind !== "eof"))

function plcScope(plc: Bound): Scope | undefined {
  const unit = plc.parsed.parseResult.units[0]
  return unit === undefined ? undefined : scopeForUnit(plc.project, unit)
}

function crossCheckBuildTypes(f: FixtureSources, vendor: Dialect, files: readonly Bound[], c: BoundCensus): void {
  const build = vendor === "codesys" ? f.codesys : f.twincat
  if (build === undefined) return
  const name = f.test.name
  const key = (what: string): string => `build ${vendor}: ${what}`
  const says = vendorSays(build)
  const stores = files.flatMap((b) => storesOf(b, says))
  // each store explains ONE copy of a message: it is used up by the message it explains — but a WARNING the IDE says twice
  // (`Store.warnedTwice`) is used up by its second copy
  const unused = new Set(stores)
  const warnedOnce = new Set<Store>()
  const refused = new Set<Store>()
  // an override whose parameter differs from its base method's: the vendor says the parameter's conversion beside it,
  // "Cannot convert type 'DINT' to type 'INT'" — a signature, not a store (rule H10, `analysis/checks/oop/method-signature`
  // says it; `inh_override_signature_mismatch`, `_section_mismatch`, `_pointer_only`, both vendors)
  const overrides = build.diagnostics.some((d) => /^Interface of overridden method '.+' of base '.+' doesn't match declaration$/.test(d.message))
  const unreadBody = files.some((b) => allUnits(b.parsed.parseResult.units).some((u) => unitBodies(u).some((body) => !isStBody(body))))
  for (const d of build.diagnostics) {
    const m = TYPE_MESSAGES.map((r) => r.exec(d.message)).find((x) => x !== null)
    if (m === undefined || m === null) continue
    tally(c.types, key("type messages recorded"))
    const [x, y] = [typeKey(m[1]), typeKey(m[2])]
    const warning = !m[0].startsWith("Cannot convert")
    const again = warning ? [...warnedOnce].find((s) => s.target === y && s.value.has(x)) : undefined
    if (again !== undefined) {
      warnedOnce.delete(again)
      tally(c.types, key("explained by the inferred types, said twice for an initializer"))
      continue
    }
    const by =
      [...unused].find((s) => s.target === y && s.value.has(x)) ??
      (vendor === "twincat" ? [...unused].find((s) => s.reversedOnTwincat === true && s.target === x && s.value.has(y)) : undefined)
    if (by !== undefined) {
      unused.delete(by)
      if (warning && by.warnedTwice === true) warnedOnce.add(by)
      if (m[0].startsWith("Cannot convert")) refused.add(by)
      tally(c.types, key("explained by the inferred types"))
    } else if (overrides && m[0].startsWith("Cannot convert"))
      tally(c.types, key("explained by an override's parameter (H10)"))
    // a NETWORK body (FBD/LD network text) is no ST the census walks (`storesOf` reads ST bodies): its sinks and boxes are
    // the network checks' (`cc_vg_*`, `ng_sink_type_mismatch`, `network_unnamed_*`). Each such message is NAMED, fixture and
    // text, never one blanket count: the fixture's ST files are read, and a mismatch in one of them must show here as a new
    // entry rather than vanish into the tally (step 4.7.4 review)
    else if (unreadBody)
      tally(c.types, key(`in a fixture with a network body (not ST, which this census reads): ${name}: ${d.message}`))
    else
      c.typeDisagreements.push(
        `${vendor} ${name}: build says ${JSON.stringify(d.message)} — ${
          stores.some((s) => s.target === y && s.value.has(x)) ? "once more than" : "no"
        } store the front-end types ${m[1]} → ${m[2]}`,
      )
  }
  // a COMPARISON whose operands meet in no type the vendor refuses as one: "Cannot compare type 'BOOL' with type 'INT'"
  // refuses the store of the one operand into their meet (`expr_comparison_chain_same_level`, both vendors,
  // frontend-conformance 2.5)
  const compared = new Set(
    build.diagnostics.flatMap((d) => {
      const m = /^Cannot compare type '(.+)' with type '(.+)'$/.exec(d.message)
      return m === null ? [] : [`${typeKey(m[1]!)}|${typeKey(m[2]!)}`, `${typeKey(m[2]!)}|${typeKey(m[1]!)}`]
    }),
  )
  // the other way: a store the front-end calls not implicitly convertible must be one the vendor refused
  const refusedPairs = new Set(
    build.diagnostics.flatMap((d) => {
      const m = /^Cannot convert type '(.+)' to type '(.+)'$/.exec(d.message)
      return m === null ? [] : [`${typeKey(m[1]!)}|${typeKey(m[2]!)}`]
    }),
  )
  for (const s of stores) {
    if (s.conversion !== "incompatible") continue
    tally(c.types, key("stores typed not implicitly convertible"))
    if (refused.has(s)) tally(c.types, key("stores typed not implicitly convertible, refused"))
    // TwinCAT prints ONE copy of a message per line (`analysis/diagnostics` `dedupePerLine`): a second store of the pair
    // on a line it already refused is refused too (`cb_and_then_bool_and_int`: `ba AND_THEN a` into a BOOL)
    else if (vendor === "twincat" && [...s.value].some((v) => refusedPairs.has(`${v}|${s.target}`)))
      tally(c.types, key("stores typed not implicitly convertible, refused once per line"))
    else if (s.compared !== undefined && compared.has(s.compared))
      tally(c.types, key("stores typed not implicitly convertible, refused as a comparison"))
    else
      c.typeDisagreements.push(
        `${vendor} ${name}: the front-end types a store ${s.printed}, not implicitly convertible — no recorded refusal is left for it`,
      )
  }
}

function crossCheckRunTypes(f: FixtureSources, plc: Bound, c: BoundCensus): void {
  const name = f.test.name
  const values = RUN[name]?.values
  if (values === undefined) return
  const scope = plcScope(plc)
  for (const [path, value] of Object.entries(values)) {
    tally(c.types, "run: recorded values")
    const recorded = recordedType(value)
    if (recorded === undefined) {
      tally(c.types, "run: value names no type")
      continue
    }
    const expr = pathExpr(path)
    if (expr === undefined || scope === undefined) {
      c.typeDisagreements.push(`${name}: run path ${path} cannot be read in PLC_PRG`)
      continue
    }
    const type = inferExprType(expr, scope, plc.project)
    const inferred = renderType(type)
    // AN ENUM HOLDING A VALUE NO MEMBER NAMES is printed as a literal of its BASE type: `e := 5` leaves `INT#5` where a
    // member prints `E.On` (`prag_enum_not_strict_literal_not_a_member_assign`, `prag_to_string_not_a_member`, CODESYS
    // 2026-10-02) — the printed prefix is the value's representation there, not the variable's type. An enum with no base
    // is INT, so only `INT#…` is its base there; any other prefix is a disagreement.
    if (type.kind === "enum" && recorded === (type.base === undefined ? "INT" : renderType(type.base))) {
      tally(c.types, "run: an enum holding a value no member names, printed as its base type")
      continue
    }
    if (inferred === "?") {
      // a member the instance's FB INHERITS, read through the instance (`inst.baseField`) — counted apart, its owner named,
      // so a measure it would raise says why; rule H2 closed it (task 3.2.3, `infer/member` `lookupMember`: 41 → 0)
      tally(c.types, inheritedThroughInstance(expr, scope, plc.project) ? INHERITED_THROUGH_INSTANCE : "run: path inferred UNKNOWN")
      c.typeDisagreements.push(`${name}: run path ${path} is ${recorded}, inferred UNKNOWN`)
    } else if (sameType(recorded, inferred)) tally(c.types, "run: path inferred as recorded")
    else c.typeDisagreements.push(`${name}: run path ${path} is ${recorded}, inferred ${inferred}`)
  }
}

const INHERITED_THROUGH_INSTANCE = "run: path inferred UNKNOWN, an inherited member through an instance (H2, task 3.2.3)"

/** `inst.m` where `m` is no member of the instance's FB itself but of a base it extends. */
function inheritedThroughInstance(expr: Expr, scope: Scope, project: Scope): boolean {
  if (expr.kind !== "member") return false
  const base = inferExprType(expr.base, scope, project)
  if (base.kind !== "function_block" || base.scope === undefined) return false
  return lookupLocal(base.scope, expr.member.name).length === 0 && lookupMember(base.scope, expr.member.name) !== undefined
}

// ─── folds ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Every name a body of `files` mentions — a variable, a member, a parameter — lower-cased. */
function namesInBodies(files: readonly Bound[]): Set<string> {
  const out = new Set<string>()
  const add = (e: Expr): void => {
    switch (e.kind) {
      case "ident_expr":
        out.add(e.name.toLowerCase())
        return
      case "member":
        out.add(e.member.name.toLowerCase())
        return add(e.base)
      case "call":
        for (const a of e.args) if (a.param !== undefined) out.add(a.param.name.toLowerCase())
        break
    }
    for (const x of valueExprs(e).slice(1)) add(x)
    if (e.kind === "call") add(e.callee)
  }
  for (const b of files) for (const s of sites(b)) if (s.where === "body") add(s.expr)
  return out
}

/** A recorded value against a fold, or undefined when the value's type is not one a fold can be compared with. A string is
 *  printed as its literal (`'a$Tb'`, a WSTRING `"hel"`) and compared decoded. */
function sameValue(recorded: string, folded: bigint | number | boolean | string): boolean | undefined {
  const quoted = /^('|")(.*)\1$/s.exec(recorded)
  if (quoted !== null) return typeof folded === "string" ? decodeStringLiteral(quoted[2]!, quoted[1] === '"') === folded : undefined
  if (typeof folded === "string") return undefined
  const m = /^([A-Za-z_]+)#(.*)$/.exec(recorded)
  if (recorded === "TRUE" || recorded === "FALSE") {
    const b = typeof folded === "bigint" ? folded !== 0n : folded
    return b === (recorded === "TRUE")
  }
  if (m === null) return undefined
  const facts = elementaryType(m[1])
  if (facts === undefined) return undefined
  const text = m[2]
  if (facts.family === "int" || facts.family === "bitstring") {
    const based = /^(2|8|16)#([0-9A-Fa-f_]+)$/.exec(text)
    const digits = (based === null ? text : based[2]).replace(/_/g, "")
    const radix = based === null ? "" : based[1] === "2" ? "0b" : based[1] === "8" ? "0o" : "0x"
    const v = BigInt(`${radix}${digits}`)
    return typeof folded === "bigint"
      ? folded === v
      : typeof folded === "number"
        ? BigInt(Math.trunc(folded)) === v && Number.isInteger(folded)
        : undefined
  }
  if (facts.family === "real") {
    const r = Number(text)
    const v = typeof folded === "bigint" ? Number(folded) : typeof folded === "number" ? folded : undefined
    if (v === undefined) return undefined
    return facts.bits === 32 ? Math.fround(v) === Math.fround(r) : v === r
  }
  return undefined
}

/** Is every step before the last a declared variable with no initializer of its own (and no FB_Init arguments)? */
function throughPlainDeclarations(expr: Expr, scope: Scope, project: Scope): boolean {
  if (expr.kind === "ident_expr") return true
  if (expr.kind !== "member") return false
  const base = resolveMemberChain(expr.base, scope, project)?.ast
  if (base === undefined || base.kind !== "var_decl" || base.init !== undefined) return false
  if (base.type.kind === "named_type" && base.type.initArgs !== undefined) return false
  return throughPlainDeclarations(expr.base, scope, project)
}

function crossCheckFolds(f: FixtureSources, plc: Bound, files: readonly Bound[], c: BoundCensus): void {
  const values = RUN[f.test.name]?.values
  if (values === undefined) return
  const scope = plcScope(plc)
  if (scope === undefined) return
  const named = namesInBodies(files)
  for (const [path, value] of Object.entries(values)) {
    tally(c.folds, "run: recorded values")
    const skip = (why: string): void => tally(c.folds, `run: not asked, ${why}`)
    const expr = pathExpr(path)
    if (expr === undefined) {
      skip("the path does not read as an expression")
      continue
    }
    const sym: Symbol | undefined = resolveMemberChain(expr, scope, plc.project)
    const decl = sym?.ast
    if (sym === undefined || decl === undefined) {
      skip("the path resolves to no declaration")
      continue
    }
    if (decl.kind !== "var_decl" || decl.init === undefined || decl.init.kind === "aggregate_init") {
      skip("the declaration holds no scalar initializer")
      continue
    }
    if (named.has(sym.name.toLowerCase())) {
      skip("a body names the variable")
      continue
    }
    // a value reached through a declaration that initializes it — `inst : FB(x := 1)`, `a : ARRAY… := [...]`, an
    // indexed element — is that declaration's, not the member's own initializer
    if (!throughPlainDeclarations(expr, scope, plc.project)) {
      skip("reached through an initializing declaration")
      continue
    }
    // NOT `constancyOf`: that is the fold's own verdict, and a filter by the code under test hid every initializer it called
    // undecidable (a built-in it does not fold, `LEN('abc')`) as "not asked" instead of "does not fold" (step 4d review)
    // `__POSITION()`'s text ('Line 5 (Decl)', `sysop_position_value`) is the IDE's line in its own object, which no fold
    // here computes
    if (decl.init.kind === "call" && decl.init.callee.kind === "ident_expr" && decl.init.callee.name.toUpperCase() === "__POSITION") {
      skip("__POSITION's text — niche: accepted loss (0 occurrences in the corpora)")
      continue
    }
    if (readsRuntime(decl.init, sym.owner)) {
      skip("the initializer reads a variable, an element or a project function")
      continue
    }
    tally(c.folds, "run: recorded values still holding their initializer")
    const folded = declaredValue(sym)
    if (folded === undefined) {
      tally(c.folds, "run: initializer does not fold")
      // CODESYS has a value, the front-end none — a disagreement as much as a wrong value
      c.foldDisagreements.push(`${f.test.name}: ${path} is ${value}, the initializer does not fold`)
      continue
    }
    // a recorded ENUM value (`E.Run`) names a member, not a number: the only number for it here is the fold under test's
    // own (`E.B` folded is what `e : E := E.B` folds to), so a systematic error in member folding would still "match" —
    // not comparable until a recording gives the member's number independently (step 4d review 2)
    const same = sameValue(value, folded)
    if (same === undefined) tally(c.folds, "run: value not comparable with a fold")
    else if (same) tally(c.folds, "run: fold equals the recorded value")
    else
      c.foldDisagreements.push(
        `${f.test.name}: ${path} is ${value}, the initializer folds to ${typeof folded === "bigint" ? `${folded}` : String(folded)}`,
      )
  }
}

/** The symbol kinds that hold a value an initializer can read. */
const VALUE_KINDS: ReadonlySet<string> = new Set(["var", "gvl_var", "struct_field", "method_param"])

/**
 * Does an initializer read something only the init step can — a variable (not a CONSTANT), an element, a dereference, or a
 * call of a function the project declares? Asked of the AST and name resolution, never of the fold: what is left is what a
 * fold must answer, and one it does not is a finding.
 */
function readsRuntime(e: Expr, scope: Scope): boolean {
  const value = (sym: Symbol | undefined): boolean => sym !== undefined && sym.constant !== true && VALUE_KINDS.has(sym.kind)
  switch (e.kind) {
    case "literal":
      return false
    case "paren":
      return readsRuntime(e.inner, scope)
    case "unary":
      return readsRuntime(e.operand, scope)
    case "binary":
      return readsRuntime(e.left, scope) || readsRuntime(e.right, scope)
    case "ident_expr":
      return value(lookup(scope, e.name)?.symbol)
    case "member":
      return value(resolveMemberChain(e, scope, rootOf(scope)))
    case "call":
      return (
        (e.callee.kind === "ident_expr" && lookup(scope, e.callee.name) !== undefined) ||
        e.args.some((a) => a.value !== undefined && readsRuntime(a.value, scope))
      )
    default:
      return true
  }
}

/** The expression kinds that start with — and are built on — the name at their root. */
const ON_ITS_ROOT_NAME: ReadonlySet<string> = new Set(["ident_expr", "index", "member", "deref"])

/**
 * The shape of every member in `exprs`, asked of the AST: `rootOf` maps a member name's position (`.m` in `a[i].m`) to
 * the position of the bare name its chain starts at — through members, indices, dereferences, a call's callee and
 * parentheses, never an argument or a subscript — and `qualifiers` holds the position of every bare name that is a
 * member's base (`GVL` in `GVL.g`, `GVL.f()`). Positions as the dumps write them (`at`).
 */
export function memberShapes(exprs: readonly Expr[]): { rootOf: Map<string, string>; qualifiers: Set<string> } {
  const rootOf = new Map<string, string>()
  const qualifiers = new Set<string>()
  const visit = (e: Expr): void => {
    if (e.kind === "member") {
      const root = rootName(e)
      if (root !== undefined) rootOf.set(at(e.member.span), at(root.span))
      if (e.base.kind === "ident_expr" || e.base.kind === "global_expr") qualifiers.add(at(e.base.span))
    }
    // a callee is no value (`valueChildren`), but a member called (`GVL.f()`) is a member all the same
    const args = e.kind === "call" ? e.args.flatMap((a) => (a.value === undefined ? [] : [a.value])) : []
    for (const child of e.kind === "call" ? [e.callee, ...args] : valueChildren(e)) visit(child)
  }
  exprs.forEach(visit)
  return { rootOf, qualifiers }
}

/**
 * Each member access's BASE as a vendor's "no component" message can name it — as written (`bx`) and by its type
 * (`DUT_LANG_…`), lower case — keyed by the member's site (`at`).
 */
function memberBases(b: Bound): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const { expr, scope } of sites(b)) {
    const visit = (e: Expr): void => {
      if (e.kind === "member") {
        const names = [exprText(e.base).toLowerCase()]
        if (scope !== undefined) {
          const t = inferExprType(e.base, scope, b.project)
          names.push(renderType(t).toLowerCase())
          // the vendor names a REFERENCE's target, and an interface's member set `<ITF>__Union` (rule M1,
          // `mem_unknown_member_through_reference`, `mem_unknown_method_of_interface`, frontend-conformance 3.5)
          if (t.kind === "reference") names.push(renderType(t.target).toLowerCase())
          if (t.kind === "interface") names.push(`${t.name}__union`.toLowerCase())
          // …and a STEP of an SFC chart is an SFCStepType, whose name the vendor gives ("'y' is no component of 'SFCStepType'") though no
          // declaration in the text types the step (`types/infer/sfc-step`, DIALECT D40)
          if (isSfcStepBase(e, scope, b.project)) names.push("sfcsteptype")
        }
        out.set(at(e.member.span), names)
      }
      const args = e.kind === "call" ? e.args.flatMap((a) => (a.value === undefined ? [] : [a.value])) : []
      for (const child of e.kind === "call" ? [e.callee, ...args] : valueChildren(e)) visit(child)
    }
    visit(expr)
  }
  return out
}

/** The bare name an access chain starts at, or undefined when it starts at no name (a literal, a parenthesised sum). */
function rootName(e: Expr): Extract<Expr, { kind: "ident_expr" }> | undefined {
  for (;;) {
    if (e.kind === "ident_expr") return e
    if (e.kind === "member" || e.kind === "index" || e.kind === "deref") e = e.base
    else if (e.kind === "call") e = e.callee
    else if (e.kind === "paren") e = e.inner
    else return undefined
  }
}

/** Whether `expr` is a bare name that binds to a GVL — the list itself, not one of its variables. */
function namesAGvl(expr: Expr, scope: Scope | undefined): boolean {
  // `GVL`, `.GVL` in the global namespace (rule E33, `ARRAY [1...L_MC1P_Constants.gc_Rec_Max]`) and `Ns.GVL` in a
  // library's namespace (`sym_library_gvl_qualified_fully`) — the qualifier `symbols/scope-nav` `gvlBlockOf` reads
  return scope !== undefined && gvlBlockOf(expr, scope, rootOf(scope)) !== undefined
}

/** The operators that take a TYPE NAME as their operand. */
const TAKE_A_TYPE_NAME: ReadonlySet<string> = new Set(["SIZEOF", "XSIZEOF", "__NEW"])

/** Every `ident_expr` of `b` that names a TYPE as the operand of `TAKE_A_TYPE_NAME` — an elementary type, or one the name
 *  resolves to where it is written. */
function typeNameOperands(b: Bound): ReadonlySet<Expr> {
  const out = new Set<Expr>()
  for (const { expr: site, scope } of sites(b))
  for (const expr of valueExprs(site)) {
    if (scope === undefined || expr.kind !== "call" || expr.callee.kind !== "ident_expr" || !TAKE_A_TYPE_NAME.has(expr.callee.name.toUpperCase())) continue
    for (const a of expr.args) {
      const v = a.value
      if (v?.kind !== "ident_expr") continue
      const named = resolveTypeExpr({ kind: "named_type", name: { kind: "identifier", text: v.name, span: v.span }, span: v.span }, b.project, 0, scope)
      if (isElementaryTypeName(v.name) || named.kind !== "unknown") out.add(v)
    }
  }
  return out
}

/** The operators whose result type is made from their operand: SIZEOF's from its size, ADR's from its type. */
const TYPED_BY_THEIR_OPERAND: ReadonlySet<string> = new Set(["SIZEOF", "ADR"])

/**
 * A call of `TYPED_BY_THEIR_OPERAND`, by its operand — undefined for any other expression. Since frontend-conformance 4.3.4
 * the front-end types ADR (POINTER TO its operand's type) and SIZEOF of a size it can count (`types/builtins`
 * `scalarStorageBytes`); what is left UNKNOWN is SIZEOF of a STRUCT or an FB, whose layout is the transpiler's memory model,
 * and ADR of no value (a device instance, a malformed address). The keys keep their names — a ceiling's name is its id —
 * and the census tells the two reasons apart:
 *
 *   false  every operand has no type — a value inferred UNKNOWN, or a name that resolves to no type
 *          (`SIZEOF(OpcUa_Boolean)` over a library the corpus does not materialize): no rule for the operator could type
 *          it, and the operand is counted where it stands — its UNKNOWN is the operand's, as an index or member built on
 *          an undefined root is the root's;
 *   true   an operand has a type, and the operator's rule is what is missing — counted apart, for 4.3.4 to close.
 *
 * Told apart since frontend-conformance 2.3: `[SIZEOF(T)]` in an array initializer was misread as a repeat count NAMED
 * SIZEOF (an `ident_expr` UNKNOWN) and is the call it is now (`parse/initializer`) — 112 corpus library declarations.
 */
function operandTyped(expr: Expr, scope: Scope | undefined, b: Bound): boolean | "type-name" | undefined {
  if (expr.kind !== "call" || expr.callee.kind !== "ident_expr" || scope === undefined) return undefined
  if (!TYPED_BY_THEIR_OPERAND.has(expr.callee.name.toUpperCase())) return undefined
  const operands = expr.args.flatMap((a) => (a.value === undefined ? [] : [a.value]))
  if (operands.length === 0) return undefined
  if (operands.some((v) => inferExprType(v, scope, b.project).kind !== "unknown")) return true
  // a NAME no value types may be a TYPE: `SIZEOF(T)`. The PROJECT is the root and the scope is where the name is written —
  // they were passed the other way round, which read the dialect off a POU scope (none) and found no project type at all;
  // it failed loud once the target is read off the root (frontend-conformance 4.1.1)
  const typeName = (v: Expr): boolean =>
    v.kind === "ident_expr" &&
    resolveTypeExpr({ kind: "named_type", name: { kind: "identifier", text: v.name, span: v.span }, span: v.span }, b.project, 0, scope).kind !== "unknown"
  if (!operands.some(typeName)) return false
  // an ELEMENTARY type's name was typed by the old reading too (no project type needed) — kept in the measure it was in
  return operands.some((v) => v.kind === "ident_expr" && isElementaryTypeName(v.name)) ? true : "type-name"
}

/** A target the front-end cannot type, named as WRITTEN — `out : LDATE` on TwinCAT, which has no LDATE, is the target the
 *  vendor names "…to type 'LDATE'" (`xp_*_to_ldate`, task 4.5.3); undefined for a typed target or an unnamed one. */
function unknownTarget(resolved: Type, written: TypeExpr): string | undefined {
  return resolved.kind === "unknown" && written.kind === "named_type" && written.qualifiers === undefined ? written.name.text : undefined
}

/** Is `name`, bound in `scope`, a variable declared of a named type the vendor names unknown? */
function declaredTypeUnknown(name: string, scope: Scope, unknownTypes: ReadonlySet<string>): boolean {
  const t = lookup(scope, name)?.symbol.typeExpr
  return t?.kind === "named_type" && unknownTypes.has(t.name.text)
}

/** Is `expr` untyped only for its project's unknown TARGET — typed, were the project 64-bit? Asked of the bound project
 *  itself, its environment swapped for the length of one inference. */
function typedOnASixtyFourBitTarget(expr: Expr, scope: Scope, b: Bound): boolean {
  const project = b.project
  if (project.environment?.target !== undefined) return false
  const saved = project.environment
  project.environment = { ...saved, target: { pointerBits: 64 } }
  try {
    return inferExprType(expr, scope, project).kind !== "unknown"
  } finally {
    if (saved === undefined) delete project.environment
    else project.environment = saved
  }
}

/** The POUs a call can name whose declaration states no return type. */
const MAY_RETURN_NOTHING: ReadonlySet<string> = new Set(["function", "method", "action", "program"])

/**
 * A call whose callee is a function, method, action or program declared with no return type: it has no value. A
 * return type WRITTEN and refused by the parser (`METHOD M : final`, `FUNCTION F : __VECTOR[4] OF REAL` on TwinCAT) is
 * no such declaration: its calls stay UNKNOWN (`returnTypeRefused`).
 */
function returnsNothing(expr: Expr, scope: Scope | undefined, b: Bound): boolean {
  if (expr.kind !== "call" || scope === undefined) return false
  const callee = resolveMemberChain(expr.callee, scope, b.project)
  if (callee === undefined || !MAY_RETURN_NOTHING.has(callee.kind) || callee.typeExpr !== undefined) return false
  return !("returnTypeRefused" in callee.ast && callee.ast.returnTypeRefused === true)
}

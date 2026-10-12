/**
 * THE CENSUS'S UNTYPED EXPRESSIONS (0.4) — every expression of a bound file counted, and each one the front-end types
 * UNKNOWN or NOSCOPE counted by why: an agreement with the vendor's own answer, or a gap. What the census counts
 * (`BoundCensus`) and what a vendor's build says (`VendorFacts`) live here too. One concern of `bound-census.ts` (openspec
 * lsp-same-standard 4.4).
 */
import { bodyConditionWorld, gvlBlockOf } from "../../src/frontend/symbols/index.js"
import { isElementaryTypeName, resolveBareName } from "../../src/frontend/types/index.js"
import {
  allUnits,
  bodyStatements,
  compilerExprText,
  inferExprType,
  isStBody,
  lookup,
  resolveMemberChain,
  resolveTypeExpr,
  rootOf,
  unitBodies,
  walkExpr,
  walkStatements,
  type Expr,
  type Scope,
} from "../../src/index.js"
import { tally } from "../baseline/baseline.js"
import { isSignedUntypedNumber } from "./bound-census-stores.js"
import { undecidedExprCount, typeRows, sites, valueExprs } from "./dumps-bound.js"
import { type Bound, at } from "./dumps.js"

/**
 * THE CENSUS'S UNTYPED EXPRESSIONS (0.4) — every expression of a bound file counted, and each one the front-end types
 * UNKNOWN or NOSCOPE counted by why: an agreement with the vendor's own answer, or a gap. What the census counts
 * (`BoundCensus`) and what a vendor's build says (`VendorFacts`) live here too. One concern of `bound-census.ts` (openspec
 * lsp-same-standard 4.4).
 */
export interface BoundCensus {
  resolution: Record<string, number>
  /** Every fixture occurrence that binds to nothing — few enough to pin one by one. */
  fixtureUnresolved: string[]
  types: Record<string, number>
  typeDisagreements: string[]
  folds: Record<string, number>
  foldDisagreements: string[]
}

/**
 * What a fixture's build says, as the census asks it of one vendor:
 *
 * `known` when `support/divergences.ts` already pins the fixture as disagreeing with that build (the suite replays it as an
 * expected failure and fails the day it agrees), so its resolution and types are held there, once, and only counted here;
 * `notDefined`, the names that build reports "Identifier 'x' not defined" — a bare name that binds to NONE, or is typed
 * UNKNOWN, there AGREES with the oracle (0.3 asks whether the LSP says "not defined" exactly where the vendor does), so it
 * is counted, not a finding; `unknownTypes`, every text that build names "Unknown type: '<text>'" (alone or inside a
 * "Cannot convert") — an expression typed UNKNOWN whose compiler echo is one of them is untyped on the vendor too: the
 * build says so of THAT expression (`ABS(%M?0.1)`, `(INT#0 - E#V)`, frontend-conformance 2.2b), so it is counted, not an
 * UNKNOWN.
 */
export interface VendorFacts {
  known: boolean
  notDefined: ReadonlySet<string>
  noComponent: ReadonlySet<string>
  unknownTypes: ReadonlySet<string>
  /** every message the vendor recorded, lower case; undefined when it recorded no build (`dumps.ts` `unparsedIn`) */
  says: ReadonlySet<string> | undefined
}

/** Where in one bound file the vendor's answer is no question for 0.3/0.4 (`siteFacts`). */
export interface SiteFacts {
  refused: (e: Expr) => boolean
  refusedNames: Set<string>
  unparsed: (e: { span: { start: number; end: number } }) => boolean
  unparsedSites: Set<string>
  shapes: { rootOf: Map<string, string>; qualifiers: Set<string> }
  bases: Map<string, string[]>
  bitRefusedSites: Set<string>
}

/** What one type row is asked against (`untypedKey`). */
interface TypeRowContext {
  group: string
  b: Bound
  vendor: VendorFacts
  facts: SiteFacts
  agreed: ReadonlySet<string>
  noComponentSites: ReadonlySet<string>
  invalidStatement: (e: Expr) => boolean
  typeOperands: ReadonlySet<Expr>
}

/** 0.4's types: every expression of `b`, and each one typed UNKNOWN or NOSCOPE counted by why (`untypedKey`). */
export function countTypes(
  c: BoundCensus,
  group: string,
  b: Bound,
  vendor: VendorFacts,
  facts: SiteFacts,
  agreed: ReadonlySet<string>,
  noComponentSites: ReadonlySet<string>,
): void {
  // …and the expressions of a statement the vendor says is NO VALID STATEMENT (`'(a + 1);' is no valid statement`): it
  // types nothing there — its echo leaves the literal untyped, `(a + 1)`, where a typed operation reads `(a + INT#1)`
  // (`stmt_bare_binary`, `stmt_case_nonconst_label`, both vendors, frontend-conformance 2.6)
  const invalidStatement = noValidStatementsIn(b, vendor.says)
  const undecided = vendor.known ? 0 : undecidedExprCount(b)
  if (undecided > 0) tally(c.types, `${group}: expressions in a conditional branch Volt cannot decide, not measured`, undecided)
  // a TYPE named where an operator takes one — `SIZEOF(LINT)`, `XSIZEOF(DINT)`, `__NEW(T)` — is no value and has no type
  // to ask for, on either side (rules AR23/AR24)
  const typeOperands = typeNameOperands(b)
  if (vendor.known) return
  const ctx: TypeRowContext = { group, b, vendor, facts, agreed, noComponentSites, invalidStatement, typeOperands }
  for (const { expr, scope, line } of typeRows(b)) {
    const [where, kind, ...rest] = line.split(" ")
    const type = rest.join(" ")
    tally(c.types, `${group}: expressions`)
    if (type !== "?" && type !== "NOSCOPE") continue
    tally(c.types, untypedKey(ctx, expr, scope, where!, kind!, type) ?? untypedKeyContinued(ctx, expr, scope, kind!, type))
  }
}

/** The key an expression typed UNKNOWN (`?`) or NOSCOPE is counted under — its first reasons; `untypedKeyContinued` the rest. */
function untypedKey(ctx: TypeRowContext, expr: Expr, scope: Scope | undefined, where: string, kind: string, type: string): string | undefined {
  const { group, b, vendor, facts, agreed } = ctx
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
  if (type === "?" && isSignedUntypedNumber(expr)) return `${group}: unary UNKNOWN, a signed untyped number (context-typed, as a literal)`
  if (ctx.invalidStatement(expr)) return `${group}: ${kind} untyped, no valid statement on the vendor too`
  // a refused expression (`dumps.ts` `refusedIn`) has no type to ask for; an undefined name the vendor also
  // reports undefined has none either, nor does an index, member or dereference BUILT on it (`vec4[0]` over an
  // undefined `vec4` starts where `vec4` does); and a call to a POU that returns nothing has no value — each
  // counted, none an UNKNOWN. Where a value belongs (`x := m.NoRet();`) the vendor says the same: "Cannot convert
  // type 'Unknown type: 'm.NoRet()'' to type 'INT'" (`refuse_method_no_result`), and the LSP agrees.
  if (facts.refused(expr)) return `${group}: ${kind} untyped, a refused expression`
  if (facts.unparsed(expr)) return `${group}: ${kind} untyped, in a body that did not parse`
  if (ON_ITS_ROOT_NAME.has(kind) && agreed.has(where)) return `${group}: ${kind} UNKNOWN, not defined on the vendor too`
  if (type === "?" && returnsNothing(expr, scope, b)) return `${group}: call with no return value`
  // a GVL's NAME qualifying its variable (`GVL.g`) is no value on either side — it names where `g` is, and has no
  // type to ask for (`use_gvl_field_access`, `decl_at_after_type_in_gvl`, frontend-conformance 2.3)
  if (type === "?" && facts.shapes.qualifiers.has(where) && namesAGvl(expr, scope)) return `${group}: ${kind} untyped, a GVL's name qualifying its variable`
  // a device-tree instance (rule Y24) is a name its `.device` descriptor states and nothing else, so the front-end has no
  // type to give it — but the vendor types it (`EtherCAT_Master.xRestart` builds, `sym_device_instance_bare`): a GAP, not
  // an agreement, so the key says UNKNOWN and is ceilinged like every other one (frontend-conformance 3.1 review)
  if (type === "?" && expr.kind === "ident_expr" && scope !== undefined && resolveBareName(scope, expr.name).kind === "device")
    return `${group}: ${kind} UNKNOWN, a device instance (the front-end lacks the type the vendor gives it)`
  // what the vendor reports unknown too is that agreement before it is anything else: the SIZEOF/ADR split below
  // is the LSP's own reason, and ahead of this it took agreements out of their measure
  if (type === "?" && vendor.unknownTypes.has(compilerExprText(expr))) return `${group}: ${kind} UNKNOWN, unknown on the vendor too`
  // a member the vendor reports no component of its base (0.3's `member NONE, no component on the vendor too`) has no
  // type there either, where the vendor names no unknown type for it: `PRG.S_Bot` is "'S_Bot' is no component of 'PRG_…'" (`sfc_step_typo_qualified`, lsp-sfc-step-names 1.1)
  if (type === "?" && expr.kind === "member" && ctx.noComponentSites.has(at(expr.member.span))) return `${group}: member UNKNOWN, no component on the vendor too`
  // …and a variable whose DECLARED TYPE the vendor names unknown — LDATE, LDT and LTOD on TwinCAT, which has none of
  // them ("Unknown type: 'LDATE'", the explicit-pair fixtures `xp_*ldate*`, `xp_*ldt*`, `xp_*ltod*`, task 4.5.3)
  if (type === "?" && expr.kind === "ident_expr" && scope !== undefined && declaredTypeUnknown(expr.name, scope, vendor.unknownTypes))
    return `${group}: ident_expr untyped, its declared type unknown on the vendor too`
  return undefined
}

/** The rest of `untypedKey`'s reasons, and the plain UNKNOWN / NOSCOPE count when none applies. */
function untypedKeyContinued(ctx: TypeRowContext, expr: Expr, scope: Scope | undefined, kind: string, type: string): string {
  const { group, b, vendor, facts } = ctx
  // a call of what the vendor says is no call target — "Program name, function or function block instance expected
  // instead of 'plain'" — has no result there either, as a statement too (`cc5_invalid_call_target`; the front-end
  // types such a call UNKNOWN since frontend-conformance 2.5b, `expr_global_namespace_call_non_callable`)
  if (type === "?" && expr.kind === "call" && vendor.says?.has(`program name, function or function block instance expected instead of '${compilerExprText(expr.callee).toLowerCase()}'`) === true)
    return `${group}: call untyped, no call target on the vendor too`
  // …and a call operator whose OPERANDS the vendor refuses — "'__QUERYINTERFACE' needs exactly '2' operands",
  // "Operand of __DELETE must be pointer" — gives the call no type there either (`lex_keyword_called_sys_delete`,
  // `_queryinterface`, `_querypointer`, both vendors, review 2.6)
  if (type === "?" && expr.kind === "call" && expr.callee.kind === "ident_expr" && operandsRefused(expr.callee.name, vendor.says))
    return `${group}: call untyped, its operands refused on the vendor too`
  // …and SUPER where the vendor does not allow it — a function block that extends nothing: "Expression SUPER is not
  // allowed in this context" (TwinCAT quotes it; `expr_super_without_deref_without_base`, `refuse_super_without_base`)
  if (
    type === "?" &&
    expr.kind === "ident_expr" &&
    expr.name.toUpperCase() === "SUPER" &&
    (vendor.says?.has("expression super is not allowed in this context") === true ||
      vendor.says?.has("expression 'super' is not allowed in this context") === true)
  )
    return `${group}: ident_expr untyped, SUPER not allowed on the vendor too`
  if (type === "?" && operandTyped(expr, scope, b) === false) return `${group}: call UNKNOWN, on an untyped operand`
  // …a SIZEOF of a TYPE NAME (`SIZEOF(SomeStruct)`), told apart from one of a typed expression since frontend-conformance
  // 4.1.1: the census resolved the name with the POU scope passed as the project, so a project type was "untyped"
  if (type === "?" && operandTyped(expr, scope, b) === "type-name") return `${group}: call UNKNOWN, SIZEOF of a type name (no result type yet, task 4.3.4)`
  if (type === "?" && operandTyped(expr, scope, b) === true) return `${group}: call UNKNOWN, SIZEOF or ADR (no result type yet, task 4.3.4)`
  // …and `__NEW`/`__DELETE` — `__NEW` is POINTER TO its type since 4.3.4, so what is left is `__DELETE`, whose value no
  // recording asks — split out when the five
  // TwinCAT `newdel_*` fixtures left KNOWN_DIVERGENCES (frontend-conformance 2.7.2: they diverged only because the
  // recorder had dropped their pragma) and their calls came to be measured: a reclassification, not a rise
  if (type === "?" && expr.kind === "call" && expr.callee.kind === "ident_expr" && /^__(new|delete)$/i.test(expr.callee.name))
    return `${group}: call UNKNOWN, __NEW or __DELETE (no result type yet, task 4.3.4)`
  // …and an expression over a TYPED LITERAL whose prefix names no type: `FOO#5 + n` is "'5' is no component of 'FOO'"
  // on CODESYS and nothing more — the operand has no type there, and neither has what is built on it
  // (`rec_unknown_literal_prefix_cascade`, frontend-conformance 2.8.3); the LSP says the same line
  if (type === "?" && expr.kind === "member" && facts.bitRefusedSites.has(at(expr.member.span))) return `${group}: member untyped, a bit access refused on the vendor too`
  if (type === "?" && unknownLiteralComponent(expr, vendor.says)) return `${group}: ${kind} UNKNOWN, no component on the vendor too`
  // …and arithmetic on a `strict` enum, which the vendor refuses — "Arithmetics not allowed on strict ENUM type 'X'"
  // — so the operation has no type there (`prag_strict_enum_add_literal`, both vendors, frontend-conformance 2.10;
  // the refusal itself is task 4.5.1's, `deferred.lsp`)
  if (type === "?" && expr.kind === "binary" && strictArithmeticRefused(expr, scope, b, vendor.says))
    return `${group}: binary untyped, arithmetic on a strict enum refused on the vendor too`
  // …and an expression the front-end WOULD type on a 64-bit target: a platform integer (`__XWORD`, `__UXINT`) has no
  // width in a project whose device's width nobody measured, so it — and what is built on it — is untyped there, by
  // the rule (`types/platform`, frontend-conformance 4.1.1). A GAP (TY6's), so the key says UNKNOWN and is ceilinged.
  if (type === "?" && ctx.typeOperands.has(expr)) return `${group}: ident_expr untyped, a type named where the operator takes one`
  if (type === "?" && scope !== undefined && typedOnASixtyFourBitTarget(expr, scope, b))
    return `${group}: ${kind} UNKNOWN, a platform integer on a target nobody measured (TY6)`
  return `${group}: ${kind} ${type === "?" ? "UNKNOWN" : "NOSCOPE"}`
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

/** Does the vendor refuse the operands of the call operator `name` — its count, or its operand's kind? */
export function operandsRefused(name: string, says: ReadonlySet<string> | undefined): boolean {
  const n = name.toLowerCase()
  return [...(says ?? [])].some((m) => m.startsWith(`'${n}' needs exactly `) || m.startsWith(`'${n}' needs at least `) || m.startsWith(`operand of ${n} must be`))
}

/** Does an expression stand in a bare-expression statement the vendor names "'<echo>;' is no valid statement"? */
export function noValidStatementsIn(b: Bound, says: ReadonlySet<string> | undefined): (e: Expr) => boolean {
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

/** The expression kinds that start with — and are built on — the name at their root. */
export const ON_ITS_ROOT_NAME: ReadonlySet<string> = new Set(["ident_expr", "index", "member", "deref"])

/** Whether `expr` is a bare name that binds to a GVL — the list itself, not one of its variables. */
export function namesAGvl(expr: Expr, scope: Scope | undefined): boolean {
  // `GVL`, `.GVL` in the global namespace (rule E33, `ARRAY [1...L_MC1P_Constants.gc_Rec_Max]`) and `Ns.GVL` in a
  // library's namespace (`sym_library_gvl_qualified_fully`) — the qualifier `symbols/scope-nav` `gvlBlockOf` reads
  return scope !== undefined && gvlBlockOf(expr, scope, rootOf(scope)) !== undefined
}

/** The operators that take a TYPE NAME as their operand. */
const TAKE_A_TYPE_NAME: ReadonlySet<string> = new Set(["SIZEOF", "XSIZEOF", "__NEW"])

/** Every `ident_expr` of `b` that names a TYPE as the operand of `TAKE_A_TYPE_NAME` — an elementary type, or one the name
 *  resolves to where it is written. */
export function typeNameOperands(b: Bound): ReadonlySet<Expr> {
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
export function operandTyped(expr: Expr, scope: Scope | undefined, b: Bound): boolean | "type-name" | undefined {
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

/** Is `name`, bound in `scope`, a variable declared of a named type the vendor names unknown? */
export function declaredTypeUnknown(name: string, scope: Scope, unknownTypes: ReadonlySet<string>): boolean {
  const t = lookup(scope, name)?.symbol.typeExpr
  return t?.kind === "named_type" && unknownTypes.has(t.name.text)
}

/** Is `expr` untyped only for its project's unknown TARGET — typed, were the project 64-bit? Asked of the bound project
 *  itself, its environment swapped for the length of one inference. */
export function typedOnASixtyFourBitTarget(expr: Expr, scope: Scope, b: Bound): boolean {
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
export function returnsNothing(expr: Expr, scope: Scope | undefined, b: Bound): boolean {
  if (expr.kind !== "call" || scope === undefined) return false
  const callee = resolveMemberChain(expr.callee, scope, b.project)
  if (callee === undefined || !MAY_RETURN_NOTHING.has(callee.kind) || callee.typeExpr !== undefined) return false
  return !("returnTypeRefused" in callee.ast && callee.ast.returnTypeRefused === true)
}

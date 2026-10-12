/**
 * ONE BOUND FILE, SUMMARIZED — its resolution (0.3) counted by shape and verdict, an agreement with the vendor's answer
 * apart, and its types and folds (0.4). One concern of `bound-census.ts` (openspec lsp-same-standard 4.4).
 */
import { isSfcStepBase } from "../../src/frontend/types/index.js"
import { exprText, inferExprType, isIntegerType, renderType, type Expr } from "../../src/index.js"
import { tally } from "../baseline/baseline.js"
import { countTypes, type BoundCensus, type SiteFacts, type VendorFacts } from "./bound-census-untyped.js"
import { foldDump, typeRows, sites, resolutionDump, valueChildren } from "./dumps-bound.js"
import { refusedIn, unparsedIn } from "./dumps-printer.js"
import { type Bound, at } from "./dumps.js"

/** Every kind of `Expr`, for the UNKNOWN counts (`summarize`). */
export const EXPR_KINDS: readonly Expr["kind"][] = [
  "ident_expr", "literal", "binary", "unary", "member", "index", "deref", "call", "paren", "assign_expr", "global_expr",
]

/** A corpus or library file's: no build to ask. */
export const NO_FACTS: VendorFacts = { known: false, notDefined: new Set(), noComponent: new Set(), unknownTypes: new Set(), says: new Set() }

/** One bound file's resolution (0.3), types and folds (0.4), counted into `c` under `group`; `pin` names a fixture's
 *  unresolved occurrences one by one (`BoundCensus.fixtureUnresolved`). */
export function summarize(c: BoundCensus, group: string, b: Bound, pin: string | undefined, vendor: VendorFacts = NO_FACTS): void {
  prefillKeys(c, group)
  if (vendor.known) {
    tally(c.resolution, `${group}: files of a known divergence (support/divergences.ts), not measured`)
    tally(c.types, `${group}: files of a known divergence (support/divergences.ts), not measured`)
  }
  const facts = siteFacts(b, vendor)
  const { agreed, noComponentSites } = countResolution(c, group, b, pin, vendor, facts)
  countTypes(c, group, b, vendor, facts, agreed, noComponentSites)
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

/** The keys a group measures at 0 too, so a ceiling that reached 0 can still say so. */
function prefillKeys(c: BoundCensus, group: string): void {
  // an expression kind whose UNKNOWNs all came to be typed is a count of 0, not a measure gone missing — its ceiling
  // must still be able to say so (`assign_expr`, typed by its target since frontend-conformance 2.5.6)
  for (const kind of EXPR_KINDS) c.types[`${group}: ${kind} UNKNOWN`] ??= 0
  c.types[`${group}: unary UNKNOWN, a signed untyped number (context-typed, as a literal)`] ??= 0
  // …and SIZEOF of a type name, all typed since transpile-restructure 6.A.31 (a STRUCT's is a UINT; the corpora's 48)
  c.types[`${group}: call UNKNOWN, SIZEOF of a type name (no result type yet, task 4.3.4)`] ??= 0
  // …and a name shape whose NONEs all came to resolve, the same way (`fixtures codesys: bare name NONE` 5 → 0: the five
  // were names in a conditional branch CODESYS does not compile, which the one statement tree no longer holds —
  // frontend-conformance 2.7.1)
  for (const shape of ["bare name", "member"]) c.resolution[`${group}: ${shape} NONE`] ??= 0
  // …and a named argument's: every NO-CALLEE and NONE of the fixtures came to resolve or agree (frontend-conformance 3.6)
  if (group.startsWith("fixtures ")) {
    c.resolution[`${group}: parameter NONE`] ??= 0
    c.resolution[`${group}: parameter NO-CALLEE`] ??= 0
  }
}

function siteFacts(b: Bound, vendor: VendorFacts): SiteFacts {
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
  return { refused, refusedNames, unparsed, unparsedSites, shapes, bases, bitRefusedSites }
}

/** One resolution dump line, read (`countResolution`). */
interface ResolutionLine {
  line: string
  where: string
  name: string
  shape: string
  verdict: string
}

/** 0.3: every name site of `b`, counted by its shape and verdict — and `agreed`, the sites the vendor reports undefined
 *  too, and `noComponentSites`, the members it reports no component of their base (0.4 reads both). */
export function countResolution(
  c: BoundCensus,
  group: string,
  b: Bound,
  pin: string | undefined,
  vendor: VendorFacts,
  facts: SiteFacts,
): { agreed: Set<string>; noComponentSites: Set<string> } {
  const agreed = new Set<string>()
  const lines: ResolutionLine[] = vendor.known
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
  for (const l of lines) {
    const agreement = resolutionAgreement(group, l, vendor, facts, agreed, noComponentSites)
    if (agreement !== undefined) {
      tally(c.resolution, agreement)
      continue
    }
    tally(c.resolution, `${group}: ${l.shape} ${l.verdict}`)
    if (pin !== undefined && l.verdict !== "resolved") c.fixtureUnresolved.push(`${pin}${b.parsed.id} ${l.line}`)
  }
  return { agreed, noComponentSites }
}

/** The key a NONE the vendor's answer explains is counted under — undefined for any other line. */
function resolutionAgreement(
  group: string,
  { where, name, shape, verdict }: ResolutionLine,
  vendor: VendorFacts,
  facts: SiteFacts,
  agreed: ReadonlySet<string>,
  noComponentSites: Set<string>,
): string | undefined {
  if (verdict !== "NONE") return undefined
  if (facts.unparsedSites.has(where)) return `${group}: ${shape} NONE, in a body that did not parse`
  const bases = facts.bases.get(where) ?? []
  // a member the vendor reports no component of THIS base — "'GET' is no component of 'DUT_LANG_…'" naming the base's
  // type, "'END_IF' is no component of 'bx'" the base as written (`expr_member_named_*`, frontend-conformance 2.5) —
  // is unknown on both sides. Keyed by member AND base: the same member name off another base is no agreement.
  if (shape === "member" && bases.some((base) => vendor.noComponent.has(`${name.slice(1).toLowerCase()}|${base}`))) {
    noComponentSites.add(where)
    return `${group}: member NONE, no component on the vendor too`
  }
  // …and a member read off a base the vendor reports has NONE — "'SUPER^' is no structured variable", "'THIS' is no
  // structured variable" (`expr_super_without_base`, `expr_this_member_without_deref`, frontend-conformance 2.5.6)
  if (shape === "member" && bases.some((base) => vendor.says?.has(`'${base}' is no structured variable`) === true))
    return `${group}: member NONE, no structured variable on the vendor too`
  // …or off a SUPER the vendor does not allow at all — a function block that extends nothing: "Expression SUPER is
  // not allowed in this context" (TwinCAT quotes it), and `SUPER.Get` resolves on neither side
  // (`expr_super_without_deref_without_base`, frontend-conformance 2.5b)
  if (
    shape === "member" &&
    bases.includes("super") &&
    (vendor.says?.has("expression super is not allowed in this context") === true ||
      vendor.says?.has("expression 'super' is not allowed in this context") === true)
  )
    return `${group}: member NONE, SUPER not allowed on the vendor too`
  if (shape === "member" && facts.bitRefusedSites.has(where)) return `${group}: member NONE, a bit access refused on the vendor too`
  if (shape === "member" && agreed.has(facts.shapes.rootOf.get(where) ?? "")) return `${group}: member NONE, on a name not defined on the vendor too`
  if ((shape === "bare name" || shape === "global name" || shape === "parameter") && agreed.has(where))
    return `${group}: ${shape} NONE, not defined on the vendor too`
  if (shape === "bare name" && facts.refusedNames.has(where)) return `${group}: bare name NONE, a refused expression`
  return undefined
}

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
export function memberBases(b: Bound): Map<string, string[]> {
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

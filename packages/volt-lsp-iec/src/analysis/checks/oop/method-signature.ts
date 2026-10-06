/**
 * method-signature (oop/) — an overriding member whose signature doesn't match the one it overrides (rule H10):
 *   C0089 — an FB method vs the INTERFACE method it implements ("… of interface '<I>' does not match …").
 *   C0094 / C0568 — an FB method vs the BASE FB method it overrides ("… the overridden … of base '<B>' …"), and a
 *           PROPERTY vs the base's, worded as its accessor method (`'__GETP'`).
 *
 * THE SIGNATURE IS THE WHOLE PARAMETER LIST AND THE RESULT TYPE, as both vendors measure it (`fixtures/names/inheritance.ts`,
 * 2026-10-02): a parameter of another TYPE (`inh_override_signature_mismatch`), another NAME of the same type
 * (`_param_name_mismatch`), another SECTION (`_section_mismatch`), one more (`_param_count_mismatch`), and another
 * result type (`_return_type_mismatch`) each mismatch. This compared per-section COUNTS only, so four of the five read
 * as legal overrides. Every name in the sentence is UPPER-CASED, the method's and the base's (`'FETCH'`, recorded with a
 * method written `Fetch`).
 *
 * analysis-conformance 3.7 (`fixtures/oop/oop-rules-b.ts`, both vendors 2026-10-06): CODESYS counts the inputs, outputs and
 * inouts APART, the result among the outputs — another section or a result left out is its COUNT sentence, another result
 * type names the method as "the variable"; an interface method the FB INHERITS from its base is compared too; a PROPERTY's
 * SET of another type converts its value once; two VAR_OUTPUTs of other types convert nothing.
 *
 * The base is the one the symbol table LINKED (`extends.ts` — by precedence among same-named candidates, rule H8), the
 * nearest in the chain that declares the method; it was looked up by NAME, which under a project FB shadowing a
 * library's (`inh_extends_ambiguous_library_base`) is the library's. Library bases and interfaces (whose materialized
 * signatures are lossy) are skipped, as is a type nothing resolves (a library type's text is compared as written).
 *
 * ONLY AN FB THE VENDOR COMPILES is checked — reached from a PROGRAM, a FUNCTION or a GVL by an instance, a POINTER or a
 * REFERENCE TO it, or a base of one (`analysis/shared/compiled.ts`): an FB nothing reaches builds whatever its overrides say
 * (`inh_override_uninstanced`, `_instanced_in_uninstanced_fb`, `inh_interface_method_signature_mismatch_uninstanced`;
 * pro2193). The lifecycle methods (FB_init, FB_exit, FB_reinit) are each
 * FB's own and override nothing (a derived FB_init adds the inputs its instance is declared with).
 *
 * NOT SAID (frontend-conformance 3.2, known divergences): an override of a FINAL method (`inh_override_final_method`) and
 * a base's ABSTRACT method left unimplemented (`inh_abstract_method_not_implemented`). Both vendors' words are recorded;
 * what is missing is the CODESYS code number — a wire diagnostic is a catalog `Cnnnn` (`server/diagnostic-codes.ts`
 * admits no new slug) and a build message carries none.
 */
import {
  ancestry,
  findScopeByName,
  isLibrarySymbol,
  lookupLocal,
  lookupUnit,
  type Scope,
  scopeForUnit,
  scopeUri,
  type Symbol,
} from "../../../frontend/symbols/index.js"
import { renderTypeExpr, type Identifier, type InterfaceMethod, type Span, type Method, type Property, type TypeExpr, type VarSection } from "../../../frontend/syntax/index.js"
import { isSameType, renderType, resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import { compiledFbs } from "../../shared/compiled.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkMethodSignatures(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block") continue
    const fbSym = lookupUnit(ctx.project, unit.name.text)?.symbol
    if (fbSym !== undefined && isLibrarySymbol(fbSym)) continue // a library FB's overrides are the library's concern
    const fbScope = scopeForUnit(ctx.project, unit)
    if (fbScope === undefined || !compiledFbs(ctx.project).has(fbScope)) continue
    const own = ownMembers(fbScope, "method")
    const ownProps = ownMembers(fbScope, "property")

    // C0089 — vs each implemented interface's methods, its inherited ones included (rule H4)
    const bases = ancestry(fbScope).slice(1)
    for (const ifaceName of unit.implements ?? []) {
      if (isLibraryName(ctx, ifaceName.text)) continue
      const ifaceScope = findScopeByName(ctx.project, ifaceName.text, scopeUri(fbScope))
      if (ifaceScope === undefined || ifaceScope.kind !== "interface") continue
      for (const declaring of ancestry(ifaceScope))
        for (const im of ownMembers(declaring, "interface_method").values()) {
          // the FB's own method, or the one its nearest BASE declares — an inherited method implements the interface too,
          // and is compared alike (`oopb_itf_method_in_base_mismatch`, both vendors 2026-10-06)
          const mine = own.get(im.name.toLowerCase()) ?? nearest(bases, "method", im.name)
          if (mine === undefined || isLibrarySymbol(mine)) continue // not implemented → C0087's concern
          const theirs = im.ast as InterfaceMethod
          const cmp = compare(mine.ast as Method, theirs, mine.owner, im.owner, ctx)
          if (cmp === undefined) continue
          const [method, iface] = [im.name.toUpperCase(), declaring.name.toUpperCase()]
          // an INHERITED method's spans are the BASE's unit — in a workspace another file — so the finding is said at this
          // FB's IMPLEMENTS name instead (CODESYS records it without a position, line 0; gate 3.7+3.9)
          const inherited = mine.owner !== fbScope
          const span = inherited ? ifaceName.span : (mine.ast as Method).name.span
          out.push(diag(span, "override-mismatch-interface", ctx.messages.overrideMismatchInterface(method, iface)))
          // CODESYS says which part differs, in a second sentence TwinCAT does not have (`inh_interface_method_*`): at the
          // differing parameter, or — a parameter COUNT — at the method's declaration
          if (ctx.config.vendor === "codesys" && cmp.kind === "count")
            out.push(diag(inherited ? span : (mine.ast as Method).span, "override-mismatch-interface", ctx.messages.interfaceParamCountMismatch(method, iface)))
          else if (ctx.config.vendor === "codesys" && cmp.variable !== undefined)
            out.push(diag(inherited ? span : cmp.variable.span, "override-mismatch-interface", ctx.messages.interfaceVariableMismatch(cmp.variable.text, method, iface)))
        }
    }

    // C0094 / C0568 — vs the nearest base FB declaring the method (the chain the symbol table linked)
    for (const mine of own.values()) {
      const theirs = nearest(bases, "method", mine.name)
      if (theirs === undefined || isLibrarySymbol(theirs) || LIFECYCLE.has(mine.name.toLowerCase())) continue
      const base = theirs.owner
      const span = (mine.ast as Method).name.span
      const cmp = compare(mine.ast as Method, theirs.ast as Method, mine.owner, base, ctx)
      if (cmp === undefined) continue
      out.push(diag(span, "override-mismatch-base", ctx.messages.overrideMismatchBase(mine.name.toUpperCase(), base.name.toUpperCase())))
      // each parameter at a position whose PASSED type differs is then converted from the override's to the base's
      // (`inh_override_signature_mismatch`: 'DINT' to 'INT'; `_section_mismatch`: 'REFERENCE TO INT' to 'INT';
      // `_inout_as_input`: 'INT' to 'REFERENCE TO INT')
      // — at the override's parameter type, one conversion each (C0032's)
      for (const c of cmp.conversions) out.push(diag(c.span, "assignment-type-mismatch", ctx.messages.cannotConvert(c.from, c.to)))
    }
    // a PROPERTY of another type than the base's: the mismatch of its accessor METHOD (`inh_override_property_type_mismatch`)
    for (const mine of ownProps.values()) {
      const theirs = nearest(bases, "property", mine.name)
      if (theirs === undefined || isLibrarySymbol(theirs) || mine.typeExpr === undefined || theirs.typeExpr === undefined) continue
      if (sameType(mine.typeExpr, theirs.typeExpr, mine.owner, theirs.owner, ctx)) continue
      const [p, b] = [mine.ast as Property, theirs.ast as Property]
      const accessors = [p.getter !== undefined && b.getter !== undefined ? "__GET" : undefined, p.setter !== undefined && b.setter !== undefined ? "__SET" : undefined]
      for (const a of accessors)
        if (a !== undefined)
          out.push(diag(p.name.span, "override-mismatch-base", ctx.messages.overrideMismatchBase(`${a}${mine.name.toUpperCase()}`, theirs.owner.name.toUpperCase())))
      // …and the SET's value passed in is converted from the override's type to the base's, once
      // (`oopb_base_property_get_set_mismatch`, both vendors 2026-10-06; a GET's result converts nothing)
      const [from, to] = [resolved(mine.typeExpr, mine.owner, ctx), resolved(theirs.typeExpr, theirs.owner, ctx)]
      if (accessors[1] !== undefined && from !== undefined && to !== undefined)
        out.push(diag(p.name.span, "assignment-type-mismatch", ctx.messages.cannotConvert(renderType(from), renderType(to))))
    }
  }
}

/** The methods every FB declares for itself — no override of its base's. */
const LIFECYCLE: ReadonlySet<string> = new Set(["fb_init", "fb_exit", "fb_reinit"])

/** The members of one kind a scope declares itself, by lowercased name. */
function ownMembers(scope: Scope, kind: Symbol["kind"]): Map<string, Symbol> {
  const map = new Map<string, Symbol>()
  for (const syms of scope.symbols.values()) for (const s of syms) if (s.kind === kind) map.set(s.name.toLowerCase(), s)
  return map
}

/** The member of `kind` and `name` the nearest of `bases` declares. */
function nearest(bases: readonly Scope[], kind: Symbol["kind"], name: string): Symbol | undefined {
  for (const b of bases) {
    const hit = lookupLocal(b, name).find((s) => s.kind === kind)
    if (hit !== undefined) return hit
  }
  return undefined
}

const isLibraryName = (ctx: CheckContext, name: string): boolean => {
  const s = lookupUnit(ctx.project, name)?.symbol
  return s !== undefined && isLibrarySymbol(s)
}

interface Param {
  name: Identifier
  section: string
  type: TypeExpr
}

/** The formal parameters of a signature, in declared order. */
function params(sections: readonly VarSection[]): Param[] {
  const out: Param[] = []
  for (const s of sections)
    if (s.sectionKind === "VAR_INPUT" || s.sectionKind === "VAR_OUTPUT" || s.sectionKind === "VAR_IN_OUT")
      for (const d of s.decls) for (const n of d.names) out.push({ name: n, section: s.sectionKind, type: d.type })
  return out
}

/** How two signatures differ — the parameter COUNT, a parameter (its name, type or section), or only the result type —
 *  with the conversions the vendors then report; undefined when they match. */
type Mismatch = { kind: "count" | "variable" | "result"; variable?: Identifier; conversions: { from: string; to: string; span: Span }[] }

function compare(mine: Method | InterfaceMethod, theirs: Method | InterfaceMethod, myScope: Scope, theirScope: Scope, ctx: CheckContext): Mismatch | undefined {
  const a = params(mine.varSections)
  const b = params(theirs.varSections)
  const conversions: Mismatch["conversions"] = []
  let variable: Identifier | undefined
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [x, y] = [a[i]!, b[i]!]
    const typeDiffers = !sameType(x.type, y.type, myScope, theirScope, ctx)
    if (variable === undefined && (typeDiffers || x.section !== y.section || x.name.text.toLowerCase() !== y.name.text.toLowerCase())) variable = x.name
    // a conversion only where the type PASSED differs: another type, or a VAR_IN_OUT (by reference) against a parameter
    // passed by value — not a VAR_OUTPUT for a VAR_INPUT of the same type (`inh_override_input_as_output`: the mismatch
    // alone; "Cannot convert type 'INT' to type 'INT'" was the LSP's own)
    // …nor for two VAR_OUTPUTs of other types, which pass nothing in (`oopb_base_output_type_mismatch`, both vendors)
    const [from, to] = [passed(x, myScope, ctx), passed(y, theirScope, ctx)]
    const bothOut = x.section === "VAR_OUTPUT" && y.section === "VAR_OUTPUT"
    if (!bothOut && (typeDiffers || x.section !== y.section) && from !== undefined && to !== undefined && from !== to) conversions.push({ from, to, span: x.type.span })
  }
  // THE INPUTS, OUTPUTS AND INOUTS ARE COUNTED APART, the result among the outputs: a VAR_INPUT declared VAR_IN_OUT, and a
  // result left out, are COUNT differences (`oopb_itf_section_mismatch`, `oopb_itf_return_missing`, CODESYS 2026-10-06)
  const [r, s] = [mine.returnType, theirs.returnType]
  const count = (ps: readonly Param[], section: string) => ps.filter((p) => p.section === section).length
  const sections = ["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT"]
  if (a.length !== b.length || sections.some((k) => count(a, k) !== count(b, k)) || (r === undefined) !== (s === undefined))
    return { kind: "count", conversions }
  if (variable !== undefined) return { kind: "variable", variable, conversions }
  // …and another result type is the variable named as the method (`oopb_itf_return_type_mismatch`: "The variable 'M'")
  if (r !== undefined && s !== undefined && !sameType(r, s, myScope, theirScope, ctx)) return { kind: "result", variable: mine.name, conversions }
  return undefined
}

/** The type a parameter is passed as — a VAR_IN_OUT by reference — or undefined when its type resolves to nothing. */
function passed(p: Param, scope: Scope, ctx: CheckContext): string | undefined {
  const t = resolved(p.type, scope, ctx)
  return t === undefined ? undefined : `${p.section === "VAR_IN_OUT" ? "REFERENCE TO " : ""}${renderType(t)}`
}

function resolved(t: TypeExpr, scope: Scope, ctx: CheckContext): Type | undefined {
  const r = resolveTypeExpr(t, ctx.project, 0, scope)
  return r.kind === "unknown" ? undefined : r
}

/**
 * The same type: written alike (case and spacing aside — an ARRAY, a subrange, a POINTER compare by their text, which
 * `isSameType` cannot: it compares names), or resolving to the same named type. A type either side cannot resolve is not
 * compared (a library's, lossy).
 */
function sameType(a: TypeExpr, b: TypeExpr, aScope: Scope, bScope: Scope, ctx: CheckContext): boolean {
  if (written(a) === written(b)) return true
  const [x, y] = [resolved(a, aScope, ctx), resolved(b, bScope, ctx)]
  if (x === undefined || y === undefined) return true
  if (!("name" in x) || !("name" in y)) return true // structural and written differently: not decidable here
  return isSameType(x, y)
}

const written = (t: TypeExpr): string => renderTypeExpr(t).replace(/\s+/g, "").toUpperCase()

const diag = (span: DiagnosticItem["span"], code: string, message: string): DiagnosticItem => ({ severity: "error", span, source: SOURCE, code, message })

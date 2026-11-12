/**
 * references (Layer E · E.2). Type-aware: resolve the target symbol at the cursor, then keep only the
 * occurrences that bind to the SAME symbol (by identity) — so `motor.Start` doesn't match every `Start`.
 * This is what makes rename safe. Powers references, highlight, and rename.
 *
 * It walks the bodies AS WRITTEN (`sourceBodies`): a use in a conditional branch not taken, or in a body whose condition
 * the LSP cannot decide, is still text a rename must edit — it compiles again when the condition flips.
 *
 * A member-access chain (and a `.g` through the global namespace) resolves through `types/resolveMemberChain` — a box
 * output read through its call (`t1(…).Q`) through its instance, as `resolveAt` does; a call's named pin to the callee's
 * member; a bare ident through scope lookup.
 * The `.member` IdentExpr of a chain is NOT counted as a standalone ident (it's covered by the member node).
 */
import {
  allUnits,
  type CallExpr,
  type Expr,
  type IdentExpr,
  type Span,
  type TopLevel,
  UNNAMED,
  walkAllExprs,
  walkExpr,
} from "../../frontend/syntax/index.js"
import { unitTypeNameRefs } from "../shared/type-refs.js"
import {
  bareEnumMember,
  lookup,
  lookupMember,
  lookupUnit,
  type Scope,
  scopeForUnit,
  sourceBodies,
  type Symbol,
} from "../../frontend/symbols/index.js"
import { networkBox, resolveMemberChain } from "../../frontend/types/index.js"
import { rangeFromSpan, resolveMember } from "../shared/index.js"
import type { Location, Range } from "vscode-languageserver-protocol"
import type { Document } from "../shared/index.js"

interface Ref {
  uri: string
  range: Range
}

/** The symbols a reference search asks for, and the names they are written by (a name no target has is not resolved). */
interface Targets {
  has(sym: Symbol | undefined): boolean
  named(name: string): boolean
  /** Whether a name begins with a target's (a marked output, `Q_INVERTED`, names `Q`). */
  begins(name: string): boolean
  all: readonly Symbol[]
}

/** One symbol, or several — an override chain, whose members a rename edits together (`override-chain`, B6). */
function targetsOf(target: Symbol | readonly Symbol[]): Targets {
  const all = Array.isArray(target) ? (target as readonly Symbol[]) : [target as Symbol]
  const set = new Set(all)
  const names = new Set(all.map((s) => s.name.toLowerCase()))
  const begins = (n: string) => [...names].some((name) => n.toLowerCase().startsWith(name))
  return { has: (s) => s !== undefined && set.has(s), named: (n) => names.has(n.toLowerCase()), begins, all }
}

/** Every occurrence (declaration + body uses) across `docs` that binds to `target` (or to any of several). */
export function findReferences(docs: Iterable<Document>, project: Scope, target: Symbol | readonly Symbol[]): Ref[] {
  const t = targetsOf(target)
  const out: Ref[] = t.all.map((s) => ({ uri: s.uri, range: rangeFromSpan(s.span) })) // the declarations themselves
  for (const doc of docs) {
    for (const { scope, statements } of sourceBodies(doc.parseResult.units, project))
      exprRefs((visit) => walkAllExprs(statements, visit), scope, project, t, doc.uri, out)
    for (const unit of allUnits(doc.parseResult.units)) {
      // an initial value (`a : INT := g;`) resolves in its declaration's unit scope
      // ponytail: scalar initial values only; an aggregate's (`[g, 1]`, `(x := g)`) when a rename needs it
      const own = scopeForUnit(project, unit)
      if (own !== undefined && "varSections" in unit)
        for (const section of unit.varSections)
          for (const decl of section.decls) {
            const init = decl.init
            if (init !== undefined && init.kind !== "aggregate_init")
              exprRefs((visit) => walkExpr(init, visit), own, project, t, doc.uri, out)
          }
      // Type positions — `inst : T`, `EXTENDS T`, `IMPLEMENTS T`, return/field/alias types. Bodies above never
      // see these, so without this a type rename leaves its declaration uses stale (broken project).
      const uscope = own ?? project
      for (const ref of unitTypeNameRefs(unit)) {
        if (ref.qualified) continue // `NS.T` keys on the last segment; skip to avoid cross-namespace collisions
        if (t.named(ref.name) && t.has(lookupUnit(uscope, ref.name)?.symbol))
          out.push({ uri: doc.uri, range: rangeFromSpan(ref.span) })
      }
    }
  }
  return out
}

/** The occurrences of a target among the expressions `walk` visits, resolved in `scope`: a member, a call's named pin,
 *  a `.g`, a bare name — a member's and a pin's name are no bare identifiers. */
function exprRefs(
  walk: (visit: (e: Expr) => void) => void,
  scope: Scope,
  project: Scope,
  t: Targets,
  uri: string,
  out: Ref[],
): void {
  // a member's name and a pin's name are no bare identifiers: each names a member, found by its own branch below
  const memberNames = new Set<IdentExpr>()
  walk((e) => {
    if (e.kind === "member") memberNames.add(e.member)
    if (e.kind === "call") for (const a of e.args) if (a.param !== undefined) memberNames.add(a.param)
  })
  walk((e) => {
    if (e.kind === "member") {
      if (t.named(e.member.name) && t.has(resolveMember(e, scope, project))) {
        out.push({ uri, range: rangeFromSpan(e.member.span) })
      }
    } else if (e.kind === "call") {
      for (const span of pinSpans(e, scope, project, t)) out.push({ uri, range: rangeFromSpan(span) })
    } else if (e.kind === "global_expr") {
      // `.g` — the global past every local (rule E33): renaming `g` without it leaves "no global definition for 'g'"
      if (t.named(e.name.name) && t.has(resolveMemberChain(e, scope, project)))
        out.push({ uri, range: rangeFromSpan(e.name.span) })
    } else if (e.kind === "ident_expr" && !memberNames.has(e) && t.named(e.name)) {
      const s = lookup(scope, e.name)?.symbol ?? bareEnumMember(scope, e.name)
      if (t.has(s)) out.push({ uri, range: rangeFromSpan(e.span) })
    }
  })
}

const CALLABLES: ReadonlySet<string> = new Set(["function", "function_block", "program", "method"])

/**
 * The spans of a call's named pins (`f(In := x, Out => y)`) that bind a target: a network box's marked output
 * (`Q_INVERTED => y`, `networkBox`) by its name part, so a rename keeps the mark. A pin binds the instance's member (a
 * network box's instance, else the call's head), or one of the callee's own where the head names a POU or method.
 */
function pinSpans(call: CallExpr, scope: Scope, project: Scope, t: Targets): Span[] {
  if (!call.args.some((a) => a.param !== undefined && t.begins(a.param.name))) return [] // no pin can bind a target
  const box = networkBox(call, scope, project)
  const head =
    box?.instance !== undefined && !(box.instance.kind === "ident_expr" && box.instance.name === UNNAMED)
      ? box.instance
      : call.callee
  // the callee's own scope, by its declaration's span (`scopeForUnit`), for a head naming a POU or method, no instance
  const own = () => {
    const callee = resolveMemberChain(call.callee, scope, project)
    return callee !== undefined && CALLABLES.has(callee.kind)
      ? scopeForUnit(project, callee.ast as TopLevel)
      : undefined
  }
  const out: Span[] = []
  for (const a of box?.pins ?? call.args) {
    const param = a.param
    if (param === undefined || !t.named(param.name)) continue
    const member = resolveMemberChain({ kind: "member", base: head, member: param, span: a.span }, scope, project)
    const calleeScope = member === undefined ? own() : undefined
    if (t.has(member ?? (calleeScope === undefined ? undefined : lookupMember(calleeScope, param.name))))
      out.push({
        ...param.span,
        end: param.span.start + param.name.length,
        endCol: param.span.startCol + param.name.length,
      })
  }
  return out
}

export function toLocations(refs: readonly Ref[]): Location[] {
  return refs.map((r) => ({ uri: r.uri, range: r.range }))
}

/**
 * THE SCOPE OF A PLAIN-ST NETWORK BODY (openspec network-text-st 2.3; `syntax/network/plain-st.ts`): the unit's scope,
 * with the body's WIRES declared over it — each name on a `%WIRES` line, declared by nobody else, its definition recorded
 * for the type engine (`Symbol.wire`) — and marked as a network's (`Scope.network`), where the network's own box names
 * mean something (`types/names.ts`).
 *
 * The writer names wires across the body (`w1`, `w2`, … one name one wire, design.md 1.4), so the body has one scope;
 * a name two networks both declare is the network check's to refuse (`analysis/checks/network/_plain-st.ts`), and only
 * its first declaration is bound here.
 */
import {
  type BodySpan,
  type CallExpr,
  type Expr,
  type StatementList,
  plainStText,
  sourceStatements,
  UNNAMED,
  stmtExprs,
  walkExpr,
  walkStatements,
} from "../syntax/index.js"
import type { Scope, Symbol, WireDefinition } from "./model.js"
import { defineSymbol, localScope, lookupLocal } from "./scope.js"
import { scopeUri } from "./precedence.js"

// ponytail: a wire is a declaration with no ST AST node; readers of `sym.ast` cast-and-read optional fields (guarded),
// so an empty object is a placeholder that never throws.
const WIRE_AST = {} as Symbol["ast"]

const cache = new WeakMap<BodySpan, { parent: Scope; scope: Scope }>()

/** The scope `body` resolves in: `parent` (its unit's, or its accessor's) with the body's wires over it. Once per body
 *  and parent, so a wire is one symbol to every walk (rename, references). */
export function networkScope(parent: Scope, body: BodySpan): Scope {
  const hit = cache.get(body)
  if (hit !== undefined && hit.parent === parent) return hit.scope
  const scope = localScope(parent, parent.kind, `${parent.name}$networks`, body.span)
  scope.network = true
  const uri = scopeUri(parent) ?? ""
  const definitions = wireDefinitions(sourceStatements(body).statements)
  for (const network of plainStText(body).networks)
    for (const wire of network.wires) {
      if (lookupLocal(scope, wire.name).length > 0) continue
      defineSymbol(scope, {
        kind: "var",
        name: wire.name,
        span: wire.span,
        declarationSpan: wire.span,
        owner: scope,
        uri,
        varSection: "VAR_TEMP",
        wire: definitions.get(wire.name.toLowerCase()) ?? { kind: "none" },
        ast: WIRE_AST,
      })
    }
  // a coil nobody named (`??? := a;`) is the IDE's, not a name the body declares: typed by its value, as a wire is,
  // so no check reads it as an undeclared name — the network check names it as the IDE's build does
  const unnamed = definitions.get(UNNAMED)
  if (unnamed !== undefined)
    defineSymbol(scope, {
      kind: "var",
      name: UNNAMED,
      span: body.span,
      declarationSpan: body.span,
      owner: scope,
      uri,
      varSection: "VAR_TEMP",
      wire: unnamed,
      ast: WIRE_AST,
    })
  cache.set(body, { parent, scope })
  return scope
}

/** Every name's FIRST definition in the statements: `w := e` (a statement or an assignment inside an expression), or
 *  a call's output bound to the bare name (`f(…, Q => w)`). A name defined twice is the network check's to refuse. */
function wireDefinitions(statements: StatementList): Map<string, WireDefinition> {
  const out = new Map<string, WireDefinition>()
  const define = (target: Expr, definition: WireDefinition) => {
    if (target.kind !== "ident_expr") return
    const key = target.name.toLowerCase()
    if (!out.has(key)) out.set(key, definition)
  }
  const visit = (e: Expr) =>
    walkExpr(e, (x) => {
      if (x.kind === "assign_expr") define(x.target, { kind: "value", expr: x.value })
      if (x.kind === "call") outputs(x)
      // an FB box the IDE holds with no instance, `TON(FB := ???, …)`: the IDE's, not a name the body declares
      const first = x.kind === "call" ? x.args[0] : undefined
      if (first !== undefined && !first.output && first.param?.name.toUpperCase() === "FB" && first.value?.kind === "ident_expr" && first.value.name === UNNAMED)
        define(first.value, { kind: "none" })
    })
  const outputs = (call: CallExpr) => {
    for (const a of call.args)
      if (a.output && a.param !== undefined && a.value !== undefined) define(a.value, { kind: "output", call, param: a.param.name })
  }
  walkStatements(statements, (stmt) => {
    if (stmt.kind === "assign" && stmt.op === undefined && (stmt.chained === undefined || stmt.chained.length === 0))
      define(stmt.target, { kind: "value", expr: stmt.value })
    for (const e of stmtExprs(stmt)) visit(e)
  })
  return out
}

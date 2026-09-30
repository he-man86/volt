/**
 * network-text analysis core (Layer F, F.2b) — the adapter onto the shared type engine. Parses a graphical body and
 * builds, per network, a scope that layers the network's WIRES over the POU scope, so the one type engine,
 * `resolveMemberChain`, hover and rename resolve a wire reference exactly like a variable.
 *
 * A wire is declared in its network's own `VAR_TEMP … END_VAR` block with its type (network text v2; spec, "a wire is a
 * Demux declared in its network's VAR_TEMP block"). Its USES are typed as a build types them (`usesTypeOf`): by the
 * declaration only where the producer rule names that type exactly, since the vendor's Demux holds no type and the
 * compiler checks a consumer against the producer.
 *
 * Wires are network-scoped (VarIds are per network), so each network owns its own scope and `g1` in network 0 never
 * shadows `g1` in network 1.
 */
import {
  build,
  defineSymbol,
  isPouSymbol,
  lookup,
  type Scope,
  scopeForUnit,
  type Symbol as StSymbol,
} from "../frontend/symbols/index.js"
import { type BodySpan, type Expr, type TopLevel, type TypeExpr, isTrivia, lex, parseExprFromTokens } from "../frontend/syntax/index.js"
import { type FunctionBlockType, inferExprType, isSameType, resolveTypeExpr } from "../frontend/types/index.js"
import { type NetworkScopeView, parseNetworkText } from "../network-text/parser.js"
import type { NetworkTextBody, NetworkTextNetwork, NetworkWire } from "../network-text/ast.js"
import { networkValueExpr } from "../network-text/exprs.js"

export interface NetworkTextAnalysis {
  vg: NetworkTextBody
  /** The enclosing POU scope (fallback for offsets outside any network). */
  pou: Scope
  /** Each network's resolution scope (POU + its wires). */
  networkScopes: Map<NetworkTextNetwork, Scope>
  /** The wire each wire symbol stands for — what a hover shows the producer of. */
  wires: Map<StSymbol, NetworkWire>
}

// ponytail: a wire is a declaration with no ST AST node; readers of `sym.ast` all cast-and-read optional fields
// (guarded), so an empty object is a safe placeholder that never throws.
const WIRE_AST = {} as StSymbol["ast"]

export function analyzeNetworkText(unit: TopLevel, body: BodySpan, project: Scope, uri: string): NetworkTextAnalysis {
  const pou = scopeForUnit(project, unit) ?? project
  const vg = parseNetworkText(body, scopeView(pou, project))
  const networkScopes = new Map<NetworkTextNetwork, Scope>()
  const wires = new Map<StSymbol, NetworkWire>()
  for (const network of vg.networks) {
    const scope = build.localScope(pou, "pou", `${pou.name}$net${network.index}`, network.span)
    for (const wire of network.wires) {
      const sym: StSymbol = {
        kind: "var",
        name: wire.name.text,
        span: wire.name.span,
        declarationSpan: wire.span,
        owner: scope,
        uri,
        varSection: "VAR_TEMP",
        ...usesTypeOf(wire, network.wires, pou, project),
        ast: WIRE_AST,
      }
      defineSymbol(scope, sym)
      wires.set(sym, wire)
    }
    networkScopes.set(network, scope)
  }
  return { vg, pou, networkScopes, wires }
}

/**
 * The type a wire's USES are checked by — the one a build gives them, or none. A declaration its producer contradicts
 * types nothing: it is refused at the wire, and the push never lets the body reach a build, so a message at the consumer
 * would be one no build gives. Anywhere else the push takes the declaration as written, and the vendor, whose Demux
 * holds no type, compiles the consumer against the PRODUCER. So the declaration types the uses only where the producer
 * is known to yield it — the producer rule names it exactly, or the ST engine types the producer's expression as it —
 * and a variable leaf passes on its own declared type. Anything else (a box, an expression the engine cannot type)
 * types nothing: a declaration the vendor discards is never what a consumer is checked against.
 */
function usesTypeOf(
  wire: NetworkWire,
  wires: readonly NetworkWire[],
  pou: Scope,
  project: Scope,
  seen = new Set<NetworkWire>(),
): { typeExpr?: TypeExpr } {
  if (wire.typeRefused === true || seen.has(wire)) return {}
  seen.add(wire)
  const v = wire.definition?.value
  // A wire forwarding another carries what that one carries: the rule "confirms" it against the other's DECLARATION,
  // which is itself only the build's type where its own producer yields it.
  if (v?.kind === "wire_ref") {
    const other = wires.find((w) => w.name.text.toUpperCase() === v.name.text.toUpperCase())
    return other !== undefined ? usesTypeOf(other, wires, pou, project, seen) : {}
  }
  if (wire.type === undefined) return {}
  if (wire.typeConfirmed === true) return { typeExpr: wire.type }
  if (v?.kind === "operand" && v.expr?.kind === "ident_expr") {
    const sym = lookup(pou, v.expr.name)?.symbol
    return sym !== undefined && VARIABLE_KINDS.has(sym.kind) && sym.typeExpr !== undefined ? { typeExpr: sym.typeExpr } : {}
  }
  const expr = v === undefined || v.kind === "call" || v.kind === "execute" ? undefined : networkValueExpr(v)
  if (expr === undefined) return {}
  return isSameType(inferExprType(expr, pou, project), resolveTypeExpr(wire.type, project, 0, pou)) ? { typeExpr: wire.type } : {}
}

/** The network containing `offset` paired with its resolution scope, or undefined when outside all. */
export function networkNetworkAt(analysis: NetworkTextAnalysis, offset: number): { network: NetworkTextNetwork; scope: Scope } | undefined {
  for (const [network, scope] of analysis.networkScopes) {
    if (offset >= network.span.start && offset < network.span.end) return { network, scope }
  }
  return undefined
}

/** The POU's scope as the parser asks it — the bridge's `NetworkScope`: whether a name is declared, whether it is a POU,
 *  and the FB type of an instance. */
function scopeView(pou: Scope, project: Scope): NetworkScopeView {
  return {
    contains: (name) => lookup(pou, name) !== undefined,
    isPou: (name) => {
      const sym = lookup(pou, name)?.symbol
      return sym !== undefined && isPouSymbol(sym)
    },
    instanceType: (head) => {
      const toks = lex(head).filter((t) => t.kind !== "eof" && !isTrivia(t.kind))
      const expr = toks.some((t) => t.kind === "unknown") ? undefined : parseExprFromTokens(toks)
      return expr === undefined ? undefined : instanceFb(expr, pou, project)?.name
    },
  }
}

/** Kinds of symbol a declaration makes a VARIABLE of — what an FB instance is, as opposed to a POU named by its type. */
const VARIABLE_KINDS: ReadonlySet<string> = new Set(["var", "gvl_var", "method_param", "struct_field"])

/**
 * The FB an instance is of, when `head` is an FB INSTANCE — a variable, or a path to one (`GVL.timers.t1`), whose type
 * is a function block — else undefined (`NetworkScope.InstanceType`). The ONE answer to "is this head an instance":
 * the parser asks it for the construct check (an instance whose FB is R_EDGE has no spelling) and the pin check asks it
 * for the pins, so the two cannot disagree about the same head. A head that names a POU is a function (or the vendor's
 * own box), whose parameters are no FB's pins: resolving a bare POU name by TYPE found the wrong thing where two
 * libraries share it (bakon-nano's `DELETE(STR := …)`, the Standard function, against a `CAA File` FB, task 5.5).
 */
export function instanceFb(head: Expr, scope: Scope, project: Scope): FunctionBlockType | undefined {
  if (head.kind === "ident_expr") {
    const kind = lookup(scope, head.name)?.symbol.kind
    if (kind === undefined || !VARIABLE_KINDS.has(kind)) return undefined
  } else if (head.kind !== "member") return undefined
  const t = inferExprType(head, scope, project)
  return t.kind === "function_block" ? t : undefined
}

/**
 * network-text analysis core (Layer F, F.2b) — the infer adapter onto the shared type engine. Parses a graphical
 * body and builds, per network, a scope that layers the network's `LET` wires over the POU scope. A wire
 * carries a `typeExpr` SYNTHESIZED from inferring its producer (`LET g := (a AND b)` → BOOL), so the ONE
 * type engine / resolveMemberChain / nav / hover resolve wire references exactly like real variables —
 * including chained wires (`LET en5 := en4`) because each producer is inferred against the wires already
 * defined before it. Wire types are inferred, never stored (spec §E) — the network text carries no wire type.
 *
 * Wires are network-scoped (NETWORK_DUPLICATE_NAME is per-network), so each network owns its own scope and a
 * `LET g` in network 0 never shadows one in network 1.
 */
import {
  defineSymbol,
  scopeForUnit,
  type Scope,
  type Symbol as StSymbol,
} from "../symbols/index.js"
import { inferExprType, type Type } from "../types/index.js"
import type { BodySpan, Span, TopLevel, TypeExpr } from "../syntax/index.js"
import { parseNetworkText } from "./text/parser.js"
import type { NetworkTextBody, NetworkTextNetwork, NetworkTextStatement, NetworkWireDef } from "./text/ast.js"

export interface NetworkTextAnalysis {
  vg: NetworkTextBody
  /** The enclosing POU scope (fallback for offsets outside any network). */
  pou: Scope
  /** Each network's resolution scope (POU + its wires). */
  networkScopes: Map<NetworkTextNetwork, Scope>
}

// ponytail: a wire is a synthetic decl with no backing AST node; readers of `sym.ast` all cast-and-read
// optional fields (guarded), so an empty object is a safe placeholder that never throws.
const WIRE_AST = {} as StSymbol["ast"]

export function analyzeNetworkText(unit: TopLevel, body: BodySpan, project: Scope, uri: string): NetworkTextAnalysis {
  const pou = scopeForUnit(project, unit) ?? project
  const vg = parseNetworkText(body)
  const networkScopes = new Map<NetworkTextNetwork, Scope>()
  for (const network of vg.networks) {
    const scope: Scope = { kind: "pou", name: `${pou.name}$net${network.index ?? "?"}`, parent: pou, symbols: new Map(), children: [], span: network.span }
    for (const wire of wireDefs(network.statements)) {
      // Infer against the scope so far — real vars + wires already defined above this one.
      const t = wire.producer !== undefined ? inferExprType(wire.producer, scope, project) : undefined
      const typeExpr = t !== undefined ? synthTypeExpr(t, wire.name.span) : undefined
      const sym: StSymbol = {
        kind: "var",
        name: wire.name.text,
        span: wire.name.span,
        declarationSpan: wire.span,
        owner: scope,
        uri,
        ...(typeExpr !== undefined ? { typeExpr } : {}),
        ast: WIRE_AST,
      }
      defineSymbol(scope, sym)
    }
    networkScopes.set(network, scope)
  }
  return { vg, pou, networkScopes }
}

/** The network containing `offset` paired with its resolution scope, or undefined when outside all. */
export function networkNetworkAt(analysis: NetworkTextAnalysis, offset: number): { network: NetworkTextNetwork; scope: Scope } | undefined {
  for (const [network, scope] of analysis.networkScopes) {
    if (offset >= network.span.start && offset < network.span.end) return { network, scope }
  }
  return undefined
}

/** Every `LET` wire-def in a statement list, recursing into en/eno IF boxes, in source order. */
export function* wireDefs(statements: readonly NetworkTextStatement[]): Generator<NetworkWireDef> {
  for (const s of statements) {
    if (s.kind === "wire_def") yield s
    else if (s.kind === "en_eno_if") yield* wireDefs(s.body)
  }
}

/**
 * A TypeExpr for an inferred wire type, so the shared `resolveTypeExpr` re-derives exactly that type. It used to emit a
 * bare name only, which dropped a string's declared length (`STRING(10)` came back as STRING) and gave an array, pointer
 * or reference wire no type at all (consolidate-lsp-structure A11). An interface or unknown type still skips.
 */
function synthTypeExpr(t: Type, span: Span): TypeExpr | undefined {
  const named = (text: string): TypeExpr => ({ kind: "named_type", name: { kind: "identifier", text, span }, span })
  switch (t.kind) {
    case "elementary":
      if (t.elem.family !== "string" || t.length === undefined) return named(t.name)
      return {
        kind: "string_type",
        wide: t.name === "WSTRING",
        length: { kind: "literal", literalKind: "int", text: String(t.length), value: BigInt(t.length), span },
        span,
      }
    case "enum":
    case "struct":
    case "function_block":
      return named(t.name)
    case "array": {
      const element = synthTypeExpr(t.element, span)
      return element === undefined ? undefined : { kind: "array_type", dims: [...t.dims], element, span }
    }
    case "pointer":
    case "reference": {
      const target = synthTypeExpr(t.target, span)
      if (target === undefined) return undefined
      return t.kind === "pointer" ? { kind: "pointer_type", target, span } : { kind: "reference_type", target, span }
    }
    default:
      return undefined
  }
}

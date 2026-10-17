/**
 * network-text analysis core (Layer F, F.2b) — the adapter onto the shared type engine. Parses a graphical body and
 * builds, per network, a scope that layers the network's SPLITS over the POU scope, so the one type engine,
 * `resolveMemberChain`, hover and rename resolve a split reference exactly like a variable.
 *
 * A split is a vendor Demux named by its VarId (`split176`, openspec ld-fbd-coverage 2R.3, B6): no declaration and no
 * type. Its USES are typed as a build types them (`usesTypeOf`): by its FEEDER, since the vendor's Demux holds no type
 * and the compiler checks a consumer against the producer.
 *
 * Splits are network-scoped (VarIds are per network), so each network owns its own scope and `split1` in network 0
 * never shadows `split1` in network 1.
 */
import {
  build,
  defineSymbol,
  dialectOf,
  findChildScope,
  isPouSymbol,
  lookup,
  lookupLocal,
  type Scope,
  scopeForUnit,
  type Symbol as StSymbol,
} from "../../symbols/index.js"
import {
  type BodySpan,
  type Expr,
  type NetworkScopeView,
  type NetworkSplit,
  type NetworkTextBody,
  type NetworkTextNetwork,
  type NetworkValue,
  type TopLevel,
  type TypeExpr,
  COMPARISONS,
  isTrivia,
  lex,
  networkValueExpr,
  parseExprFromTokens,
  parseTypeExprFromTokens,
} from "../../syntax/index.js"
import type { FunctionBlockType } from "../type.js"
import { inferExprType } from "../infer/expr.js"
import { renderType } from "../render.js"
import { parseNetworkText } from "./network-parse.js"

export interface NetworkTextAnalysis {
  vg: NetworkTextBody
  /** The enclosing POU scope (fallback for offsets outside any network). */
  pou: Scope
  /** Each network's resolution scope (POU + its splits). */
  networkScopes: Map<NetworkTextNetwork, Scope>
  /** The split each split symbol stands for — what a hover shows the feeder of. */
  splits: Map<StSymbol, NetworkSplit>
}

// ponytail: a split is a declaration with no ST AST node; readers of `sym.ast` all cast-and-read optional fields
// (guarded), so an empty object is a safe placeholder that never throws.
const SPLIT_AST = {} as StSymbol["ast"]

export function analyzeNetworkText(unit: TopLevel, body: BodySpan, project: Scope, uri: string): NetworkTextAnalysis {
  const pou = scopeForUnit(project, unit) ?? project
  const vg = parseNetworkText(body, scopeView(pou, project), dialectOf(project))
  const networkScopes = new Map<NetworkTextNetwork, Scope>()
  const splits = new Map<StSymbol, NetworkSplit>()
  for (const network of vg.networks) {
    const scope = build.localScope(pou, "pou", `${pou.name}$net${network.index}`, network.span)
    for (const split of network.splits) {
      const sym: StSymbol = {
        kind: "var",
        name: split.name.text,
        span: split.name.span,
        declarationSpan: split.definition.span,
        owner: scope,
        uri,
        varSection: "VAR_TEMP",
        ...usesTypeOf(split.definition.value, network, vg, pou, project, new Set()),
        ast: SPLIT_AST,
      }
      defineSymbol(scope, sym)
      splits.set(sym, split)
    }
    networkScopes.set(network, scope)
  }
  return { vg, pou, networkScopes, splits }
}

/**
 * The type a split's USES are checked by — the one a build gives them, its FEEDER's (B6: the Demux holds none), or none
 * where the feeder's is unknown. BOOL for what is BOOL by the text alone (an ENO, an edge, a parallel, a comparison, the
 * left rail in LD); a variable leaf passes on its own declared type; another split carries what that one carries; any
 * other feeder the type its ST reading has, where the engine types it — never a guess.
 */
function usesTypeOf(
  v: NetworkValue,
  network: NetworkTextNetwork,
  vg: NetworkTextBody,
  pou: Scope,
  project: Scope,
  seen: Set<NetworkSplit>,
): { typeExpr?: TypeExpr } {
  switch (v.kind) {
    case "eno":
    case "edge":
    case "parallel":
      return named("BOOL", project)
    case "empty_slot":
      return vg.language === "LD" ? named("BOOL", project) : {}
    case "word":
      if (COMPARISONS.has(v.word)) return named("BOOL", project)
      break
    case "split_ref": {
      const other = network.splits.find((s) => s.name.text.toUpperCase() === v.name.text.toUpperCase())
      if (other === undefined || seen.has(other)) return {}
      seen.add(other)
      return usesTypeOf(other.definition.value, network, vg, pou, project, seen)
    }
    case "operand":
      if (v.expr?.kind === "ident_expr") {
        const sym = lookup(pou, v.expr.name)?.symbol
        if (sym !== undefined && VARIABLE_KINDS.has(sym.kind) && sym.typeExpr !== undefined) return { typeExpr: sym.typeExpr }
      }
      break
    case "call":
    case "execute":
      return {}
  }
  const expr = networkValueExpr(v)
  if (expr === undefined) return {}
  const t = inferExprType(expr, pou, project)
  return t.kind === "elementary" ? named(renderType(t), project) : {}
}

/** A type named by its spelling, as a declaration would write it. */
function named(text: string, project: Scope): { typeExpr?: TypeExpr } {
  const toks = lex(text, dialectOf(project)).filter((t) => t.kind !== "eof" && !isTrivia(t.kind))
  const type = parseTypeExprFromTokens(toks, dialectOf(project))
  return type !== undefined ? { typeExpr: type } : {}
}

/** The network containing `offset` paired with its resolution scope, or undefined when outside all. */
export function networkNetworkAt(analysis: NetworkTextAnalysis, offset: number): { network: NetworkTextNetwork; scope: Scope } | undefined {
  for (const [network, scope] of analysis.networkScopes) {
    if (offset >= network.span.start && offset < network.span.end) return { network, scope }
  }
  return undefined
}

/** The POU's scope as the parser asks it — the bridge's `NetworkScope`: whether a name is a POU, the FB type of an
 *  instance, and whether a declaration makes a name (what a split may not be named like, B6). Whether an operand is
 *  declared at all is no question of the parser's: the build — here `network-undeclared-identifier` — answers it. */
function scopeView(pou: Scope, project: Scope): NetworkScopeView {
  return {
    declares: (name) => lookup(pou, name) !== undefined,
    isPou: (name) => {
      const sym = lookup(pou, name)?.symbol
      return sym !== undefined && isPouSymbol(sym)
    },
    instanceType: (head) => {
      const toks = lex(head, dialectOf(project)).filter((t) => t.kind !== "eof" && !isTrivia(t.kind))
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
 * the parser asks it for the construct check and the pin check asks it for the pins, so the two cannot disagree about
 * the same head. A head that names a POU is a function (or the vendor's own box), whose parameters are no FB's pins.
 */
export function instanceFb(head: Expr, scope: Scope, project: Scope): FunctionBlockType | undefined {
  // S5 (openspec ld-fbd-coverage 2.3): `SUPER^` is the instance a derived FB calls its base through — its type is the base
  // the EXTENDS names, as the type engine reads `SUPER^` in ST.
  if (head.kind === "deref" && head.base.kind === "ident_expr" && head.base.name.toUpperCase() === "SUPER") {
    for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) {
      const t = inferExprType(head, s, project)
      if (t.kind === "function_block") return t
    }
    return undefined
  }
  if (head.kind === "ident_expr") {
    const kind = lookup(scope, head.name)?.symbol.kind
    if (kind === undefined || !VARIABLE_KINDS.has(kind)) return undefined
  } else if (head.kind === "index") {
    // 2R.5 (awkward-sweep #17): an ELEMENT of an array of FBs is an instance of the element type — one subscript group on
    // a name or a path, one index per dimension, as the bridge's `StDeclaration.TypeOfArrayElement` reads it (`m[0]` of
    // a 2-D array is a row, no instance).
    if (!isNamePath(head.base) || (head.base.kind === "ident_expr" && !VARIABLE_KINDS.has(lookup(scope, head.base.name)?.symbol.kind ?? "")))
      return undefined
    const array = inferExprType(head.base, scope, project)
    if (array.kind !== "array" || array.dims.length !== head.indices.length) return undefined
  } else if (head.kind !== "member") return undefined
  const t = inferExprType(head, scope, project)
  return t.kind === "function_block" ? t : undefined
}

/** A name or a dotted path of names (`fbs`, `GVL.fbs`) — no subscript, no call, no dereference. */
function isNamePath(e: Expr): boolean {
  return e.kind === "ident_expr" || (e.kind === "member" && isNamePath(e.base))
}

/**
 * Whether `head` heads an FB call — names a variable, whatever its type resolves to: an identifier a declaration makes a
 * variable, or a path (`GVL.timers.t1`, `inst.inner`, `Lib.gInst`). Any other head names a function or the vendor's own
 * operator box — a bare POU name, and a POU a namespace qualifies (`Util.Twice`). A qualifier whose member the namespace
 * does not show is left a path: unknown, so no finding rests on it.
 */
export function headIsVariable(head: Expr, scope: Scope, project: Scope): boolean {
  if (head.kind === "member") {
    const ns = head.base.kind === "ident_expr" ? lookup(scope, head.base.name)?.symbol : undefined
    if (ns?.kind !== "namespace") return true
    const nsScope = findChildScope(project, ns.name, scope.defUri)
    return nsScope === undefined || !lookupLocal(nsScope, head.member.name).some(isPouSymbol)
  }
  if (head.kind !== "ident_expr") return false
  const kind = lookup(scope, head.name)?.symbol.kind
  return kind !== undefined && VARIABLE_KINDS.has(kind)
}

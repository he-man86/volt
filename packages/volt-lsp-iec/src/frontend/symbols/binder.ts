/**
 * THE BINDER — a parsed unit into the project `Scope` tree: each top-level unit becomes a symbol in the project scope
 * with a child scope for its members, and the URI is propagated so cross-file LSP queries resolve. One `ingest*` per
 * unit kind, every scope through the one `makeScope` factory.
 *
 * The rest of a build is elsewhere: binding and unbinding whole files, and the canonical order (`incremental.ts`);
 * EXTENDS linking (`extends.ts`); library namespaces (`library-namespaces.ts`). No module-level state: every function
 * takes the target scope explicitly and mutates it.
 */
import type {
  Action,
  FunctionBlock,
  Function as FunctionAST,
  Interface,
  Namespace,
  Program,
  Property,
  PropertyAccessor,
  Method,
  ParseResult,
  TopLevel,
} from "../syntax/index.js"
import type { Scope } from "./model.js"
import { defineSymbol, makeScope } from "./scope.js"
import { ingestGlobalVarList, ingestVarSections } from "./bind-globals.js"
import { ingestTypeDecl } from "./bind-types.js"

export interface SymbolTableInput {
  /** URI of the source document. "" is allowed for tests that don't track URIs. */
  uri: string
  parseResult: ParseResult
  /** Raw source. The binder does not read it — the attribute it needs (`qualified_only`) is on the unit's AST node
   *  (`syntax/pragmas/attributes`, frontend-conformance 2.7.2); callers hand a whole document. */
  source?: string
}

function ingestTopLevel(
  project: Scope,
  unit: TopLevel,
  uri: string,
  memberHost: Scope | undefined,
): Scope | undefined {
  switch (unit.kind) {
    case "function_block":
      return ingestFunctionBlock(project, unit, uri)
    case "program":
      return ingestProgram(project, unit, uri)
    case "function":
      return ingestFunction(project, unit, uri)
    case "method":
      return ingestStandaloneMethod(project, unit, uri, memberHost)
    case "action":
      return ingestStandaloneAction(project, unit, uri, memberHost)
    case "property":
      ingestStandaloneProperty(project, unit, uri, memberHost)
      return undefined
    case "interface":
      return ingestInterface(project, unit, uri)
    case "type_decl":
      ingestTypeDecl(project, unit, uri)
      return undefined
    case "global_var_list":
      ingestGlobalVarList(project, unit, uri)
      return undefined
    case "namespace":
      ingestNamespace(project, unit, uri)
      return undefined
  }
}

function ingestNamespace(project: Scope, ns: Namespace, uri: string): void {
  const nsScope = makeScope(project, "namespace", ns.name.text, ns.span)
  defineSymbol(project, {
    kind: "namespace",
    name: ns.name.text,
    span: ns.name.span,
    declarationSpan: ns.span,
    owner: project,
    uri,
    ast: ns,
  })
  ingestUnits(nsScope, ns.units, uri)
}

/**
 * A run of units into `parent` — a file's top level, or a NAMESPACE block's — each METHOD/ACTION/PROPERTY parented to the
 * FB, PROGRAM or INTERFACE written before it in the same run (the workspace one-item-per-file layout: a POU, then its
 * members as siblings), and a FUNCTION ending that run of members. One home for the rule, so a namespace block follows
 * it as a file does (rule Y18 — a namespace ingest that passed no host left a METHOD after an FB on the namespace, where
 * its body resolved none of the FB's members).
 */
export function ingestUnits(parent: Scope, units: readonly TopLevel[], uri: string): void {
  let memberHost: Scope | undefined
  for (const unit of units) {
    const scope = ingestTopLevel(parent, unit, uri, memberHost)
    if (unit.kind === "function_block" || unit.kind === "program" || unit.kind === "interface") memberHost = scope
    if (unit.kind === "function") memberHost = undefined
  }
}

function ingestFunctionBlock(project: Scope, fb: FunctionBlock, uri: string): Scope {
  const fbScope = makeScope(
    project,
    "pou",
    fb.name.text,
    fb.span,
    {
      ...(fb.extends !== undefined ? { extendsName: fb.extends.text.toLowerCase() } : {}),
      ...(fb.headerRefused !== undefined ? { undeclared: true as const } : {}),
    },
  )
  // a header both vendors refuse leaves NO FB — only "Unknown type" where it is used, and no base where it is extended
  // (`FunctionBlock.headerRefused`, `Scope.undeclared`)
  if (fb.headerRefused === undefined) defineSymbol(project, {
    kind: "function_block",
    name: fb.name.text,
    span: fb.name.span,
    declarationSpan: fb.span,
    owner: project,
    uri,
    ast: fb,
  })
  ingestVarSections(fbScope, fb.varSections, uri)
  return fbScope
}

function ingestProgram(project: Scope, prg: Program, uri: string): Scope {
  const scope = makeScope(project, "pou", prg.name.text, prg.span)
  defineSymbol(project, {
    kind: "program",
    name: prg.name.text,
    span: prg.name.span,
    declarationSpan: prg.span,
    owner: project,
    uri,
    ast: prg,
  })
  ingestVarSections(scope, prg.varSections, uri)
  return scope
}

function ingestFunction(project: Scope, fn: FunctionAST, uri: string): Scope {
  const scope = makeScope(project, "pou", fn.name.text, fn.span)
  defineSymbol(project, {
    kind: "function",
    name: fn.name.text,
    span: fn.name.span,
    declarationSpan: fn.span,
    owner: project,
    uri,
    ...(fn.returnType !== undefined ? { typeExpr: fn.returnType } : {}),
    ast: fn,
  })
  ingestVarSections(scope, fn.varSections, uri)
  return scope
}

function ingestStandaloneMethod(project: Scope, m: Method, uri: string, memberHost?: Scope): Scope {
  // A METHOD after END_FUNCTION_BLOCK belongs to the preceding FB/PROGRAM: parent to it so the
  // body resolves member vars, and define the symbol on the host so `fbInst.Method` finds it.
  const host = memberHost ?? project
  const scope = makeScope(host, "method", m.name.text, m.span)
  defineSymbol(host, {
    kind: "method",
    name: m.name.text,
    span: m.name.span,
    declarationSpan: m.span,
    owner: host,
    uri,
    ...(m.returnType !== undefined ? { typeExpr: m.returnType } : {}),
    ast: m,
  })
  ingestVarSections(scope, m.varSections, uri, /* asParams */ true)
  return scope
}

function ingestStandaloneAction(project: Scope, a: Action, uri: string, memberHost?: Scope): Scope {
  const host = memberHost ?? project
  const scope = makeScope(host, "method", a.name.text, a.span)
  defineSymbol(host, {
    kind: "action",
    name: a.name.text,
    span: a.name.span,
    declarationSpan: a.span,
    owner: host,
    uri,
    ast: a,
  })
  return scope
}

function ingestStandaloneProperty(project: Scope, p: Property, uri: string, memberHost?: Scope): void {
  const host = memberHost ?? project
  defineSymbol(host, {
    kind: "property",
    name: p.name.text,
    span: p.name.span,
    declarationSpan: p.span,
    owner: host,
    uri,
    typeExpr: p.dataType,
    ast: p,
  })
  // A property scope, parented to the host so member vars + the property name (defined on the host above)
  // resolve, and matched by `p.span` identity so `scopeForUnit(project, propertyUnit)` finds it — without it
  // accessor bodies resolve against the project scope and every member reference is a false "not defined".
  // Each accessor gets its OWN child scope keyed by its body span so getter and setter locals never share a
  // scope: a shared scope would false-positive `duplicate-declaration` (two `tmp`) and mistype a same-named
  // local across accessors. `bodies()` resolves each accessor body to its child scope by body-span identity.
  const propScope = makeScope(host, "accessor", p.name.text, p.span)
  for (const a of [p.getter, p.setter] as (PropertyAccessor | undefined)[]) {
    if (a === undefined) continue
    const accessorScope = makeScope(propScope, "accessor", p.name.text, a.body.span)
    ingestVarSections(accessorScope, a.varSections, uri, /* asParams */ true)
  }
}

function ingestInterface(project: Scope, iface: Interface, uri: string): Scope {
  // its EXTENDS list, linked to the base interfaces with the FBs' and STRUCTs' bases (`linkExtends`, rule H4): a base's
  // member is the derived interface's (`inh_interface_extends_member`, both vendors run it)
  const bases = iface.extends?.map((b) => b.text.toLowerCase())
  const ifaceScope = makeScope(project, "interface", iface.name.text, iface.span, bases !== undefined && bases.length > 0 ? { interfaceExtends: bases } : undefined)
  defineSymbol(project, {
    kind: "interface",
    name: iface.name.text,
    span: iface.name.span,
    declarationSpan: iface.span,
    owner: project,
    uri,
    ast: iface,
  })
  for (const m of iface.methods) {
    defineSymbol(ifaceScope, {
      kind: "interface_method",
      name: m.name.text,
      span: m.name.span,
      declarationSpan: m.span,
      owner: ifaceScope,
      uri,
      ...(m.returnType !== undefined ? { typeExpr: m.returnType } : {}),
      ast: m,
    })
    // its parameters, bound in a scope of its own as a METHOD's are (rule H5): `itfRef.M(b := 2, a := 5)` binds each
    // argument to the interface method's parameter of its name (`inh_interface_method_param_resolves`, both vendors)
    ingestVarSections(makeScope(ifaceScope, "method", m.name.text, m.span), m.varSections, uri, /* asParams */ true)
  }
  for (const p of iface.properties) {
    defineSymbol(ifaceScope, {
      kind: "interface_property",
      name: p.name.text,
      span: p.name.span,
      declarationSpan: p.span,
      owner: ifaceScope,
      uri,
      typeExpr: p.dataType,
      ast: p,
    })
  }
  return ifaceScope
}


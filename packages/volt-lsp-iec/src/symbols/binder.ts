/**
 * The binder: walk the parsed AST(s) of a workspace and populate one project `Scope` tree
 * (Layer B). Cross-file — each top-level unit becomes a symbol in the project scope with a
 * child scope for its members, and the URI is propagated so cross-file LSP queries resolve.
 *
 * Two passes: (1) `ingest*` builds the tree via the one `makeScope` factory; (2) `linkExtends`
 * resolves each `EXTENDS` name to its base scope (split out — the base may live in a later file).
 * No module-level state: every function takes the target scope explicitly and mutates it.
 */
import type {
  Action,
  EnumBody,
  FunctionBlock,
  Function as FunctionAST,
  GlobalVarList,
  Interface,
  Namespace,
  Program,
  Property,
  Method,
  ParseResult,
  StructBody,
  TopLevel,
  TypeDecl,
  UnionBody,
  VarDecl,
  VarSection,
  VarSectionKind,
} from "../syntax/index.js"
import { lex } from "../syntax/index.js"
import { createProjectScope, defineSymbol, makeScope, type Scope, type SymbolKind } from "./symbol.js"

export interface SymbolTableInput {
  /** URI of the source document. "" is allowed for tests that don't track URIs. */
  uri: string
  parseResult: ParseResult
  /** Raw source — needed to detect file-level pragmas (`qualified_only`) stripped from the AST. */
  source?: string
}

const QUALIFIED_ONLY = /\{attribute\s+'qualified_only'\}/i

/**
 * True when the file carries an ACTIVE `{attribute 'qualified_only'}` pragma. Detected via the lexer, not
 * a raw-source regex: a commented-out `//{attribute 'qualified_only'}` lexes as a comment (not a `pragma`
 * token), so it is correctly ignored — a raw regex would match it and wrongly hide the GVL/enum's members
 * from bare access (the lenze `LST_General` case: commented attribute → bare `FF100ms` must still resolve).
 */
function hasQualifiedOnly(source: string): boolean {
  for (const tok of lex(source)) if (tok.kind === "pragma" && QUALIFIED_ONLY.test(tok.text)) return true
  return false
}

/** Build one project scope from a set of parsed files, then link EXTENDS bases across all of them. */
export function buildSymbolTable(files: readonly SymbolTableInput[]): Scope {
  const project = createProjectScope()
  for (const { uri, parseResult, source } of files) {
    // Track the most recent FB/PROGRAM/INTERFACE scope in THIS file so standalone
    // methods/actions/properties that follow it (the workspace one-item-per-file layout:
    // a POU, then its members as top-level siblings) parent to it — else member-var
    // references in those bodies resolve nowhere.
    let currentMemberHost: Scope | undefined
    for (const unit of parseResult.units) {
      const newScope = ingestTopLevel(project, unit, uri, currentMemberHost, source ?? "")
      if (unit.kind === "function_block" || unit.kind === "program" || unit.kind === "interface") {
        currentMemberHost = newScope
      }
      if (unit.kind === "function") currentMemberHost = undefined
    }
  }
  linkExtends(project)
  return project
}

/**
 * Post-pass: link each `EXTENDS` scope to its base scope. Separated from the ingest walk because
 * the base may live in a later file — resolution needs the whole project ingested first.
 */
export function linkExtends(project: Scope): void {
  const byName = new Map<string, Scope>()
  for (const c of project.children) {
    if (c.extendsName !== undefined || c.kind === "pou" || c.kind === "interface" || c.kind === "struct")
      byName.set(c.name.toLowerCase(), c)
  }
  for (const c of project.children) {
    if (c.extendsName === undefined) continue
    const base = byName.get(c.extendsName)
    if (base !== undefined && base !== c) c.baseScope = base
  }
}

function ingestTopLevel(
  project: Scope,
  unit: TopLevel,
  uri: string,
  memberHost: Scope | undefined,
  source: string,
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
      ingestTypeDecl(project, unit, uri, source)
      return undefined
    case "global_var_list":
      ingestGlobalVarList(project, unit, uri, source)
      return undefined
    case "namespace":
      ingestNamespace(project, unit, uri, source)
      return undefined
  }
}

function ingestNamespace(project: Scope, ns: Namespace, uri: string, source: string): void {
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
  for (const inner of ns.units) ingestTopLevel(nsScope, inner, uri, undefined, source)
}

function ingestFunctionBlock(project: Scope, fb: FunctionBlock, uri: string): Scope {
  const fbScope = makeScope(
    project,
    "pou",
    fb.name.text,
    fb.span,
    fb.extends !== undefined ? { extendsName: fb.extends.text.toLowerCase() } : undefined,
  )
  defineSymbol(project, {
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
}

function ingestInterface(project: Scope, iface: Interface, uri: string): Scope {
  const ifaceScope = makeScope(project, "interface", iface.name.text, iface.span)
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

function ingestTypeDecl(project: Scope, t: TypeDecl, uri: string, source: string): void {
  defineSymbol(project, {
    kind: "type",
    name: t.name.text,
    span: t.name.span,
    declarationSpan: t.span,
    owner: project,
    uri,
    ast: t,
  })
  switch (t.body.kind) {
    case "struct":
      ingestStruct(project, t, t.body, uri)
      break
    case "union":
      ingestUnion(project, t, t.body, uri)
      break
    case "enum":
      ingestEnum(project, t, t.body, uri, source)
      break
    case "alias":
      // Aliases add no members; the alias points at another type (resolved in layer C).
      break
  }
}

function ingestStruct(project: Scope, t: TypeDecl, body: StructBody, uri: string): void {
  // CODESYS DUT structs may `EXTENDS` a base struct — its fields are inherited (linked in `linkExtends`).
  const scope = makeScope(
    project,
    "struct",
    t.name.text,
    t.span,
    body.extends !== undefined ? { extendsName: body.extends.text.toLowerCase() } : undefined,
  )
  for (const field of body.fields) ingestVarDecl(scope, field, undefined, uri, /* asField */ true)
}

function ingestUnion(project: Scope, t: TypeDecl, body: UnionBody, uri: string): void {
  // Unions use struct-shaped scopes for lookup purposes.
  const scope = makeScope(project, "struct", t.name.text, t.span)
  for (const field of body.fields) ingestVarDecl(scope, field, undefined, uri, /* asField */ true)
}

function ingestEnum(project: Scope, t: TypeDecl, body: EnumBody, uri: string, source: string): void {
  // An enum's members are bare-accessible global constants UNLESS the enum carries
  // `{attribute 'qualified_only'}` — then only `EnumType.Member` resolves.
  const scope = makeScope(
    project,
    "enum",
    t.name.text,
    t.span,
    hasQualifiedOnly(source) ? { qualifiedOnly: true } : undefined,
  )
  for (const v of body.values) {
    defineSymbol(scope, {
      kind: "enum_value",
      name: v.name.text,
      span: v.name.span,
      declarationSpan: v.span,
      owner: scope,
      uri,
      ast: v,
    })
  }
}

function ingestGlobalVarList(project: Scope, gvl: GlobalVarList, uri: string, source: string): void {
  const qualifiedOnly = hasQualifiedOnly(source)

  // Register the GVL block itself under the URI basename — ST has no in-source name for the block,
  // the file basename IS the identifier (CODESYS convention). Lets `GvlName.field` resolve.
  const gvlName = gvlNameFromUri(uri)
  if (gvlName !== undefined) {
    defineSymbol(project, {
      kind: "gvl_block",
      name: gvlName,
      span: gvl.span,
      declarationSpan: gvl.span,
      owner: project,
      uri,
      ast: gvl,
    })
  }

  for (const section of gvl.varSections) {
    for (const decl of section.decls) {
      for (const name of decl.names) {
        defineSymbol(project, {
          kind: "gvl_var",
          name: name.text,
          span: name.span,
          declarationSpan: decl.span,
          owner: project,
          uri,
          typeExpr: decl.type,
          varSection: section.sectionKind,
          ...(section.constant ? { constant: true } : {}),
          ...(qualifiedOnly ? { qualifiedOnly: true } : {}),
          ast: decl,
        })
      }
    }
  }
}

/** Derive a GVL block name from its URI: basename minus extension. Splits on `/` AND `\` (Windows). */
function gvlNameFromUri(uri: string): string | undefined {
  if (uri.length === 0) return undefined
  const last = uri.split(/[\\/]/).pop() ?? ""
  if (last.length === 0) return undefined
  const dot = last.lastIndexOf(".")
  const name = dot > 0 ? last.slice(0, dot) : last
  return name.length > 0 ? name : undefined
}

function ingestVarSections(scope: Scope, sections: readonly VarSection[], uri: string, asParams = false): void {
  for (const section of sections) {
    for (const decl of section.decls) {
      ingestVarDecl(scope, decl, section.sectionKind, uri, false, asParams, section.constant === true)
    }
  }
}

function ingestVarDecl(
  scope: Scope,
  decl: VarDecl,
  sectionKind: VarSectionKind | undefined,
  uri: string,
  asField: boolean,
  asParam = false,
  constant = false,
): void {
  const kind: SymbolKind = asField
    ? "struct_field"
    : asParam && (sectionKind === "VAR_INPUT" || sectionKind === "VAR_OUTPUT" || sectionKind === "VAR_IN_OUT")
      ? "method_param"
      : "var"
  for (const name of decl.names) {
    defineSymbol(scope, {
      kind,
      ...(constant ? { constant: true } : {}),
      name: name.text,
      span: name.span,
      declarationSpan: decl.span,
      owner: scope,
      uri,
      typeExpr: decl.type,
      ...(sectionKind !== undefined ? { varSection: sectionKind } : {}),
      ast: decl,
    })
  }
  // Implicit enumeration `iState : (Idle, Running, Halted)` declares the var AND introduces each
  // value as a bare constant in the enclosing scope (CODESYS Implicit Enumeration rule).
  if (decl.type.kind === "implicit_enum_type") {
    for (const value of decl.type.values) {
      defineSymbol(scope, {
        kind: "enum_value",
        name: value.name.text,
        span: value.name.span,
        declarationSpan: value.name.span,
        owner: scope,
        uri,
        ast: decl,
      })
    }
  }
}

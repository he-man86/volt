/**
 * BINDING DUTs — a `TYPE … END_TYPE`'s symbol and scope: a STRUCT's and a UNION's fields, an ENUM's values. Split from
 * `binder.ts` (openspec lsp-same-standard design.md §2.2).
 */
import { type TypeDecl, type StructBody, type UnionBody, type EnumBody, hasFrontendAttribute } from "../syntax/index.js"
import { ingestVarDecl } from "./bind-globals.js"
import type { Scope } from "./model.js"
import { defineSymbol, makeScope } from "./scope.js"

export function ingestTypeDecl(project: Scope, t: TypeDecl, uri: string): void {
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
      ingestEnum(project, t, t.body, uri)
      break
    case "alias":
    case "refused":
      // An alias adds no members; it points at another type (resolved in layer C). A refused body has none.
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

function ingestEnum(project: Scope, t: TypeDecl, body: EnumBody, uri: string): void {
  // An enum's members are bare-accessible global constants UNLESS the enum carries
  // `{attribute 'qualified_only'}` — then only `EnumType.Member` resolves. Read per unit, from the AST (2.7.2).
  const scope = makeScope(
    project,
    "enum",
    t.name.text,
    t.span,
    hasFrontendAttribute(t, "qualified_only") ? { qualifiedOnly: true } : undefined,
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

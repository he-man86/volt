/**
 * `INTERFACE Name [EXTENDS A, B, C]
 *  <method signatures>
 *  <property signatures>
 *  END_INTERFACE`
 *
 * Interfaces declare signatures only — no method bodies, no field
 * VARs (interface methods can still declare VAR_INPUT / VAR_OUTPUT
 * sections, which compose into the method signature).
 *
 * Multiple inheritance: unlike FBs, interfaces can EXTENDS a list of
 * parent interfaces. Each parent is fully qualified by name; the
 * resolver flattens the chain at symbol-table build time.
 */
import type { Identifier, Interface, InterfaceMethod, InterfaceProperty } from "../ast.js"
import type { Cursor } from "../cursor.js"
import { parseTypeExpression } from "../type-expr.js"
import { collectVarSections, describeToken, identFromToken, joinSpans, skipFolderDirective } from "../util.js"

export function parseInterface(c: Cursor): Interface | undefined {
  const start = c.expectKeyword("INTERFACE", "at start of INTERFACE")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent("for INTERFACE name")
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // Optional EXTENDS X, Y, Z (interfaces can extend multiple)
  let extendsList: Identifier[] | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) {
    extendsList = []
    const first = parseQualifiedName(c, "after EXTENDS")
    if (first !== undefined) extendsList.push(first)
    while (c.eatPunct(",") !== undefined) {
      const more = parseQualifiedName(c, "in EXTENDS list")
      if (more === undefined) break
      extendsList.push(more)
    }
  }

  // IMPLEMENTS on an interface is illegal — interfaces inherit via EXTENDS. Capture the misused list so a
  // check can emit C0421 instead of the generic "unexpected keyword" recovery error.
  let implementsMisused: Identifier[] | undefined
  if (c.eatKeyword("IMPLEMENTS") !== undefined) {
    implementsMisused = []
    const first = parseQualifiedName(c, "after IMPLEMENTS")
    if (first !== undefined) implementsMisused.push(first)
    while (c.eatPunct(",") !== undefined) {
      const more = parseQualifiedName(c, "in IMPLEMENTS list")
      if (more === undefined) break
      implementsMisused.push(more)
    }
  }

  const methods: InterfaceMethod[] = []
  const properties: InterfaceProperty[] = []

  while (!c.atEof()) {
    const endIface = c.eatKeyword("END_INTERFACE")
    if (endIface !== undefined) {
      return {
        kind: "interface",
        name,
        ...(extendsList !== undefined ? { extends: extendsList } : {}),
        ...(implementsMisused !== undefined ? { implementsMisused } : {}),
        methods,
        properties,
        span: joinSpans(start.span, endIface.span),
      }
    }

    // A method that lives in a sub-folder carries a `%FOLDER <path>` directive (between members or
    // just before its END_METHOD) — bridge metadata, not interface content.
    if (skipFolderDirective(c)) continue

    const next = c.peek()
    if (next.kind === "keyword" && next.keyword === "METHOD") {
      const m = parseInterfaceMethod(c)
      if (m !== undefined) methods.push(m)
      continue
    }
    if (next.kind === "keyword" && next.keyword === "PROPERTY") {
      const p = parseInterfaceProperty(c)
      if (p !== undefined) properties.push(p)
      continue
    }
    // Unknown — record and skip
    c.pushError(`unexpected ${describeToken(next)} inside INTERFACE`, next.span)
    if (!c.recoverTo({ keywords: ["END_INTERFACE", "METHOD", "PROPERTY"] })) break
  }

  c.pushError("unterminated INTERFACE: expected END_INTERFACE", start.span)
  return {
    kind: "interface",
    name,
    ...(extendsList !== undefined ? { extends: extendsList } : {}),
    methods,
    properties,
    span: joinSpans(start.span, name.span),
  }
}

/** Read a possibly-qualified name (`Foo` or `__SYSTEM.IQueryInterface`) as a single dotted Identifier. */
function parseQualifiedName(c: Cursor, ctx: string): Identifier | undefined {
  const head = c.expectIdent(ctx)
  if (head === undefined) return undefined
  let id = identFromToken(head)
  while (c.peek().kind === "punct" && c.peek().text === "." && c.peek(1).kind === "identifier") {
    c.consume() // .
    const part = identFromToken(c.consume())
    id = { kind: "identifier", text: `${id.text}.${part.text}`, span: joinSpans(id.span, part.span) }
  }
  return id
}

function parseInterfaceMethod(c: Cursor): InterfaceMethod | undefined {
  const start = c.expectKeyword("METHOD", "at start of interface method")
  if (start === undefined) return undefined
  // Modifiers are allowed but informational on interfaces
  while (c.eatAnyKeyword("PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "FINAL", "ABSTRACT", "OVERRIDE") !== undefined) {
    // consume and ignore
  }
  const nameTok = c.expectName("for interface method name")
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  let returnType: InterfaceMethod["returnType"]
  if (c.eatPunct(":") !== undefined) {
    returnType = parseTypeExpression(c)
  }
  const varSections = collectVarSections(c)
  skipFolderDirective(c) // a folder-organized method carries `%FOLDER <path>` just before END_METHOD
  // One canonical form (matches the bridge + what `volt pull` emits): every interface method is
  // closed by END_METHOD. Redline a missing one so the agent writes the canonical form, not a shape
  // the bridge will reject on push (LSP diagnostics ⊇ bridge rejections).
  const endMethod = c.eatKeyword("END_METHOD")
  if (endMethod === undefined) c.pushError("expected END_METHOD to close the interface method", name.span)
  const endSpan = endMethod?.span ?? returnType?.span ?? name.span
  return {
    kind: "interface_method",
    name,
    ...(returnType !== undefined ? { returnType } : {}),
    varSections,
    span: joinSpans(start.span, endSpan),
  }
}

function parseInterfaceProperty(c: Cursor): InterfaceProperty | undefined {
  const start = c.expectKeyword("PROPERTY", "at start of interface property")
  if (start === undefined) return undefined
  // Modifiers are allowed but informational on interfaces (e.g. `PROPERTY PUBLIC Foo : T`).
  while (c.eatAnyKeyword("PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "FINAL", "ABSTRACT", "OVERRIDE") !== undefined) {
    // consume and ignore
  }
  const nameTok = c.expectName("for interface property name")
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  if (c.expectPunct(":", "after interface property name") === undefined) return undefined
  const dataType = parseTypeExpression(c)
  if (dataType === undefined) return undefined
  c.eatPunct(";") // some exports terminate the property data type with a trailing `;`
  // Interfaces declare which of GET/SET accessors are required. The bridge materializes each as a bare
  // keyword OR a full `GET … END_GET` block (with a leading `%FOLDER` directive when folder-organized).
  let hasGetter = false
  let hasSetter = false
  while (true) {
    if (skipFolderDirective(c)) continue
    const accessor = c.eatAnyKeyword("GET", "SET")
    if (accessor === undefined) break
    if (accessor.keyword === "GET") hasGetter = true
    if (accessor.keyword === "SET") hasSetter = true
    c.eatKeyword(accessor.keyword === "GET" ? "END_GET" : "END_SET") // block form: consume its closer
  }
  const endProp = c.eatKeyword("END_PROPERTY")
  const endSpan = endProp?.span ?? dataType.span
  return {
    kind: "interface_property",
    name,
    dataType,
    hasGetter,
    hasSetter,
    span: joinSpans(start.span, endSpan),
  }
}

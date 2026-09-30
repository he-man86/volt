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
import type { Identifier, Interface, InterfaceMethod, InterfaceProperty, VarSection } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { parseTypeExpression } from "../type-expr.js"
import { atVarSection, collectVarSections, parseVarSection } from "../declarations.js"
import { INTERFACE_MEMBER_MODIFIERS, type Keyword } from "../../lex/vocabulary.js"
import { joinSpans } from "../../span.js"
import { plainTokenText } from "../errors.js"
import { closesDeclaration, readFolderLine, reportMisplacedFolder } from "../../format/folder.js"
import { identFromToken, joinedName, readModifiers, readNameList, readQualifiedName } from "../names.js"

export function parseInterface(c: Cursor): Interface | undefined {
  const start = c.expectKeyword("INTERFACE")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // Optional EXTENDS X, Y, Z (interfaces can extend multiple)
  let extendsList: Identifier[] | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) {
    extendsList = []
    const first = parseQualifiedName(c)
    if (first !== undefined) extendsList.push(first)
    extendsList.push(...readNameList(c, () => parseQualifiedName(c)))
  }

  // IMPLEMENTS on an interface is illegal — interfaces inherit via EXTENDS. Capture the misused list so a
  // check can emit C0421 instead of the generic "unexpected keyword" recovery error.
  let implementsMisused: Identifier[] | undefined
  if (c.eatKeyword("IMPLEMENTS") !== undefined) {
    implementsMisused = []
    const first = parseQualifiedName(c)
    if (first !== undefined) implementsMisused.push(first)
    implementsMisused.push(...readNameList(c, () => parseQualifiedName(c)))
  }

  const methods: InterfaceMethod[] = []
  const properties: InterfaceProperty[] = []
  // VAR sections placed directly in the interface body are illegal — interfaces declare signatures only.
  // Capture them (instead of the generic recovery error) so a check can emit C0149.
  const strayVarSections: VarSection[] = []

  while (!c.atEof()) {
    const endIface = c.eatKeyword("END_INTERFACE")
    if (endIface !== undefined) {
      return {
        kind: "interface",
        name,
        ...(extendsList !== undefined ? { extends: extendsList } : {}),
        ...(implementsMisused !== undefined ? { implementsMisused } : {}),
        ...(strayVarSections.length > 0 ? { strayVarSections } : {}),
        methods,
        properties,
        span: joinSpans(start.span, endIface.span),
      }
    }

    // A member's `%FOLDER` closes the member's OWN declaration (read in `parseInterfaceMethod`/`Property`). Between
    // members it is the next member's declaration text, which the push refuses.
    const stray = readFolderLine(c)
    if (stray !== undefined) {
      reportMisplacedFolder(c, stray)
      continue
    }

    // A VAR section here is illegal (C0149) but well-formed — parse and capture it rather than
    // spraying recovery errors token-by-token.
    if (atVarSection(c)) {
      const s = parseVarSection(c)
      if (s !== undefined) strayVarSections.push(s)
      continue
    }

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
    c.pushError(`unexpected ${plainTokenText(next)} inside INTERFACE`, next.span)
    if (!c.recoverTo({ keywords: ["END_INTERFACE", "METHOD", "PROPERTY"] })) break
  }

  c.pushError("unterminated INTERFACE: expected END_INTERFACE", start.span)
  return {
    kind: "interface",
    name,
    ...(extendsList !== undefined ? { extends: extendsList } : {}),
    ...(strayVarSections.length > 0 ? { strayVarSections } : {}),
    methods,
    properties,
    span: joinSpans(start.span, name.span),
  }
}

/** Read a possibly-qualified name (`Foo` or `__SYSTEM.IQueryInterface`) as a single dotted Identifier. */
function parseQualifiedName(c: Cursor): Identifier | undefined {
  const head = c.expectIdent()
  return head === undefined ? undefined : joinedName(readQualifiedName(c, head, "leave"))
}

function parseInterfaceMethod(c: Cursor): InterfaceMethod | undefined {
  const start = c.expectKeyword("METHOD")
  if (start === undefined) return undefined
  const modifiers = readModifiers(c, INTERFACE_MEMBER_MODIFIERS).map((m) => m.keyword!)
  const nameTok = c.expectName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  let returnType: InterfaceMethod["returnType"]
  if (c.eatPunct(":") !== undefined) {
    returnType = parseTypeExpression(c)
  }
  // A method in a sub-folder closes its declaration with `%FOLDER <path>` — the line directly before END_METHOD, where
  // the push reads it (`StReader.PeelFolderClosing`). Anywhere else in the method the push refuses it.
  const varSections: VarSection[] = []
  let folder: string | undefined
  for (;;) {
    varSections.push(...collectVarSections(c))
    const directive = readFolderLine(c)
    if (directive === undefined) break
    if (directive.path !== undefined && closesDeclaration(c, ["END_METHOD"], true)) folder = directive.path
    else reportMisplacedFolder(c, directive)
  }
  // One canonical form (matches the bridge + what `volt pull` emits): every interface method is
  // closed by END_METHOD. Redline a missing one so the agent writes the canonical form, not a shape
  // the bridge will reject on push (LSP diagnostics ⊇ bridge rejections).
  const endMethod = c.eatKeyword("END_METHOD")
  if (endMethod === undefined) c.pushError("expected END_METHOD to close the interface method", name.span)
  const endSpan = endMethod?.span ?? returnType?.span ?? name.span
  return {
    kind: "interface_method",
    name,
    modifiers,
    ...(folder !== undefined ? { folder } : {}),
    ...(returnType !== undefined ? { returnType } : {}),
    varSections,
    span: joinSpans(start.span, endSpan),
  }
}

function parseInterfaceProperty(c: Cursor): InterfaceProperty | undefined {
  const start = c.expectKeyword("PROPERTY")
  if (start === undefined) return undefined
  // Modifiers are allowed but informational on interfaces (e.g. `PROPERTY PUBLIC Foo : T`).
  const modifiers = readModifiers(c, INTERFACE_MEMBER_MODIFIERS).map((m) => m.keyword!)
  const nameTok = c.expectName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  if (c.expectPunct(":") === undefined) return undefined
  const dataType = parseTypeExpression(c)
  if (dataType === undefined) return undefined
  c.eatPunct(";") // some exports terminate the property data type with a trailing `;`
  // Interfaces declare which of GET/SET accessors are required. The bridge materializes each as a bare
  // keyword OR a full `GET … END_GET` block (with a leading `%FOLDER` directive when folder-organized).
  //
  // AN INTERFACE ACCESSOR CAN CARRY A VAR SECTION, and that is the vendor's content, not a mistake. It has no
  // BODY (DIALECT D21 — the accessor declares that a getter exists and nothing more), but bodiless is not
  // declaration-less: a live census of pro2193 found 263 accessors holding a bare `VAR`/`END_VAR`, interface
  // ones included. This loop used to jump straight from `GET` to `END_GET`, so the moment Volt stopped
  // dropping those declarations, five of the corpus's interfaces stopped parsing: the VAR fell through to the
  // stray-VAR arm below (a C0149 false positive on legal code) and `END_GET` then arrived with nothing
  // expecting it. Consume the declaration here, where it belongs.
  let hasGetter = false
  let hasSetter = false
  let folder: string | undefined
  while (true) {
    // The property's `%FOLDER` is the last line of its declaration, before its first accessor (`StReader.ReadProperty`).
    const directive = readFolderLine(c)
    if (directive !== undefined) {
      const closing =
        directive.path !== undefined &&
        folder === undefined &&
        !hasGetter &&
        !hasSetter &&
        closesDeclaration(c, ["GET", "SET", "END_PROPERTY"], false)
      if (closing) folder = directive.path
      else reportMisplacedFolder(c, directive)
      continue
    }
    const accessor = c.eatAnyKeyword("GET", "SET")
    if (accessor === undefined) break
    if (accessor.keyword === "GET") hasGetter = true
    if (accessor.keyword === "SET") hasSetter = true

    // Block form: whatever the accessor declares, then its closer. The vars are local temps of a body that
    // does not exist, so they are consumed rather than captured — but only VAR sections are, so anything genuinely
    // unexpected still reaches the recovery error instead of being swallowed here. A `%FOLDER` line in here is
    // the accessor's declaration text, which the push refuses.
    const closer = accessor.keyword === "GET" ? "END_GET" : "END_SET"
    while (true) {
      const stray = readFolderLine(c)
      if (stray !== undefined) {
        reportMisplacedFolder(c, stray)
        continue
      }
      if (!atVarSection(c)) break
      if (parseVarSection(c) === undefined) break
    }
    c.eatKeyword(closer)
  }
  const endProp = c.eatKeyword("END_PROPERTY")
  const endSpan = endProp?.span ?? dataType.span
  return {
    kind: "interface_property",
    name,
    modifiers,
    ...(folder !== undefined ? { folder } : {}),
    dataType,
    hasGetter,
    hasSetter,
    span: joinSpans(start.span, endSpan),
  }
}

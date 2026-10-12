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
import type { Identifier, Interface, InterfaceMethod, InterfaceProperty, VarSection } from "../../ast/nodes/index.js"
import type { Cursor } from "../cursor.js"
import { parseTypeExpression } from "../type-expr.js"
import { emptyType, refusedEmptyType } from "./header.js"
import { atVarSection, collectVarSections, parseVarSection } from "../declarations.js"
import { MEMBER_MODIFIERS } from "../../lex/word-sets.js"
import { joinSpans, type Span } from "../../span.js"
import { atObjectEnd, vendorTokenText } from "../errors.js"
import { closesDeclaration, readFolderLine, reportMisplacedFolder } from "../../format/folder.js"
import { identFromToken, readHeaderNames, readModifiers, readPropertyModifiers, refusedAccessModifier } from "../names.js"

/** What an interface's body holds, read member by member (`parseInterfaceMember`). */
interface InterfaceBody {
  methods: InterfaceMethod[]
  properties: InterfaceProperty[]
  // VAR sections placed directly in the interface body are illegal — interfaces declare signatures only.
  // Capture them (instead of the generic recovery error) so a check can emit C0149.
  strayVarSections: VarSection[]
}

export function parseInterface(c: Cursor): Interface | undefined {
  const start = c.expectKeyword("INTERFACE")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // Optional EXTENDS X, Y, Z (interfaces can extend multiple; `unit_interface_extends_list`), each possibly qualified
  // (`__SYSTEM.IQueryInterface`, `unit_interface_extends_qualified`)
  let extendsList: Identifier[] | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) extendsList = readHeaderNames(c)

  // IMPLEMENTS on an interface is illegal — interfaces inherit via EXTENDS. Capture the misused list so a
  // check can emit C0421 instead of the generic "unexpected keyword" recovery error.
  let implementsMisused: Identifier[] | undefined
  if (c.eatKeyword("IMPLEMENTS") !== undefined) implementsMisused = readHeaderNames(c)

  const body: InterfaceBody = { methods: [], properties: [], strayVarSections: [] }
  const node = (end: Span): Interface => ({
    kind: "interface",
    name,
    ...(extendsList !== undefined ? { extends: extendsList } : {}),
    ...(implementsMisused !== undefined ? { implementsMisused } : {}),
    ...(body.strayVarSections.length > 0 ? { strayVarSections: body.strayVarSections } : {}),
    methods: body.methods,
    properties: body.properties,
    span: joinSpans(start.span, end),
  })

  while (!c.atEof()) {
    const endIface = c.eatKeyword("END_INTERFACE")
    if (endIface !== undefined) return node(endIface.span)
    if (!parseInterfaceMember(c, body)) break
  }

  c.pushError("unterminated INTERFACE: expected END_INTERFACE", start.span)
  return node(name.span)
}

/** The next member of an interface's body into `body` — false when nothing is left to resume the body at. */
function parseInterfaceMember(c: Cursor, body: InterfaceBody): boolean {
  // A member's `%FOLDER` closes the member's OWN declaration (read in `parseInterfaceMethod`/`Property`). Between
  // members it is the next member's declaration text, which the push refuses.
  const stray = readFolderLine(c)
  if (stray !== undefined) {
    reportMisplacedFolder(c, stray)
    return true
  }

  // A VAR section here is illegal (C0149) but well-formed — parse and capture it rather than
  // spraying recovery errors token-by-token.
  if (atVarSection(c)) {
    const s = parseVarSection(c)
    if (s !== undefined) body.strayVarSections.push(s)
    return true
  }

  const next = c.peek()
  if (next.kind === "keyword" && next.keyword === "METHOD") {
    const m = parseInterfaceMethod(c)
    if (m !== undefined) body.methods.push(m)
    return true
  }
  if (next.kind === "keyword" && next.keyword === "PROPERTY") {
    const p = parseInterfaceProperty(c)
    if (p !== undefined) body.properties.push(p)
    return true
  }
  // A NAME where a member belongs is read as a declaration's name, and the `,`, AT or `:` it wants is missing: "',, AT
  // or :' expected instead of ''" before END_INTERFACE, which the push strips (`rec_interface_stray`, CODESYS 2026-10-02;
  // TwinCAT first reads the declaration back, "VAR, VAR_INPUT, VAR_OUTPUT or VAR_INOUT expected instead of stray:;",
  // a known divergence). ANY OTHER TOKEN is refused as a statement start is, and the statement it would open then wants
  // its `;` where the object ends: "Unexpected token 'END_IF' found", "';' expected instead of end of POU"
  // (`rec_interface_stray_keyword`, both vendors 2026-10-02). What stands between it and the object's end is unmeasured.
  if (next.kind === "identifier") {
    c.consume()
    const after = c.peek()
    c.pushError(`',, AT or :' expected instead of ${atObjectEnd(after) ? "''" : vendorTokenText(after)}`, after.span)
  } else {
    c.consume()
    c.pushError(`Unexpected token ${vendorTokenText(next)} found`, next.span, next.text)
    const after = c.peek()
    if (atObjectEnd(after)) c.pushError("';' expected instead of end of POU", after.span)
  }
  return c.recoverTo({ keywords: ["END_INTERFACE", "METHOD", "PROPERTY"] })
}

function parseInterfaceMethod(c: Cursor): InterfaceMethod | undefined {
  const start = c.expectKeyword("METHOD")
  if (start === undefined) return undefined
  // an access modifier stands only first, in a method's words (`unit_interface_method_final_public_order`, CODESYS)
  const written = readModifiers(c, MEMBER_MODIFIERS)
  const refused = refusedAccessModifier(written)
  if (refused !== undefined) c.pushError(`Identifier expected instead of '${refused.text}'`, refused.span)
  const modifiers = written.map((m) => m.keyword!)
  const nameTok = c.expectUnitName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  let returnType: InterfaceMethod["returnType"]
  const colon = c.eatPunct(":")
  if (colon !== undefined && !refusedEmptyType(c, colon.span, ["END_METHOD"])) {
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
  // A property's modifiers, refused as a function block's are (`unit_interface_property_final_public_order`,
  // `_abstract_final`, CODESYS 2026-10-01)
  const modifiers = readPropertyModifiers(c)
  const nameTok = c.expectUnitName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  const colon = c.expectPunct(":")
  if (colon === undefined) return undefined
  const dataType = refusedEmptyType(c, colon.span, ["GET", "SET", "END_PROPERTY"])
    ? emptyType(colon.span)
    : parseTypeExpression(c)
  if (dataType === undefined) return undefined
  c.eatPunct(";") // some exports terminate the property data type with a trailing `;`
  const { hasGetter, hasSetter, getterVarSections, setterVarSections, folder } = readInterfaceAccessors(c)
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
    getterVarSections,
    setterVarSections,
    span: joinSpans(start.span, endSpan),
  }
}

/**
 * Interfaces declare which of GET/SET accessors are required. The bridge materializes each as a bare
 * keyword OR a full `GET … END_GET` block (with a leading `%FOLDER` directive when folder-organized).
 *
 * AN INTERFACE ACCESSOR CAN CARRY A VAR SECTION, and that is the vendor's content, not a mistake. It has no
 * BODY (DIALECT D21 — the accessor declares that a getter exists and nothing more), but bodiless is not
 * declaration-less: a live census of pro2193 found 263 accessors holding a bare `VAR`/`END_VAR`, interface
 * ones included. This loop used to jump straight from `GET` to `END_GET`, so the moment Volt stopped
 * dropping those declarations, five of the corpus's interfaces stopped parsing: the VAR fell through to the
 * stray-VAR arm below (a C0149 false positive on legal code) and `END_GET` then arrived with nothing
 * expecting it. Consume the declaration here, where it belongs.
 */
function readInterfaceAccessors(c: Cursor): {
  hasGetter: boolean
  hasSetter: boolean
  getterVarSections: VarSection[]
  setterVarSections: VarSection[]
  folder?: string
} {
  let hasGetter = false
  let hasSetter = false
  const getterVarSections: VarSection[] = []
  const setterVarSections: VarSection[] = []
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
    readAccessorVarSections(c, accessor.keyword === "GET" ? getterVarSections : setterVarSections)
    c.eatKeyword(accessor.keyword === "GET" ? "END_GET" : "END_SET")
  }
  return { hasGetter, hasSetter, getterVarSections, setterVarSections, ...(folder !== undefined ? { folder } : {}) }
}

/**
 * Block form: whatever the accessor declares, then its closer. The vars are local temps of a body that does not
 * exist, but they are the vendor's stored declaration, so they are KEPT (U21) — the formatter prints them back. Only
 * VAR sections are read, so anything genuinely unexpected still reaches the recovery error instead of being
 * swallowed here. A `%FOLDER` line in here is the accessor's declaration text, which the push refuses.
 */
function readAccessorVarSections(c: Cursor, into: VarSection[]): void {
  while (true) {
    const stray = readFolderLine(c)
    if (stray !== undefined) {
      reportMisplacedFolder(c, stray)
      continue
    }
    if (!atVarSection(c)) break
    const section = parseVarSection(c)
    if (section === undefined) break
    into.push(section)
  }
}

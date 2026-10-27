/**
 * EXCLUDED FROM BUILD — which objects of one document the compiler does not build (openspec lsp-excluded-from-build).
 * CODESYS compiles no excluded object: it has no signature in any precompile context (DIALECT C2j). The policy is
 * `pipeline/document` (an excluded object gives nothing, as a dead POU gives nothing) and `reachability` (excluded code
 * is no edge and no root).
 *
 * EFFECTIVE exclusion is decided here and nowhere else: an object is excluded when its own `%EXCLUDE_FROM_BUILD` is set
 * or an object above it in the IDE tree is excluded. The file's own object (its POU, DUT, GVL or interface) is above
 * every member in the file, so its flag excludes the whole file. The folder half ("or a folder above it has a `.folder`
 * descriptor stating Exclude from build", openspec excluded-folder-items-pulled) is added to this function.
 *
 * The flag is read where the push reads it: the object's property lines (`syntax/format/object-properties.ts`), kept
 * on the AST as `objectProperties`. A `%EXCLUDE_FROM_BUILD` anywhere else is code or a comment, and excludes nothing.
 */
import type { ParseResult, Span, TopLevel } from "../../frontend/syntax/index.js"

const FLAG = "%EXCLUDE_FROM_BUILD"
const flagged = (properties: readonly string[] | undefined): boolean => properties?.includes(FLAG) === true

/** Whether a unit's own property lines carry the flag. */
function ownFlag(u: TopLevel): boolean {
  if (u.kind === "namespace") return false // a library's namespace, which no file's text spells
  // a POU, a method and an action: under the %LANGUAGE line (a method with no body slot: closing its declaration); a
  // property, an interface, a DUT, a GVL: closing the declaration
  if (u.kind === "property" || u.kind === "interface" || u.kind === "type_decl" || u.kind === "global_var_list")
    return flagged(u.objectProperties)
  return flagged(u.body.languageLine?.objectProperties ?? u.body.noSlot?.objectProperties)
}

/** The spans of the members inside a unit that carry their own flag: an interface's methods and properties. (A
 *  property's accessor has no property lines: the push peels none under its %LANGUAGE line.) */
function flaggedInside(u: TopLevel): Span[] {
  if (u.kind === "interface") return [...u.methods, ...u.properties].filter((m) => flagged(m.objectProperties)).map((m) => m.span)
  return []
}

/** The objects of one document that are excluded from build, by their own flag or an excluded object above them: the
 *  whole `file`, or the spans of the members excluded by their own flag. */
export function effectivelyExcluded(parseResult: ParseResult): { file: boolean; objects: Span[] } {
  const [own, ...members] = parseResult.units
  if (own !== undefined && ownFlag(own)) return { file: true, objects: [] }
  const objects: Span[] = own === undefined ? [] : flaggedInside(own)
  for (const m of members) {
    if (ownFlag(m)) objects.push(m.span)
    else objects.push(...flaggedInside(m))
  }
  return { file: false, objects }
}

/** True when `span` starts inside one of `objects` — the per-finding test. */
export function inExcluded(span: Span, objects: readonly Span[]): boolean {
  return objects.some((o) => span.start >= o.start && span.start < o.end)
}

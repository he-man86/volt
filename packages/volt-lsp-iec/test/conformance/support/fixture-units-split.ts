/**
 * A FIXTURE'S SOURCE CUT INTO THE IDE'S OBJECTS — one load unit per top-level unit, its members, declaration and code
 * text, and the pragmas that stand before it. One concern of `fixture-units.ts` (openspec lsp-same-standard 4.4).
 */
import { type TopLevel, type VarSection, parseSource, type Span, type BodySpan } from "../../../src/index.js"
import type { LanguageTest } from "../types.js"
import type { LoadUnit, LoadMember, LoadAccessor } from "./fixture-units.js"

// ─── the split ────────────────────────────────────────────────────────────────

export function asUnit(t: LanguageTest, source: string, unit: TopLevel, pragmas: string): LoadUnit {
  switch (unit.kind) {
    case "function_block":
    case "program":
    case "function": {
      const declaration = pragmas + declarationText(source, unit.span.start, unit.body)
      const stated = unit.body.implementation?.statement
      if (stated?.kind === "unsupported") {
        // A body Volt does not show has no text to load. Only an SFC one has a chart CODESYS makes by itself; any other
        // would be a POU loaded without the body the fixture is about — refused by name rather than loaded empty.
        if (stated.language.toUpperCase() !== "SFC")
          throw new Error(`${t.name}: '${unit.name.text}' states IMPLEMENTATION ${stated.language} UNSUPPORTED — only an SFC body can be loaded without its text`)
        if (t.sfcStep === undefined) throw new Error(`${t.name}: '${unit.name.text}' is an SFC POU and the fixture names no sfcStep for its chart`)
        return { kind: unit.kind, name: unit.name.text, declaration, implementation: "", members: [], language: "sfc", step: t.sfcStep }
      }
      return { kind: unit.kind, name: unit.name.text, declaration, implementation: codeText(source, unit.body), members: [] }
    }
    case "type_decl":
      return { kind: "dut", name: unit.name.text, declaration: pragmas + withEnd(source, unit.span), implementation: "", members: [] }
    case "interface": {
      // An interface object holds only its header; each METHOD/PROPERTY prototype is a child object. Written whole, the
      // declaration was refused ("Unexpected token 'END_INTERFACE' found").
      const members = [...unit.methods, ...unit.properties].sort((a, b) => a.span.start - b.span.start)
      const header = source.slice(unit.span.start, members[0]?.span.start ?? unit.span.end).replace(/\s*END_INTERFACE\s*$/i, "")
      return {
        kind: "interface",
        name: unit.name.text,
        declaration: pragmas + header.trim() + "\n",
        implementation: "",
        members: members.map((m): LoadMember => {
          if (m.kind === "interface_method") return { kind: "method", name: m.name.text, declaration: bodyText(source, m.span), implementation: "" }
          // Only the accessors the text names: giving an unnamed one both made CODESYS demand `__SETVALUE` of a GET-only
          // implementation the bridge build had accepted (`interface_with_property`).
          // AS WRITTEN: the header with its modifiers, and each accessor's VAR sections. Both used to be synthesized —
          // `PROPERTY <name> : <type>` and an empty accessor — so `unit_interface_property_private` and
          // `unit_interface_property_accessor_var` put a question to CODESYS that none of them asks (conformance 2.4).
          const accessor = (sections: readonly VarSection[]): LoadAccessor => ({
            declaration: sections.map((v) => source.slice(v.span.start, v.span.end)).join("\n"),
            implementation: "",
          })
          return {
            kind: "property",
            name: m.name.text,
            declaration: `${source.slice(m.span.start, m.dataType.span.end)}\n`,
            implementation: "",
            ...(m.hasGetter ? { get: accessor(m.getterVarSections) } : {}),
            ...(m.hasSetter ? { set: accessor(m.setterVarSections) } : {}),
          }
        }),
      }
    }
    case "global_var_list": {
      // A GVL has no name in its text; the fixture's pouName is the object's name — or, for a fixture holding SEVERAL
      // lists, the matching entry of `gvlNames`, since two objects cannot share one name on the wire.
      const lists = parseSource(source, { networkText: true }, "codesys").units.filter((u) => u.kind === "global_var_list")
      const at = lists.findIndex((u) => u.span.start === unit.span.start)
      return { kind: "gvl", name: t.gvlNames?.[at] ?? t.pouName, declaration: pragmas + withEnd(source, unit.span), implementation: "", members: [] }
    }
    default:
      throw new Error(`${t.name}: no CODESYS object for a top-level ${unit.kind}`)
  }
}

export function asMember(source: string, unit: TopLevel, pragmas: string): LoadMember | undefined {
  if (unit.kind === "method")
    return {
      kind: "method",
      name: unit.name.text,
      declaration: pragmas + declarationText(source, unit.span.start, unit.body),
      implementation: codeText(source, unit.body),
    }
  if (unit.kind === "action") return { kind: "action", name: unit.name.text, declaration: pragmas, implementation: codeText(source, unit.body) }
  if (unit.kind === "property") {
    const first = unit.getter?.span.start ?? unit.setter?.span.start ?? unit.span.end
    const accessor = (a: typeof unit.getter): LoadAccessor | undefined =>
      a === undefined ? undefined : { declaration: varSectionsText(source, a.varSections), implementation: codeText(source, a.body) }
    return {
      kind: "property",
      name: unit.name.text,
      declaration: pragmas + source.slice(unit.span.start, first).trimEnd() + "\n",
      implementation: "",
      ...(unit.getter === undefined ? {} : { get: accessor(unit.getter) }),
      ...(unit.setter === undefined ? {} : { set: accessor(unit.setter) }),
    }
  }
  return undefined
}

/**
 * A body's statements, without the keyword that CLOSES its unit when the span happens to include it. Only a unit
 * terminator is stripped: stripping any trailing `END_…` cut the `END_FOR` off a method whose body ends in a loop, and
 * seven fixtures stopped compiling in the simulator ("Unexpected End-of-file found: 'END_FOR' expected").
 */
function bodyText(source: string, span: Span): string {
  return (
    source
      .slice(span.start, span.end)
      .replace(/\s*\bEND_(FUNCTION_BLOCK|PROGRAM|FUNCTION|METHOD|ACTION|GET|SET|PROPERTY)\b\s*$/i, "")
      .trim() + "\n"
  )
}

/**
 * A body's CODE — what the IDE holds as the implementation. A fixture written as a workspace file holds it (`asSent`)
 * states its body's `IMPLEMENTATION ST` line, which is no code in any language: the parser takes it out of the body's
 * tokens, and the text loaded into the IDE starts under it, as the push strips it. Loaded with the line, CODESYS read it
 * as code ("',, AT or :' expected instead of 'ST'", `pwh_fb_text_says_program`, 2026-09-30). The declaration stops
 * above it for the same reason.
 */
function declarationText(source: string, start: number, body: BodySpan): string {
  return source.slice(start, body.implementation?.span.start ?? body.span.start).trimEnd() + "\n"
}

function codeText(source: string, body: BodySpan): string {
  if (body.implementation === undefined) return bodyText(source, body.span)
  return bodyText(source, { ...body.span, start: body.implementation.span.end })
}

/** A declaration-only unit's whole text, its END_ keyword included (the span stops before it). */
function withEnd(source: string, span: Span): string {
  const end = /^\s*END_\w+;?/i.exec(source.slice(span.end))
  return source.slice(span.start, span.end + (end?.[0].length ?? 0)).trim() + "\n"
}

function varSectionsText(source: string, sections: readonly VarSection[]): string {
  if (sections.length === 0) return ""
  return source.slice(sections[0]!.span.start, sections.at(-1)!.span.end).trim() + "\n"
}

/** The pragma lines in the gap before a unit — after the previous unit's END_ keyword. */
export function pragmasBefore(source: string, from: number, to: number): string {
  const gap = source.slice(from, to).replace(/^\s*END_\w+;?/i, "")
  const found = gap.match(/\{[^}]*\}/g)
  return found === null ? "" : found.join("\n") + "\n"
}

/**
 * A FILE WITH EVERY PLAIN-ST NETWORK BODY AS ITS EXEC TWIN (`network-twin.ts`): the source edits that put each twin in place
 * of its body and declare the variables it needs.
 */
import {
  allUnits,
  type BodySpan,
  isPlainStNetworkBody,
  type ParseResult,
  type Statement,
  type TopLevel,
  unitBodies,
} from "../../src/frontend/syntax/index.js"
import { bodies, type Scope } from "../../src/frontend/symbols/index.js"
import { type BodyTwin, TwinRefusal, twinOf } from "./network-twin.js"

/** Every plain-ST network body of a parse with the scope it resolves in, its compiled statements, its unit. */
export function* networkBodies(parseResult: ParseResult, project: Scope): Generator<{ unit: TopLevel; body: BodySpan; scope: Scope; statements: readonly Statement[] }> {
  const wanted = new Set<BodySpan>()
  for (const unit of allUnits(parseResult.units)) for (const b of unitBodies(unit)) if (isPlainStNetworkBody(b)) wanted.add(b)
  for (const b of bodies(parseResult.units, project)) if (wanted.has(b.body)) yield b
}

/** An edit of the source: replace [start, end) with `text`. */
interface Edit {
  start: number
  end: number
  text: string
}

/**
 * A file with every plain-ST network body as its twin (`%LANGUAGE ST`), the variables each twin needs declared in the
 * unit that owns its scope — its wires, ENO temps and edge detectors in a `VAR` block; a POU's or
 * a METHOD's own declaration, an ACTION's (which has none) its POU's. A body the twin cannot write is named in `refused`
 * and left as it is.
 */
export function twinFile(source: string, parseResult: ParseResult, project: Scope): { source: string; refused: string[]; twinned: number } {
  const edits: Edit[] = []
  const refused: string[] = []
  let k = 0
  const units = allUnits(parseResult.units)
  for (const { unit, body, scope, statements } of networkBodies(parseResult, project)) {
    k++
    let twin: BodyTwin
    try {
      twin = twinOf(body, statements, scope, project, source, k)
    } catch (e) {
      if (!(e instanceof TwinRefusal)) throw e
      refused.push(`${unitName(unit)}: ${e.message}`)
      continue
    }
    const line = body.languageLine!
    edits.push({ start: line.span.start, end: Math.max(body.span.end, line.span.end), text: `%LANGUAGE ST\n${twin.code}\n` })
    if (twin.declarations.length === 0 && twin.wires.length === 0) continue
    // an ACTION's POU is the program or function block before it in the file (a pull writes the members after their POU)
    const owner = unit.kind === "action" ? [...units].reverse().find((u) => (u.kind === "program" || u.kind === "function_block") && u.span.start < unit.span.start) ?? unit : unit
    const at = owner === unit ? line.span.start : ("body" in owner && owner.body.kind === "body" ? owner.body.languageLine?.span.start : undefined)
    if (at === undefined) {
      refused.push(`${unitName(unit)}: no declaration to hold the twin's variables`)
      edits.pop()
      continue
    }
    const block = (kw: string, decls: readonly string[]) => (decls.length === 0 ? "" : `${kw}\n\t${decls.join("\n\t")}\nEND_VAR\n`)
    edits.push({ start: at, end: at, text: block("VAR", [...twin.wires, ...twin.declarations]) })
  }
  let out = source
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return { source: out, refused, twinned: edits.filter((e) => e.text.startsWith("%LANGUAGE ST")).length }
}

function unitName(unit: TopLevel): string {
  return "name" in unit && unit.name !== undefined ? String((unit.name as { text?: string; name?: string }).text ?? (unit.name as { name?: string }).name) : unit.kind
}

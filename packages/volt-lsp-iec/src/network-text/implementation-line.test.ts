/**
 * The network-text half of the implementation boundary (openspec `implementation-keyword`): a body whose line states
 * `LD` or `FBD` is read by the network-text parser, whatever its text looks like. The boundary itself — the line, the
 * split, `%FOLDER` — is the syntax layer's (`frontend/syntax/format/*.test.ts`); these are the cases that need the reader
 * it selects (moved here by openspec frontend-conformance 1.5: a front-end test imports no consumer).
 */
import { expect, test } from "bun:test"
import {
  type BodySpan,
  graphicalMarkerLanguage,
  isGraphicalBody,
  parseSource,
  parseStatements,
  unitBodies,
} from "../frontend/syntax/index.js"
import { STRUCTURE_ONLY, parseNetworkText } from "./parser.js"

const NETWORK = "NETWORK\nout := a;\nEND_NETWORK"

/** A function block whose body is `impl` — its boundary line and what follows it. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

const bodiesOf = (src: string): BodySpan[] => parseSource(src, { networkText: true }).units.flatMap(unitBodies)

/** Every syntax error of a file: its declarations' and each ST body's, as the `parse-errors` check drains them. */
function syntaxErrors(src: string): string[] {
  const parsed = parseSource(src, { networkText: true })
  const bodies = parsed.units.flatMap(unitBodies).filter((b) => !isGraphicalBody(b))
  return [...parsed.errors, ...bodies.flatMap((b) => parseStatements(b).errors)].map((e) => e.message)
}

test("IMPLEMENTATION LD and IMPLEMENTATION FBD select the network-text reader", () => {
  for (const language of ["LD", "FBD"] as const) {
    const src = fb(`IMPLEMENTATION ${language}\n${NETWORK}`)
    expect(syntaxErrors(src)).toEqual([]) // the ST parser routes around a graphical body
    const bodies = bodiesOf(src)
    expect(bodies.map(graphicalMarkerLanguage)).toEqual([language])
    const parsed = parseNetworkText(bodies[0]!, STRUCTURE_ONLY)
    expect(parsed.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([])
    expect(parsed.language).toBe(language)
    expect(parsed.networks).toHaveLength(1)
  }
})

test("…and ST under LD is read as network text, which refuses it", () => {
  const bodies = bodiesOf(fb("IMPLEMENTATION LD\nout := a;"))
  expect(bodies.map(graphicalMarkerLanguage)).toEqual(["LD"])
  expect(parseNetworkText(bodies[0]!, STRUCTURE_ONLY).diagnostics.length).toBeGreaterThan(0)
})

test("a member's %FOLDER taken out with its IMPLEMENTATION LD line leaves a network body the reader reads clean", () => {
  const src = `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION LD\n%FOLDER Sub/Deep\n${NETWORK}\nEND_METHOD\n`
  const method = bodiesOf(src)[1]!
  expect(parseNetworkText(method, STRUCTURE_ONLY).diagnostics.map((d) => d.message)).toEqual([])
})

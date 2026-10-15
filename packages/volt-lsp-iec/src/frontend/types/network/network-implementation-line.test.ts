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
  bodyStatements,
  unitBodies,
  STRUCTURE_ONLY,
} from "../../syntax/index.js"
import { parseNetworkText } from "./network-parse.js"

const NETWORK = "NETWORK\nout := a;\nEND_NETWORK"

/** A function block whose body is `impl` — its boundary line and what follows it. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

const bodiesOf = (src: string): BodySpan[] => parseSource(src, { networkText: true }, "codesys").units.flatMap(unitBodies)

/** Every syntax error of a file: its declarations' and each ST body's, as the `parse-errors` check drains them. */
function syntaxErrors(src: string): string[] {
  const parsed = parseSource(src, { networkText: true }, "codesys")
  const bodies = parsed.units.flatMap(unitBodies).filter((b) => !isGraphicalBody(b))
  return [...parsed.errors, ...bodies.flatMap((b) => bodyStatements(b).errors)].map((e) => e.message)
}

test("IMPLEMENTATION LD and IMPLEMENTATION FBD select the network-text reader", () => {
  for (const language of ["LD", "FBD"] as const) {
    const src = fb(`IMPLEMENTATION ${language}\n${NETWORK}`)
    expect(syntaxErrors(src)).toEqual([]) // the ST parser routes around a graphical body
    const bodies = bodiesOf(src)
    expect(bodies.map(graphicalMarkerLanguage)).toEqual([language])
    const parsed = parseNetworkText(bodies[0]!, STRUCTURE_ONLY, "codesys")
    expect(parsed.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([])
    expect(parsed.language).toBe(language)
    expect(parsed.networks).toHaveLength(1)
  }
})

test("…and ST under LD is read as network text, which refuses it", () => {
  const bodies = bodiesOf(fb("IMPLEMENTATION LD\nout := a;"))
  expect(bodies.map(graphicalMarkerLanguage)).toEqual(["LD"])
  expect(parseNetworkText(bodies[0]!, STRUCTURE_ONLY, "codesys").diagnostics.length).toBeGreaterThan(0)
})

test("a member's %FOLDER taken out with its IMPLEMENTATION LD line leaves a network body the reader reads clean", () => {
  const src = `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION LD\n%FOLDER Sub/Deep\n${NETWORK}\nEND_METHOD\n`
  const method = bodiesOf(src)[1]!
  expect(parseNetworkText(method, STRUCTURE_ONLY, "codesys").diagnostics.map((d) => d.message)).toEqual([])
})

const LD = `FUNCTION_BLOCK FB_LD
VAR
	a : BOOL; b : BOOL; out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`

test("network text: an FBD/LD body is detected as graphical, not ST", () => {
  const { units, errors } = parseSource(LD, { networkText: true }, "codesys")
  expect(errors).toEqual([]) // ST parser routes around the network-text body — no false parse errors
  expect(unitBodies(units[0]!).some(isGraphicalBody)).toBe(true)
})

test("network text: a graphical body is detected by its IMPLEMENTATION line, even with no network", () => {
  // A body states its language once, on its IMPLEMENTATION line (openspec implementation-keyword). A body with no
  // network is still graphical; IMPLEMENTATION ST is an ST body's.
  const empty = parseSource(`FUNCTION_BLOCK FB_LD
VAR
\ta : BOOL;
END_VAR
IMPLEMENTATION LD
END_FUNCTION_BLOCK`, { networkText: true }, "codesys")
  expect(unitBodies(empty.units[0]!).map(graphicalMarkerLanguage)).toEqual(["LD"])
  expect(unitBodies(empty.units[0]!).some(isGraphicalBody)).toBe(true)

  const st = parseSource(`FUNCTION_BLOCK FB_ST
VAR
\ta : BOOL;
END_VAR
IMPLEMENTATION ST
a := TRUE;
END_FUNCTION_BLOCK`, { networkText: true }, "codesys")
  expect(unitBodies(st.units[0]!).map(graphicalMarkerLanguage)).toEqual([undefined])
  expect(unitBodies(st.units[0]!).some(isGraphicalBody)).toBe(false)
})

test("network text: a body is graphical by its stated LINE alone, as the bridge classifies it", () => {
  // The bridge matches the body's whole IMPLEMENTATION line (`ImplementationMarker.LanguageOf`), and nothing else
  // decides the reader: a line sharing its line with code states no language, and text that LOOKS like a network —
  // v1's `NETWORK 0 LD` header included — under IMPLEMENTATION ST is ST (which the ST parser refuses), never re-read.
  const body = (impl: string) => `PROGRAM P
VAR x : INT; a : INT; END_VAR
${impl}
END_PROGRAM`
  const graphical = (impl: string) => unitBodies(parseSource(body(impl), { networkText: true }, "codesys").units[0]!).some(isGraphicalBody)

  expect(graphical("IMPLEMENTATION FBD x := 1;")).toBe(false)
  expect(graphical("IMPLEMENTATION ST\n// note\nNETWORK 0 LD\nx := a;")).toBe(false)
  expect(graphical("IMPLEMENTATION ST\n\nNETWORK 0 LD\nx := a;")).toBe(false)
  expect(graphical("IMPLEMENTATION ST\nNETWORK\nx := a;\nEND_NETWORK")).toBe(false)
  expect(graphical("// IMPLEMENTATION FBD\nNETWORK\nx := a;\nEND_NETWORK")).toBe(false)

  // …and what the line states as graphical is, whatever follows it.
  expect(graphical("IMPLEMENTATION FBD  \nNETWORK\nx := a;\nEND_NETWORK")).toBe(true)
  expect(graphical("implementation ld\n\nNETWORK 0 LD\nx := a;")).toBe(true)
})

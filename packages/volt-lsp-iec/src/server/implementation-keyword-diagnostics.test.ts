/**
 * The implementation keyword's diagnostics, over the server's real responses (openspec `implementation-keyword`):
 * a body under `IMPLEMENTATION ST` is analysed as ST, one under `LD`/`FBD` as network text; a missing or unknown
 * language is a diagnostic naming what is missing, on the keyword's line — never a guess; and a body that contradicts
 * its stated language is a diagnostic, never re-read as the other language. The push refuses the same files by name
 * (`ImplementationLanguagePushTests` in volt-cli).
 */
import { expect, test } from "bun:test"
import type { Diagnostic } from "vscode-languageserver-protocol"
import { CAPS, harness } from "./harness.js"

const NETWORK = "NETWORK\nout := a;\nEND_NETWORK"

/** A function block whose body is `impl`; its keyword line is line 6. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\n\ti : INT;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`
const KEYWORD_LINE = 6

async function diagnostics(src: string): Promise<Diagnostic[]> {
  const h = harness()
  await h.init(CAPS.pull)
  await h.open("file:///F.fb", src)
  const diags = await h.pull("file:///F.fb")
  h.dispose()
  return diags
}

/** A diagnostic's message as text (the protocol allows markup). */
const text = (d: Diagnostic): string => (typeof d.message === "string" ? d.message : d.message.value)

const shown = (ds: Diagnostic[]): string[] => ds.map((d) => `${d.range.start.line}: ${String(d.code)} ${text(d)}`)

test("a clean body under IMPLEMENTATION ST draws no diagnostic", async () => {
  expect(shown(await diagnostics(fb("IMPLEMENTATION ST\nout := a;")))).toEqual([])
})

test("…and it is analysed as ST: its type error is found", async () => {
  const ds = await diagnostics(fb("IMPLEMENTATION ST\ni := a;"))
  expect(ds.map((d) => d.code)).toContain("C0032")
})

test("a clean body under IMPLEMENTATION LD or FBD draws no diagnostic", async () => {
  for (const language of ["LD", "FBD"]) {
    expect(shown(await diagnostics(fb(`IMPLEMENTATION ${language}\n${NETWORK}`)))).toEqual([])
  }
})

test("members and accessors under the keyword draw no diagnostic", async () => {
  const src =
    fb("IMPLEMENTATION ST\n") +
    "\nMETHOD Reset : BOOL\nIMPLEMENTATION ST\nReset := TRUE;\nEND_METHOD\n" +
    "\nACTION Step\nIMPLEMENTATION ST\ni := i + 1;\nEND_ACTION\n" +
    "\nPROPERTY Count : INT\nGET\nIMPLEMENTATION ST\nCount := i;\nEND_GET\nSET\nIMPLEMENTATION ST\ni := Count;\nEND_SET\nEND_PROPERTY\n"
  expect(shown(await diagnostics(src))).toEqual([])
})

/** No reader is guessed for a body whose language is missing or unknown: `i := a;` (an INT given a BOOL) would draw
 *  C0032 if the body were read as ST, and a NETWORK_ finding if it were read as network text. */
const readByNeither = (ds: Diagnostic[]): boolean =>
  !ds.some((d) => d.code === "C0032" || String(d.code).startsWith("NETWORK_"))

test("IMPLEMENTATION without a language is a diagnostic on its line naming the missing language", async () => {
  const ds = await diagnostics(fb("IMPLEMENTATION\ni := a;"))
  const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
  expect(on.length).toBeGreaterThan(0)
  expect(on.some((d) => /language/i.test(text(d)))).toBe(true)
  expect(readByNeither(ds)).toBe(true)
})

test("an unknown language is a keyword diagnostic on its line naming it, and the body is read by neither reader", async () => {
  for (const language of ["CFC", "SFC", "IL"]) {
    const ds = await diagnostics(fb(`IMPLEMENTATION ${language}\ni := a;`))
    const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
    // The keyword's OWN finding — it names the language and says it is one — not any parse error that echoes a token.
    expect({ language, shown: on.some((d) => text(d).includes(language) && /language/i.test(text(d))) }).toEqual({
      language,
      shown: true,
    })
    expect({ language, readByNeither: readByNeither(ds) }).toEqual({ language, readByNeither: true })
  }
})

test("IMPLEMENTATION is reserved: a variable named after it is a diagnostic on its declaration", async () => {
  for (const name of ["implementation", "IMPLEMENTATION", "Implementation"]) {
    const src = `FUNCTION_BLOCK F\nVAR\n\t${name} : INT;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n`
    const ds = await diagnostics(src)
    const on = ds.filter((d) => d.range.start.line === 2)
    expect({ name, flagged: on.some((d) => text(d).toLowerCase().includes("implementation")) }).toEqual({
      name,
      flagged: true,
    })
  }
})

/** Reserved EVERYWHERE a file names something, not only in the POU's VAR block — the push refuses the same positions
 *  (`IMPLEMENTATION_is_refused_as_reserved_in_every_naming_position`). Each case names the line its name stands on. */
test("IMPLEMENTATION is reserved in every naming position: a diagnostic on the declaring line", async () => {
  const head = "FUNCTION_BLOCK F\nVAR\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" // lines 0-6
  const cases: { what: string; uri: string; src: string; line: number }[] = [
    {
      what: "a method-local variable",
      uri: "file:///F.fb",
      src: head + "METHOD Run\nVAR\n\tImplementation : INT;\nEND_VAR\nIMPLEMENTATION ST\nImplementation := 1;\nEND_METHOD\n",
      line: 9,
    },
    {
      what: "a method's name",
      uri: "file:///F.fb",
      src: head + "METHOD Implementation : BOOL\nIMPLEMENTATION ST\nImplementation := TRUE;\nEND_METHOD\n",
      line: 7,
    },
    {
      what: "a property's name",
      uri: "file:///F.fb",
      src: head + "PROPERTY Implementation : BOOL\nGET\nIMPLEMENTATION ST\nImplementation := TRUE;\nEND_GET\nEND_PROPERTY\n",
      line: 7,
    },
    {
      what: "the POU's own name",
      uri: "file:///Implementation.fb",
      src: "FUNCTION_BLOCK Implementation\nVAR\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n",
      line: 0,
    },
    { what: "an enum value", uri: "file:///E.enum", src: "TYPE E :\n(\n\tIMPLEMENTATION,\n\tB\n);\nEND_TYPE\n", line: 2 },
  ]
  for (const c of cases) {
    const h = harness()
    await h.init(CAPS.pull)
    await h.open(c.uri, c.src)
    const ds = await h.pull(c.uri)
    h.dispose()
    const on = ds.filter((d) => d.range.start.line === c.line && /reserved/i.test(text(d)))
    expect({ what: c.what, flagged: on.length > 0 }).toEqual({ what: c.what, flagged: true })
  }
})

/** A second keyword line outside any comment is not the boundary and not ST: the push refuses it by name
 *  (`A_second_keyword_line_in_a_body_is_refused_naming_the_member`), so the editor shows it on its line. */
test("a second keyword line in a body is a diagnostic on that line", async () => {
  const ds = await diagnostics(fb("IMPLEMENTATION ST\nout := a;\nIMPLEMENTATION ST\nout := NOT a;"))
  expect(ds.some((d) => d.range.start.line === KEYWORD_LINE + 2)).toBe(true)
})

/** A body Volt cannot write (CFC, SFC, IL, an unrepresentable network) is pulled with its `(* @volt-graphical: … *)`
 *  marker line standing where the keyword would: it states the body has no text form, where `IMPLEMENTATION ST`
 *  would have labelled a chart Structured Text. Such a file is what a pull writes, so it draws no diagnostic. */
test("a body stated by its marker line draws no diagnostic, and the members around it are still read", async () => {
  const src =
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\ti : INT;\nEND_VAR\n(* @volt-graphical: CFC *)\n\nEND_FUNCTION_BLOCK\n" +
    "\nMETHOD Chart\n(* @volt-graphical: SFC *)\nEND_METHOD\n" +
    "\nMETHOD Run\nIMPLEMENTATION ST\ni := a;\nEND_METHOD\n"
  // Exactly the ST member's type error, on its line (15): the markers draw nothing, and Run is analysed as the ST
  // its keyword states.
  expect((await diagnostics(src)).map((d) => `${d.range.start.line}: ${String(d.code)}`)).toEqual(["15: C0032"])
})

test("network text under IMPLEMENTATION ST is a diagnostic — read as ST, never as a network", async () => {
  const ds = await diagnostics(fb(`IMPLEMENTATION ST\n${NETWORK}`))
  expect(ds.length).toBeGreaterThan(0)
  expect(ds.some((d) => String(d.code).startsWith("NETWORK_"))).toBe(false)
})

test("ST under IMPLEMENTATION LD is a network-text diagnostic — read as a network, never as ST", async () => {
  const ds = await diagnostics(fb("IMPLEMENTATION LD\nout := a;"))
  expect(ds.some((d) => String(d.code).startsWith("NETWORK_"))).toBe(true)
})

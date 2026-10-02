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
  for (const language of ["XYZ", "ST UNSUPPORTED"]) {
    const ds = await diagnostics(fb(`IMPLEMENTATION ${language}\ni := a;`))
    const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
    expect({ language, shown: on.some((d) => text(d).includes(language) && /language/i.test(text(d))) }).toEqual({
      language,
      shown: true,
    })
    expect({ language, readByNeither: readByNeither(ds) }).toEqual({ language, readByNeither: true })
  }
})

/** Section 3b: a bare `IMPLEMENTATION CFC|SFC|IL` is no line a body can state — a body Volt does not show says so with
 *  UNSUPPORTED, on every language. It is a diagnostic on its line naming the line to write, and nothing under it is
 *  read. */
test("a bare CFC, SFC or IL line is a keyword diagnostic naming the UNSUPPORTED line, and read by neither reader", async () => {
  for (const language of ["CFC", "SFC", "IL"]) {
    const ds = await diagnostics(fb(`IMPLEMENTATION ${language}\ni := a;`))
    const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
    expect({ language, shown: on.some((d) => text(d).includes(`IMPLEMENTATION ${language} UNSUPPORTED`)) }).toEqual({
      language,
      shown: true,
    })
    expect({ language, readByNeither: readByNeither(ds) }).toEqual({ language, readByNeither: true })
  }
})

/** Section 3b: UNSUPPORTED hides the IMPLEMENTATION, not the item — the declaration above the line is editable and is
 *  pushed, so it is analysed like any other: a syntax error in it is reported where it stands. */
test("the declaration of a hidden body is still analysed", async () => {
  for (const line of ["CFC UNSUPPORTED", "LD UNSUPPORTED"]) {
    const src = `FUNCTION_BLOCK F\nVAR_INPUT\n\tbStart BOOL;\nEND_VAR\nIMPLEMENTATION ${line}\nEND_FUNCTION_BLOCK\n`
    const ds = await diagnostics(src)
    expect({ line, onDeclaration: ds.some((d) => d.range.start.line === 2) }).toEqual({ line, onDeclaration: true })
  }
})

/** `IMPLEMENTATION <LANG> UNSUPPORTED` states a body Volt does not show — always for CFC, SFC and IL, and for an LD/FBD
 *  body network text cannot represent yet (owner decisions 2026-09-28, sections 2b and 3b) — which is empty. Code under
 *  one has nowhere to go — the push refuses it naming the item (`ReadOnlyBodyTests`) — so it is a diagnostic on the
 *  line naming what the line states, and neither reader reads the code. */
test("code under an UNSUPPORTED line is a keyword diagnostic on its line naming it, and read by neither reader", async () => {
  for (const language of ["CFC UNSUPPORTED", "SFC UNSUPPORTED", "IL UNSUPPORTED", "LD UNSUPPORTED", "FBD UNSUPPORTED"]) {
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

/** A comment or pragma under an UNSUPPORTED line is text under it too: the push refuses it (`StReader.Body` tests the
 *  raw text, and the drivers never write a hidden body, so the comment would be silently dropped). An editor that
 *  called it clean would show a file `volt push` then blocks — so the LSP reports it exactly like code. */
test("a comment or pragma under an UNSUPPORTED line is the same keyword diagnostic as code under it", async () => {
  for (const [line, under] of [
    ["CFC UNSUPPORTED", "(* note *)"],
    ["CFC UNSUPPORTED", "// note"],
    ["SFC UNSUPPORTED", "{attribute 'x'}"],
    ["LD UNSUPPORTED", "(* note *)"],
  ] as const) {
    const ds = await diagnostics(fb(`IMPLEMENTATION ${line}\n${under}`))
    const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
    expect({ line, under, shown: on.some((d) => text(d).includes(line) && /holds code/i.test(text(d))) }).toEqual({
      line,
      under,
      shown: true,
    })
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

/** …in every file that HAS a boundary. A DUT or a GVL has none, and the push writes its text as sent
 *  (`IMPLEMENTATION_in_a_gvl_or_a_dut_is_written_as_sent`, push-without-header-check 2.1): CODESYS builds a struct member
 *  named IMPLEMENTATION clean (conformance `pwh_struct_member_implementation`). An enum value sat in the list above
 *  while the push refused it; the push no longer does, so the premise changed with it. */
test("IMPLEMENTATION in a DUT or a GVL is a name like any other: no diagnostic", async () => {
  const cases: { uri: string; src: string }[] = [
    { uri: "file:///E.dut", src: "TYPE E :\n(\n\tIMPLEMENTATION,\n\tB\n);\nEND_TYPE\n" },
    { uri: "file:///S.dut", src: "TYPE S :\nSTRUCT\n\timplementation : INT;\nEND_STRUCT\nEND_TYPE\n" },
    { uri: "file:///G.gvl", src: "VAR_GLOBAL\n\ta,\n\tIMPLEMENTATION\n\t: INT;\nEND_VAR\n" },
  ]
  for (const c of cases) {
    const h = harness()
    await h.init(CAPS.pull)
    await h.open(c.uri, c.src)
    const ds = await h.pull(c.uri)
    h.dispose()
    expect({ uri: c.uri, reserved: ds.filter((d) => /reserved/i.test(text(d))).map(text) }).toEqual({ uri: c.uri, reserved: [] })
  }
})

/** A second keyword line outside any comment is not the boundary and not ST: the push refuses it by name
 *  (`A_second_keyword_line_in_a_body_is_refused_naming_the_member`), so the editor shows it on its line. */
test("a second keyword line in a body is a diagnostic on that line", async () => {
  const ds = await diagnostics(fb("IMPLEMENTATION ST\nout := a;\nIMPLEMENTATION ST\nout := NOT a;"))
  expect(ds.some((d) => d.range.start.line === KEYWORD_LINE + 2)).toBe(true)
})

/** A body Volt does not show (CFC, SFC, IL, an unrepresentable network) is pulled with its UNSUPPORTED line —
 *  `IMPLEMENTATION <LANG> UNSUPPORTED` — over an empty body, `%FOLDER` under it for a member in a folder (sections 2b,
 *  3b): it states no code is shown, where `IMPLEMENTATION ST` would have labelled a chart Structured Text. Such a file is
 *  what a pull writes, so it draws no diagnostic. */
test("a body stated by its UNSUPPORTED line draws no diagnostic, and the members around it are still read", async () => {
  for (const line of ["CFC UNSUPPORTED", "SFC UNSUPPORTED", "IL UNSUPPORTED", "LD UNSUPPORTED", "FBD UNSUPPORTED"])
    expect({ line, shown: shown(await diagnostics(fb(`IMPLEMENTATION ${line}\n`))) }).toEqual({ line, shown: [] })

  // The members are CALLED from the body: CODESYS compiles only what is used, so the LSP says nothing about a member
  // nothing calls — and a member nothing calls would draw no diagnostic whatever its line said.
  const src =
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\ti : INT;\nEND_VAR\nIMPLEMENTATION ST\ni := a;\nChart();\nLadder();\nStep();\nEND_FUNCTION_BLOCK\n" +
    "\nMETHOD Chart\nIMPLEMENTATION SFC UNSUPPORTED\nEND_METHOD\n" +
    "\nMETHOD Ladder\nIMPLEMENTATION LD UNSUPPORTED\n%FOLDER Sub/Deep\nEND_METHOD\n" +
    "\nACTION Step\nIMPLEMENTATION CFC UNSUPPORTED\nEND_ACTION\n"
  // Exactly the ST body's type error, on its line (6): the hidden members draw nothing, and the body is analysed
  // as the ST its keyword states.
  expect((await diagnostics(src)).map((d) => `${d.range.start.line}: ${String(d.code)}`)).toEqual(["6: C0032"])
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

// A body with NO keyword line states no language, which the spec makes an LSP diagnostic as the push makes it a refusal
// (`StReader.Unmarked`, "Run `volt pull` once"): never read as ST by default, so an engineer who deletes the line sees
// it in the editor, not only when the push refuses the file.
test("a body with no IMPLEMENTATION line is a diagnostic naming the item and `volt pull`, and read by neither reader", async () => {
  const ds = await diagnostics(
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\n\ti : INT;\nEND_VAR\ni := a;\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD M : BOOL\nM := TRUE;\nEND_METHOD\n",
  )
  const missing = ds.filter((d) => /states no language/.test(text(d)))
  expect(missing.map((d) => d.range.start.line)).toEqual([6, 10])
  expect(missing.every((d) => /volt pull/.test(text(d)))).toBe(true)
  expect(text(missing[0]!)).toContain("F")
  expect(text(missing[1]!)).toContain("M")
  expect(readByNeither(ds)).toBe(true)
})

test("a property accessor with no IMPLEMENTATION line is the same diagnostic", async () => {
  const ds = await diagnostics(
    fb("IMPLEMENTATION ST\n") + "\nPROPERTY Count : INT\nGET\nCount := i;\nEND_GET\nEND_PROPERTY\n",
  )
  expect(ds.filter((d) => /states no language/.test(text(d))).length).toBe(1)
})

test("a line-less ladder is not read as ST either", async () => {
  const ds = await diagnostics(fb("NETWORK\n  out := a;\nEND_NETWORK"))
  expect(ds.filter((d) => /states no language/.test(text(d))).map((d) => d.range.start.line)).toEqual([KEYWORD_LINE])
})

/**
 * The `%LANGUAGE` line's diagnostics, over the server's real responses (openspec `language-line`): a body under
 * `%LANGUAGE ST` is analysed as ST, one under `LD`/`FBD` as network text; a missing or unknown language is a diagnostic
 * naming what is missing, on the line — never a guess; a body that contradicts its stated language is a diagnostic,
 * never re-read as the other language; and a member with no body slot (no line, nothing after its declaration) draws
 * nothing. The push refuses the same files by name (`LanguageLinePushTests` in volt-cli).
 */
import { expect, test } from "bun:test"
import type { Diagnostic } from "vscode-languageserver-protocol"
import { CAPS, harness } from "./harness.js"

const NETWORK = "NETWORK\nout := a;\nEND_NETWORK"

/** A function block whose body is `impl`; its %LANGUAGE line is line 6. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\n\ti : INT;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`
const KEYWORD_LINE = 6

async function diagnostics(src: string): Promise<Diagnostic[]> {
  const h = harness()
  await h.init(CAPS.pull)
  await h.open("file:///F.pou", src)
  const diags = await h.pull("file:///F.pou")
  h.dispose()
  return diags
}

/** A diagnostic's message as text (the protocol allows markup). */
const text = (d: Diagnostic): string => (typeof d.message === "string" ? d.message : d.message.value)

const shown = (ds: Diagnostic[]): string[] => ds.map((d) => `${d.range.start.line}: ${String(d.code)} ${text(d)}`)

test("a clean body under %LANGUAGE ST draws no diagnostic", async () => {
  expect(shown(await diagnostics(fb("%LANGUAGE ST\nout := a;")))).toEqual([])
})

test("…and it is analysed as ST: its type error is found", async () => {
  const ds = await diagnostics(fb("%LANGUAGE ST\ni := a;"))
  expect(ds.map((d) => d.code)).toContain("C0032")
})

test("a clean body under %LANGUAGE LD or FBD draws no diagnostic", async () => {
  for (const language of ["LD", "FBD"]) {
    expect(shown(await diagnostics(fb(`%LANGUAGE ${language}\n${NETWORK}`)))).toEqual([])
  }
})

test("members and accessors under the keyword draw no diagnostic", async () => {
  const src =
    fb("%LANGUAGE ST\n") +
    "\nMETHOD Reset : BOOL\n%LANGUAGE ST\nReset := TRUE;\nEND_METHOD\n" +
    "\nACTION Step\n%LANGUAGE ST\ni := i + 1;\nEND_ACTION\n" +
    "\nPROPERTY Count : INT\nGET\n%LANGUAGE ST\nCount := i;\nEND_GET\nSET\n%LANGUAGE ST\ni := Count;\nEND_SET\nEND_PROPERTY\n"
  expect(shown(await diagnostics(src))).toEqual([])
})

/** No reader is guessed for a body whose language is missing or unknown: `i := a;` (an INT given a BOOL) would draw
 *  C0032 if the body were read as ST, and a NETWORK_ finding if it were read as network text. */
const readByNeither = (ds: Diagnostic[]): boolean =>
  !ds.some((d) => d.code === "C0032" || String(d.code).startsWith("NETWORK_"))

test("%LANGUAGE without a language is a diagnostic on its line naming the missing language", async () => {
  const ds = await diagnostics(fb("%LANGUAGE\ni := a;"))
  const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
  expect(on.length).toBeGreaterThan(0)
  expect(on.some((d) => /language/i.test(text(d)))).toBe(true)
  expect(readByNeither(ds)).toBe(true)
})

test("an unknown language is a keyword diagnostic on its line naming it, and the body is read by neither reader", async () => {
  for (const language of ["XYZ", "ST UNSUPPORTED"]) {
    const ds = await diagnostics(fb(`%LANGUAGE ${language}\ni := a;`))
    const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
    expect({ language, shown: on.some((d) => text(d).includes(language) && /language/i.test(text(d))) }).toEqual({
      language,
      shown: true,
    })
    expect({ language, readByNeither: readByNeither(ds) }).toEqual({ language, readByNeither: true })
  }
})

/** A bare `%LANGUAGE CFC|SFC|IL` is no line a body can state — a body Volt does not show says so with UNSUPPORTED, on
 *  every language. It is a diagnostic on its line naming the line to write, and nothing under it is read. */
test("a bare CFC, SFC or IL line is a keyword diagnostic naming the UNSUPPORTED line, and read by neither reader", async () => {
  for (const language of ["CFC", "SFC", "IL"]) {
    const ds = await diagnostics(fb(`%LANGUAGE ${language}\ni := a;`))
    const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
    expect({ language, shown: on.some((d) => text(d).includes(`%LANGUAGE ${language} UNSUPPORTED`)) }).toEqual({
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
    const src = `FUNCTION_BLOCK F\nVAR_INPUT\n\tbStart BOOL;\nEND_VAR\n%LANGUAGE ${line}\nEND_FUNCTION_BLOCK\n`
    const ds = await diagnostics(src)
    expect({ line, onDeclaration: ds.some((d) => d.range.start.line === 2) }).toEqual({ line, onDeclaration: true })
  }
})

/** `%LANGUAGE <LANG> UNSUPPORTED` states a body Volt does not show — always for CFC, SFC and IL, and for an LD/FBD
 *  body network text cannot represent yet (owner decisions 2026-09-28, sections 2b and 3b) — which is empty. Code under
 *  one has nowhere to go — the push refuses it naming the item (`ReadOnlyBodyTests`) — so it is a diagnostic on the
 *  line naming what the line states, and neither reader reads the code. */
test("code under an UNSUPPORTED line is a keyword diagnostic on its line naming it, and read by neither reader", async () => {
  for (const language of ["CFC UNSUPPORTED", "SFC UNSUPPORTED", "IL UNSUPPORTED", "LD UNSUPPORTED", "FBD UNSUPPORTED"]) {
    const ds = await diagnostics(fb(`%LANGUAGE ${language}\ni := a;`))
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
    const ds = await diagnostics(fb(`%LANGUAGE ${line}\n${under}`))
    const on = ds.filter((d) => d.range.start.line === KEYWORD_LINE)
    expect({ line, under, shown: on.some((d) => text(d).includes(line) && /holds code/i.test(text(d))) }).toEqual({
      line,
      under,
      shown: true,
    })
  }
})

/** `IMPLEMENTATION` is a NAME like any other, in every file and every naming position (openspec bridge-refusal-review
 *  1.2, review 4b): the push writes it as sent (`RefuseReservedNames` is deleted; `ImplementationLanguagePushTests`
 *  writes `a,\n\tIMPLEMENTATION\n\t: INT;` as sent), and the IDE compiles the identifier — the vendors hold no such
 *  keyword (`pwh_struct_member_implementation` builds clean). Only a line of the boundary's GRAMMAR is a boundary (D9).
 *  These cases were "IMPLEMENTATION is reserved" while the push refused the name; that premise went with 1.2, and an
 *  LSP-only error is a false positive under the parity rule. Whether an IDE takes an OBJECT named so is the driver's
 *  measured answer (`RefusedName`), not a rule of the text. */
test("IMPLEMENTATION is a name like any other, in every file and every naming position: no diagnostic", async () => {
  const head = "FUNCTION_BLOCK F\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n"
  const cases: { what: string; uri: string; src: string }[] = [
    ...["implementation", "IMPLEMENTATION", "Implementation"].map((name) => ({
      what: `a variable '${name}'`,
      uri: "file:///F.pou",
      src: `FUNCTION_BLOCK F\nVAR\n\t${name} : INT;\nEND_VAR\n%LANGUAGE ST\n${name} := 1;\nEND_FUNCTION_BLOCK\n`,
    })),
    {
      what: "a wrapped declaration's name on a line of its own",
      uri: "file:///F.pou",
      src: "FUNCTION_BLOCK F\nVAR\n\ta,\n\tIMPLEMENTATION\n\t: INT;\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION_BLOCK\n",
    },
    {
      what: "a method-local variable",
      uri: "file:///F.pou",
      src: head + "METHOD Run\nVAR\n\tImplementation : INT;\nEND_VAR\n%LANGUAGE ST\nImplementation := 1;\nEND_METHOD\n",
    },
    {
      what: "a method's name",
      uri: "file:///F.pou",
      src: head + "METHOD Implementation : BOOL\n%LANGUAGE ST\nImplementation := TRUE;\nEND_METHOD\n",
    },
    {
      what: "a property's name",
      uri: "file:///F.pou",
      src: head + "PROPERTY Implementation : BOOL\nGET\n%LANGUAGE ST\nImplementation := TRUE;\nEND_GET\nEND_PROPERTY\n",
    },
    {
      what: "the POU's own name",
      uri: "file:///Implementation.pou",
      src: "FUNCTION_BLOCK Implementation\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n",
    },
    { what: "an enum value", uri: "file:///E.dut", src: "TYPE E :\n(\n\tIMPLEMENTATION,\n\tB\n);\nEND_TYPE\n" },
    { what: "a struct member", uri: "file:///S.dut", src: "TYPE S :\nSTRUCT\n\timplementation : INT;\nEND_STRUCT\nEND_TYPE\n" },
    { what: "a global", uri: "file:///G.gvl", src: "VAR_GLOBAL\n\ta,\n\tIMPLEMENTATION\n\t: INT;\nEND_VAR\n" },
  ]
  for (const c of cases) {
    const h = harness()
    await h.init(CAPS.pull)
    await h.open(c.uri, c.src)
    const ds = await h.pull(c.uri)
    h.dispose()
    expect({ what: c.what, shown: ds.map(text) }).toEqual({ what: c.what, shown: [] })
  }
})

/** A second keyword line outside any comment is not the boundary and not ST: the push refuses it by name
 *  (`A_second_keyword_line_in_a_body_is_refused_naming_the_member`), so the editor shows it on its line. */
test("a second keyword line in a body is a diagnostic on that line", async () => {
  const ds = await diagnostics(fb("%LANGUAGE ST\nout := a;\n%LANGUAGE ST\nout := NOT a;"))
  expect(ds.some((d) => d.range.start.line === KEYWORD_LINE + 2)).toBe(true)
})

/** A body Volt does not show (CFC, SFC, IL, an unrepresentable network) is pulled with its UNSUPPORTED line —
 *  `%LANGUAGE <LANG> UNSUPPORTED` — over an empty body, `%FOLDER` under it for a member in a folder (sections 2b,
 *  3b): it states no code is shown, where `%LANGUAGE ST` would have labelled a chart Structured Text. Such a file is
 *  what a pull writes, so it draws no diagnostic. */
test("a body stated by its UNSUPPORTED line draws no diagnostic, and the members around it are still read", async () => {
  for (const line of ["CFC UNSUPPORTED", "SFC UNSUPPORTED", "IL UNSUPPORTED", "LD UNSUPPORTED", "FBD UNSUPPORTED"])
    expect({ line, shown: shown(await diagnostics(fb(`%LANGUAGE ${line}\n`))) }).toEqual({ line, shown: [] })

  // The members are CALLED from the body: CODESYS compiles only what is used, so the LSP says nothing about a member
  // nothing calls — and a member nothing calls would draw no diagnostic whatever its line said.
  const src =
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\ni := a;\nChart();\nLadder();\nStep();\nEND_FUNCTION_BLOCK\n" +
    "\nMETHOD Chart\n%LANGUAGE SFC UNSUPPORTED\nEND_METHOD\n" +
    "\nMETHOD Ladder\n%LANGUAGE LD UNSUPPORTED\n%FOLDER Sub/Deep\nEND_METHOD\n" +
    "\nACTION Step\n%LANGUAGE CFC UNSUPPORTED\nEND_ACTION\n"
  // Exactly the ST body's type error, on its line (6): the hidden members draw nothing, and the body is analysed
  // as the ST its keyword states.
  expect((await diagnostics(src)).map((d) => `${d.range.start.line}: ${String(d.code)}`)).toEqual(["6: C0032"])
})

test("network text under %LANGUAGE ST is a diagnostic — read as ST, never as a network", async () => {
  const ds = await diagnostics(fb(`%LANGUAGE ST\n${NETWORK}`))
  expect(ds.length).toBeGreaterThan(0)
  expect(ds.some((d) => String(d.code).startsWith("NETWORK_"))).toBe(false)
})

test("ST under %LANGUAGE LD is a network-text diagnostic — read as a network, never as ST", async () => {
  const ds = await diagnostics(fb("%LANGUAGE LD\nout := a;"))
  expect(ds.some((d) => String(d.code).startsWith("NETWORK_"))).toBe(true)
})

// A body with NO line states no language, which the spec makes an LSP diagnostic as the push makes it a refusal
// (`StReader.Unmarked`, "Run `volt pull` once"; a member's code with no line, `StReader.DeclarationOnly`): never read as
// ST by default, so an engineer who deletes the line sees it in the editor, not only when the push refuses the file.
test("a body with no %LANGUAGE line is a diagnostic naming the item and `volt pull`, and read by neither reader", async () => {
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

test("a property accessor with code and no %LANGUAGE line is the same diagnostic", async () => {
  const ds = await diagnostics(
    fb("%LANGUAGE ST\n") + "\nPROPERTY Count : INT\nGET\nCount := i;\nEND_GET\nEND_PROPERTY\n",
  )
  expect(ds.filter((d) => /states no language/.test(text(d))).length).toBe(1)
})

test("a line-less ladder is not read as ST either", async () => {
  const ds = await diagnostics(fb("NETWORK\n  out := a;\nEND_NETWORK"))
  expect(ds.filter((d) => /states no language/.test(text(d))).map((d) => d.range.start.line)).toEqual([KEYWORD_LINE])
})

// A file written before the line was renamed: its retired `IMPLEMENTATION` line states nothing, so the body states no
// language, and the finding says to pull again — the push's refusal of the same file (`PropertyLines.RetiredLineRefusal`).
test("a body under the retired IMPLEMENTATION line states no language, and the finding says to pull again", async () => {
  const ds = (await diagnostics(fb("IMPLEMENTATION ST\nout := a;"))).filter((d) => /states no language/.test(text(d)))
  expect(ds.length).toBe(1)
  expect(text(ds[0]!)).toBe(
    "'F' states no language: it holds 'IMPLEMENTATION ST': `IMPLEMENTATION` is no longer read — pull again (it is now `%LANGUAGE <LANG>`).",
  )
})

/** The line is the boundary wherever it stands; text above it is the declaration's, where the push writes it as sent.
 *  Text there the declaration parser did not take is the build's to judge, and no recording says what the build says
 *  (niche: accepted loss, 0 occurrences in the corpora): it draws nothing, and the body under the line is still
 *  analysed. A %-line there is the push's refusal, and is reported as misplaced. */
test("text above the %LANGUAGE line draws nothing no recording backs, and the body is still analysed", async () => {
  const garbage = await diagnostics(fb("i := a;\nfoo bar baz qux\n%LANGUAGE ST\ni := a;"))
  expect(garbage.map((d) => `${d.range.start.line}: ${String(d.code)}`).sort()).toEqual(["9: C0032"])

  const method = await diagnostics(fb("%LANGUAGE ST") + "\nMETHOD M : BOOL\nM := undefinedThing;\n%LANGUAGE ST\nM := TRUE;\nEND_METHOD\n")
  expect(method.map((d) => `${d.range.start.line}: ${String(d.code)}`)).toEqual([])

  const semicolon = await diagnostics("FUNCTION_BLOCK F\nVAR\n\tout : BOOL;\nEND_VAR;\n%LANGUAGE ST\nout := TRUE;\nEND_FUNCTION_BLOCK\n")
  expect(semicolon).toEqual([])

  const property = await diagnostics("FUNCTION_BLOCK F\nVAR\n\tout : BOOL;\nEND_VAR\n%EXCLUDE_FROM_BUILD\n%LANGUAGE ST\nout := TRUE;\nEND_FUNCTION_BLOCK\n")
  expect(property.map((d) => `${d.range.start.line}: ${text(d).slice(0, 51)}`)).toEqual([
    "4: '%EXCLUDE_FROM_BUILD' is no property the push reads",
  ])
})

/** A member with no body slot (DIALECT C2n: CODESYS's IDE-made abstract method, an abstract property's GET) is written
 *  with no line and nothing after its declaration — pro2193's re-pulled — and draws nothing; the method's `%FOLDER`
 *  closes its declaration. Code after a member's declaration with no line is the finding, saying the line to state. */
test("a member with no body slot draws no diagnostic, and code after a member's declaration with no line is the finding", async () => {
  const src =
    "FUNCTION_BLOCK ABSTRACT F\nVAR\n\ta : BOOL;\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\ni := a;\nEND_FUNCTION_BLOCK\n" +
    "\nMETHOD ABSTRACT TakePicture : INT\n\n%FOLDER Commands\nEND_METHOD\n" +
    "\nPROPERTY PUBLIC ABSTRACT Busy : BOOL\nGET\nVAR\nEND_VAR\nEND_GET\nEND_PROPERTY\n"
  // Exactly the ST body's type error, on its line (6): the members with no slot draw nothing.
  expect((await diagnostics(src)).map((d) => `${d.range.start.line}: ${String(d.code)}`)).toEqual(["6: C0032"])

  const coded = (await diagnostics(fb("%LANGUAGE ST\n") + "\nMETHOD Run : BOOL\nRun := TRUE;\nEND_METHOD\n")).filter((d) =>
    /states no language/.test(text(d)),
  )
  expect(coded.length).toBe(1)
  expect(text(coded[0]!)).toContain("code stands after its declaration")
  expect(text(coded[0]!)).toContain("State '%LANGUAGE ST' above the code")

  // No line and nothing after the declaration, but not ABSTRACT: the push refuses it as a create and as an update, so
  // it is the finding — on a concrete method and on a concrete property's empty GET alike.
  const concrete = (
    await diagnostics(fb("%LANGUAGE ST\n") + "\nMETHOD Run : BOOL\nVAR\nEND_VAR\nEND_METHOD\n\nPROPERTY P : INT\nGET\nEND_GET\nEND_PROPERTY\n")
  ).filter((d) => /states no language/.test(text(d)))
  expect(concrete.map((d) => text(d).slice(0, text(d).indexOf(" states")))).toEqual(["'Run'", "'P's getter'"])
  for (const d of concrete) expect(text(d)).toContain("only a member with no body slot has none")
})

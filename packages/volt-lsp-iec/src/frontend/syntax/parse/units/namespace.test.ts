/**
 * NAMESPACE — the parse shape, and what a workspace file may say with it (rule U28). The binder's half (the namespace
 * scope tree, the project-level symbol, qualified `NS.Element` navigation) is `symbols/binder.test.ts`.
 *
 * A project holds no namespace OBJECT — the wire has no such kind, and a namespace is a LIBRARY's, named in its manifest —
 * so a NAMESPACE in a workspace file is text inside some other object (fixtures `unit_namespace_*`, 2026-10-01):
 *   - in a POU its END_NAMESPACE is refused by Volt's push on both vendors ("expected METHOD/ACTION/PROPERTY, got:
 *     END_NAMESPACE"), so the IDE never receives a namespace block, and the LSP reports the line as the push refuses it.
 *     A GVL's and a DUT's text is written as sent and opens with NAMESPACE, so the IDE reads it as declaring nothing
 *     (`source-object.ts`); text that is no workspace file is no push's — neither is refused. (In an interface the
 *     closer is a line after END_INTERFACE, which the push refuses and the LSP does not report: niche, accepted loss —
 *     see `namespace.ts`.);
 *   - the keyword line alone reaches the IDE, and CODESYS reads the object as declaring nothing and says NOTHING about
 *     its text (only "Unknown type" where the FB is used) — so an unterminated NAMESPACE is no error of its own.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../index.js"
import type { SourceObject } from "../../format/source-object.js"

const NS = `NAMESPACE NS
FUNCTION_BLOCK Foo
VAR x : INT; END_VAR
END_FUNCTION_BLOCK
TYPE E : (A, B); END_TYPE
END_NAMESPACE`

const refusals = (src: string, object?: SourceObject) =>
  parseSource(src, { networkText: true }, "codesys", object).errors.filter((e) => e.message.startsWith("'END_NAMESPACE'"))

test("a NAMESPACE parses holding its inner units", () => {
  const pr = parseSource(NS, { networkText: true })
  expect(pr.units).toHaveLength(1)
  const ns = pr.units[0]
  expect(ns.kind).toBe("namespace")
  if (ns.kind === "namespace") {
    expect(ns.name.text).toBe("NS")
    expect(ns.units.map((u) => u.kind)).toEqual(["function_block", "type_decl"])
  }
})

test("END_NAMESPACE in a POU is reported on its line, as the push refuses it", () => {
  const pr = parseSource(NS, { networkText: true }, "codesys", "pou")
  expect(pr.errors.map((e) => e.message)).toEqual([expect.stringContaining("the push refuses")])
  const at = pr.errors[0]!.span
  expect(NS.slice(at.start, at.end)).toBe("END_NAMESPACE")
  // every closer is a line the push refuses: a nested block, and a block holding an FB and its METHOD
  expect(
    refusals("NAMESPACE A\nNAMESPACE B\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\nEND_NAMESPACE\nEND_NAMESPACE\n", "pou"),
  ).toHaveLength(2)
  expect(
    refusals("NAMESPACE A\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nM := 7;\nEND_METHOD\nEND_NAMESPACE\n", "pou"),
  ).toHaveLength(1)
})

test("a GVL, a DUT and text that is no workspace file are not refused for END_NAMESPACE: no push reads it", () => {
  const gvl = "NAMESPACE N\nVAR_GLOBAL\n\tx : INT;\nEND_VAR\nEND_NAMESPACE\n"
  const dut = "NAMESPACE N\nTYPE E : (A, B);\nEND_TYPE\nEND_NAMESPACE\n"
  expect(parseSource(gvl, { networkText: true }, "codesys", "gvl").errors).toEqual([])
  expect(parseSource(dut, { networkText: true }, "codesys", "dut").errors).toEqual([])
  expect(refusals(NS)).toEqual([])
})

test("a stray inside a NAMESPACE does not offer END_NAMESPACE as its closer: that line is refused", () => {
  const messages = parseSource("NAMESPACE N\nFOO\n", { networkText: true }).errors.map((e) => e.message)
  expect(messages).toEqual([expect.stringContaining("inside NAMESPACE")])
  expect(messages[0]).not.toContain("END_NAMESPACE")
})

test("a NAMESPACE with no END_NAMESPACE is no error: the vendor reads the object as declaring nothing, silently", () => {
  const pr = parseSource("NAMESPACE NS\nFUNCTION_BLOCK F\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n", {
    networkText: true,
  })
  expect(pr.errors).toEqual([])
  expect(pr.units.map((u) => u.kind)).toEqual(["namespace"])
})

/**
 * THE METHOD HEADER (design.md §4 2.4, U11–U13), as both vendors read it (`fixtures/grammar/units.ts`, recorded
 * 2026-10-01): its modifiers in order as written, and an access modifier only in first place.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../parser.js"
import type { Method } from "../../ast/nodes.js"

const method = (header: string) => {
  const r = parseSource(`FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK\n\n${header}\nM := 7;\nEND_METHOD\n`, { networkText: true })
  return { errors: r.errors.map((e) => e.message), unit: r.units[1] as Method }
}

test("the modifiers are kept as an ordered list, as written", () => {
  expect(method("METHOD PUBLIC FINAL M : INT").unit.modifiers).toEqual(["PUBLIC", "FINAL"])
  expect(method("METHOD PROTECTED ABSTRACT M : INT").unit.modifiers).toEqual(["PROTECTED", "ABSTRACT"])
  // a repeated FINAL builds on both vendors (`unit_method_modifier_twice`)
  const twice = method("METHOD FINAL FINAL M : INT")
  expect([twice.errors, twice.unit.modifiers]).toEqual([[], ["FINAL", "FINAL"]])
})

test("an access modifier after another modifier is refused where a name stands", () => {
  // `unit_method_final_private_order`, `unit_method_two_access`: "Identifier expected instead of 'PRIVATE'", both vendors
  for (const header of ["METHOD FINAL PRIVATE M : INT", "METHOD PUBLIC PRIVATE M : INT"]) {
    const r = method(header)
    expect([header, r.errors[0]]).toEqual([header, "Identifier expected instead of 'PRIVATE'"])
  }
})

test("a modifier word alone before the name is the name (`METHOD PROTECTED Final`)", () => {
  const r = method("METHOD PROTECTED Final : INT")
  expect([r.errors, r.unit.name.text, r.unit.modifiers]).toEqual([[], "Final", ["PROTECTED"]])
})

test("OVERRIDE is no modifier: `METHOD OVERRIDE M` is a method NAMED Override", () => {
  // `unit_method_override` (record:exec, CODESYS 2026-10-01): "The name used in the signature is not identical to the
  // object name" — the vendor took OVERRIDE for the name, and `M : INT` for what follows it (the body parser's)
  const r = method("METHOD OVERRIDE M : INT")
  expect([r.unit.name.text, r.unit.modifiers]).toEqual(["OVERRIDE", []])
})

test("nothing after the colon but the body's line is the vendors' empty type, not the line read as a type", () => {
  // `sig_empty_type` (openspec bridge-refusal-review 2.4/D10, both vendors 2026-10-03): the IDE holds the declaration
  // without the IMPLEMENTATION line, so its text ends at the colon — "Type definition expected instead of ''". The line's
  // IMPLEMENTATION used to be read as the type's name.
  const r = parseSource(
    "FUNCTION_BLOCK X\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\nMETHOD Run :\nIMPLEMENTATION ST\n;\nEND_METHOD\n",
    { networkText: true },
  )
  expect(r.errors.map((e) => e.message)).toEqual(["Type definition expected instead of ''"])
  const m = r.units[1] as Method
  expect([m.name.text, m.body.implementation?.text]).toEqual(["Run", "IMPLEMENTATION ST"])
})

test("nothing after the colon on an interface member or a property is the same empty type, whatever line follows", () => {
  // Review 4b: the push writes every member header with nothing after its colon as sent, and in each case the IDE's
  // declaration ends at the colon — the line after it (END_METHOD, END_PROPERTY, GET, SET, IMPLEMENTATION) is one the
  // push never writes into a declaration, so the vendors' answer is `sig_empty_type`'s. Those lines used to be read
  // as the type, and a POU property's GET then cascaded.
  const cases = [
    "INTERFACE I\nMETHOD Run :\nEND_METHOD\nEND_INTERFACE\n",
    "INTERFACE I\nPROPERTY P :\nEND_PROPERTY\nEND_INTERFACE\n",
    "INTERFACE I\nPROPERTY P :\nGET\nEND_GET\nEND_PROPERTY\nEND_INTERFACE\n",
    "FUNCTION_BLOCK X\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\nPROPERTY P :\nGET\nIMPLEMENTATION ST\n;\nEND_GET\nEND_PROPERTY\n",
    "FUNCTION_BLOCK X\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\nPROPERTY P :\nSET\nIMPLEMENTATION ST\n;\nEND_SET\nEND_PROPERTY\n",
  ]
  for (const source of cases) {
    const r = parseSource(source, { networkText: true })
    expect([source, r.errors.map((e) => e.message)]).toEqual([source, ["Type definition expected instead of ''"]])
  }
})

test("an action's declaration is its ACTION line alone: what the push would drop is reported with its words", () => {
  // Review 4b (volt-cli `ChildSplitterTableTests`): neither vendor stores an action's declaration, so the push refuses a
  // modifier on the line, a comment on it, above it or under it — and the action is still read by the push's name.
  const fb = "FUNCTION_BLOCK F\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nAct();\nEND_FUNCTION_BLOCK\n\n"
  const read = (action: string) => {
    const r = parseSource(fb + action, { networkText: true })
    return { errors: r.errors.map((e) => e.message), names: r.units.map((u) => `${u.kind}:${"name" in u ? u.name?.text : ""}`) }
  }
  const body = "IMPLEMENTATION ST\nout := 4;\nEND_ACTION\n"
  const modifier = read(`ACTION PRIVATE Act\n${body}`)
  expect(modifier.names).toEqual(["function_block:F", "action:Act"])
  expect(modifier.errors).toEqual([
    "Cannot parse ACTION signature: an action has no declaration the IDE stores — its line is 'ACTION Act', so anything else on it would be dropped — ACTION PRIVATE Act",
  ])
  for (const [action, first] of [
    [`ACTION Act // c\n${body}`, "Cannot parse ACTION signature"],
    [`// c\nACTION Act\n${body}`, "'// c' would be part of action 'Act's declaration"],
    [`{attribute 'x'}\nACTION Act\n${body}`, "'{attribute 'x'}' would be part of action 'Act's declaration"],
    [`ACTION Act\n(* c *)\n${body}`, "'(* c *)' would be part of action 'Act's declaration"],
  ] as const) {
    const r = read(action)
    expect([action, r.names, r.errors.length, r.errors[0]?.startsWith(first)]).toEqual([action, ["function_block:F", "action:Act"], 1, true])
  }
  expect(read(`ACTION Act\n\n${body}`).errors).toEqual([])
})

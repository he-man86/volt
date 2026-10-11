/**
 * Lowering tests of `bindings.ts`: an address binding at its declaration is its slot's initial value (lean 7.8.8), and a
 * binding something may read before it ran keeps its store.
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import type { IrPou } from "../../ir/index.js"
import { IMAGE_BASE } from "../../semantics/index.js"

function ir(src: string, name = "P"): IrPou {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

const slotInit = (pou: IrPou, name: string) => pou.slots.find((s) => s.name === name)!.init
const initParts = (pou: IrPou) => pou.routines.filter((r) => r.name.endsWith(".__init")).map((r) => r.name)

test("a program's ADR / REF= binding is the slot's initial value: no init statement, and a constant after it stays one", () => {
  const pou = ir(
    "PROGRAM P\nVAR\n\tp : POINTER TO INT := ADR(x);\n\tx : INT := 5;\n\tref : REFERENCE TO INT REF= x;\n\tthrough : INT;\n\tviaRef : INT;\nEND_VAR\n" +
      "through := p^;\nviaRef := ref;\nEND_PROGRAM\n",
  )
  expect(pou.init).toBeUndefined()
  // x is the image's first variable: both bindings hold its address from the start
  expect([slotInit(pou, "p"), slotInit(pou, "ref")]).toEqual([IMAGE_BASE, IMAGE_BASE])
  const runner = run(pou)
  runner.scan()
  expect([runner.get("through"), runner.get("viaRef")]).toEqual([5n, 5n])
})

test("an FB field's binding is each static instance's __base plus the target's offset, and its __init goes", () => {
  const pou = ir(
    "FUNCTION_BLOCK FB\nVAR\n\tp : POINTER TO INT := ADR(x);\n\tx : INT := 7;\n\tthrough : INT;\nEND_VAR\nthrough := p^;\nx := x + 1;\nEND_FUNCTION_BLOCK\n" +
      "PROGRAM P\nVAR\n\ta : FB;\n\tb : FB;\nEND_VAR\na();\nb();\nb();\nEND_PROGRAM\n",
  )
  expect(pou.init).toBeUndefined()
  expect(initParts(pou)).toEqual([])
  const fields = (name: string) => (slotInit(pou, name) as { fields: Record<string, bigint> }).fields
  for (const name of ["a", "b"]) expect(typeof fields(name).P).toBe("bigint")
  // the same offset from each instance's own region
  expect(fields("a").P! - fields("a").__BASE!).toBe(fields("b").P! - fields("b").__BASE!)
  const runner = run(pou)
  runner.scan()
  expect([runner.get("a.through"), runner.get("b.through")]).toEqual([7n, 8n])
})

test("a tag binding — THIS, REF= an instance — is the field's initial value in the type", () => {
  const pou = ir(
    "FUNCTION_BLOCK Counter\nVAR_OUTPUT count : INT; END_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK\n" +
      "FUNCTION_BLOCK FB\nVAR\n\tself : POINTER TO FB := THIS;\n\tinner : Counter;\n\tref : REFERENCE TO Counter REF= inner;\n\tn : INT := 3;\n\tseen : INT;\nEND_VAR\n" +
      "ref();\nseen := self^.n + inner.count;\nEND_FUNCTION_BLOCK\n" +
      "PROGRAM P\nVAR\n\tinst : FB;\nEND_VAR\ninst();\nEND_PROGRAM\n",
  )
  expect(pou.init).toBeUndefined()
  expect(initParts(pou)).toEqual([])
  const layout = pou.layouts.find((l) => l.name === "FB")!
  for (const name of ["self", "ref"]) expect(layout.fields.find((f) => f.name === name)!.init).not.toBe(0n)
  const runner = run(pou)
  runner.scan()
  expect(runner.get("inst.seen")).toBe(4n)
})

// One test per reader shape: each reads before the binding ran, where folding would change what it sees.
test.each([
  ["by name", "q : POINTER TO INT := p;", "seen := DINT_TO_INT(TO_DINT(q = 0));"],
  ["through another pointer", "o : POINTER TO INT := ADR(y); y : INT := 1; k : INT := o^;", "seen := k;"],
  ["in a call", "k : INT := F();", "seen := k;"],
])("a binding read first %s keeps its store", (_shape, before, body) => {
  const pou = ir(
    "FUNCTION F : INT\nF := 2;\nEND_FUNCTION\n" +
      `PROGRAM P\nVAR\n\t${before}\n\tp : POINTER TO INT := ADR(x);\n\tx : INT := 5;\n\tseen : INT;\nEND_VAR\n${body}\nseen := seen + p^;\nEND_PROGRAM\n`,
  )
  expect(pou.init?.some((s) => s.kind === "assign" && s.target.root === undefined && pou.slots[s.target.slot]!.name === "p")).toBe(true)
  expect(slotInit(pou, "p")).toBe(0n)
})

// Gate 7.8d (review): the proof checked only READS before a binding. A store before it of the same slot ended overwritten
// by the binding; folded, the binding no longer overwrote it — and whether it folded hung on an unrelated call earlier in
// the frame. The review's case — an instance's structured `(p := ADR(y))` over its type's `p := ADR(x)` — is CODESYS's 9
// (`init_structured_binding_override`) with or without that call, before or after the instance, now that the structured
// value is stored after the instance's init (`step.ts`).
test.each([
  ["alone", ""],
  ["a call declared before the instance", "k : INT := F();"],
])("an instance's structured address over its type's binding is the structured one (%s)", (_shape, before) => {
  const pou = ir(
    "FUNCTION F : INT\nF := 2;\nEND_FUNCTION\n" +
      "FUNCTION_BLOCK B\nVAR\n\tp : POINTER TO INT := ADR(x);\n\tx : INT := 7;\n\tseen : INT;\nEND_VAR\nseen := p^;\nEND_FUNCTION_BLOCK\n" +
      `PROGRAM P\nVAR\n\t${before}\n\ty : INT := 9;\n\tb : B := (p := ADR(y));\n\tafter : INT := F();\n\to : INT;\nEND_VAR\nb();\no := b.seen;\nEND_PROGRAM\n`,
  )
  const runner = run(pou)
  runner.scan()
  expect(runner.get("o")).toBe(9n)
})

// ...and the proof itself: a store of a variable of the binding's name before it keeps the binding's store, as a read does
// (conservative: here P's own `p` is other storage than B's field).
test("a store of the binding's name before it keeps the binding's store", () => {
  const pou = ir(
    "FUNCTION_BLOCK B\nVAR\n\tp : POINTER TO INT := ADR(x);\n\tx : INT := 7;\n\tseen : INT;\nEND_VAR\nseen := p^;\nEND_FUNCTION_BLOCK\n" +
      "PROGRAM P\nVAR\n\ty : INT := 1;\n\tk : INT := y + 1;\n\tp : INT := 5;\n\tb : B;\nEND_VAR\nb();\nEND_PROGRAM\n",
  )
  expect(pou.init?.some((s) => s.kind === "assign" && s.target.root === undefined && pou.slots[s.target.slot]!.name === "p")).toBe(true)
  expect(initParts(pou)).toEqual(["B.__init"])
  const runner = run(pou)
  runner.scan()
  expect(runner.get("b.seen")).toBe(7n)
})

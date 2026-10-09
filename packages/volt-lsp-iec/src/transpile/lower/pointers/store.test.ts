/**
 * Lowering tests of `store.ts`'s concern: storing an address into a pointer or a reference.
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/**
 * A NULL POINTER COPIED INTO A POINTER WITH SEVERAL TARGETS STAYS NULL (transpile-restructure 4.13 (b)). The copy wrote its
 * source's target's TAG, a constant, so a null source became non-null; it now re-maps the source's value — NULL to NULL.
 * Recorded: conformance `pointer_null_copied_into_multi_target` (copiedNull TRUE, then the set copy reads 11).
 */
test("a null pointer copied into a pointer with two targets is null; copied once set, it reads the target", () => {
  const src =
    "PROGRAM P\nVAR copiedNull : BOOL; copiedSet : BOOL; readBack : INT; END_VAR\nreadBack := F(copiedNull => copiedNull, copiedSet => copiedSet);\nEND_PROGRAM\n\n" +
    "FUNCTION F : INT\nVAR_OUTPUT copiedNull : BOOL; copiedSet : BOOL; END_VAR\nVAR a : INT := 11; b : INT := 22; never : BOOL; src : POINTER TO INT; p : POINTER TO INT; END_VAR\n" +
    "IF never THEN\n\tsrc := ADR(a);\nEND_IF\np := ADR(b);\np := ADR(a);\np := src;\ncopiedNull := p = 0;\nsrc := ADR(a);\np := src;\ncopiedSet := p <> 0;\nF := p^;\nEND_FUNCTION\n"
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  const p = run(pou!)
  p.scan()
  expect([p.get("copiedNull"), p.get("copiedSet"), p.get("readBack")]).toEqual([true, true, 11n])
})

/**
 * A POINTER TO A WHOLE FB INSTANCE HOLDS ITS INSTANCE HANDLE (transpile-restructure 4.14, design.md §3.3 step 4f): the one
 * numbering an interface's instances use (`interfaces/tags.instanceHandle`), so a value names the same instance whichever
 * variable holds it. It held 1 — its own first target — whatever instance that was.
 */
test("ADR of an instance writes the instance handle an interface holding it would write", () => {
  const src =
    "INTERFACE I_V\nMETHOD V : INT\nEND_METHOD\nEND_INTERFACE\n\n" +
    "FUNCTION_BLOCK FB_V IMPLEMENTS I_V\nVAR k : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD V : INT\nV := k;\nEND_METHOD\n\n" +
    "PROGRAM P\nVAR a : FB_V; b : FB_V; i : I_V; p : POINTER TO FB_V; viaItf : INT; viaPtr : INT; END_VAR\n" +
    "a.k := 3;\nb.k := 5;\ni := a;\np := ADR(b);\nviaItf := i.V();\nviaPtr := p^.V();\ni := b;\nEND_PROGRAM\n"
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  const stored = (name: string) =>
    pou!.body.flatMap((s) => (s.kind === "assign" && s.target.root === undefined && pou!.slots[s.target.slot]!.name === name && s.value.kind === "const" ? [s.value.value] : []))
  // a is handle 1 (the interface stored it first), b handle 2 — the pointer and the interface write b alike
  expect(stored("p")).toEqual([2n])
  expect(stored("i")).toEqual([1n, 2n])
  const p = run(pou!)
  p.scan()
  expect([p.get("viaItf"), p.get("viaPtr")]).toEqual([3n, 5n])
})

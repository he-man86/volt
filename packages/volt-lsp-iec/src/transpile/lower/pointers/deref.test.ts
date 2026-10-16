/**
 * Lowering tests of `deref.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { IecFault } from "../../semantics/index.js"
import { ir } from "../../../../test/support/transpile.js"

test("a pointer INPUT of the POU being lowered says nobody supplies it, rather than blaming the pointer order", () => {
  // The corpus shape, exactly: `Bools_To_Byte` copies its `POINTER TO BOOL` input into a local and dereferences
  // THAT, so a guard on the dereference alone never sees the input. Measured 2026-09-20: two of the five POUs
  // `pointer-order` alone stopped were this, and neither is a gap — a root has no caller, and the vendor does
  // not run them either (the only declaration of one in the corpus is never called).
  const fb =
    `FUNCTION_BLOCK FB_Root\n` +
    `VAR_INPUT pIn : POINTER TO BOOL; END_VAR\n` +
    `VAR copy : POINTER TO BOOL; out : BOOL; END_VAR\n` +
    `copy := pIn;\nout := copy^;\nEND_FUNCTION_BLOCK\n`
  expect(lowerSource(fb, "FB_Root").diagnostics.map((d) => d.code)[0]).toBe("pointer-root-input")

  // ...and a CALLED FB is not that: its caller supplies the input, so the ordinary refusal stands. Without this
  // the new code would swallow every uninitialized-pointer case in the corpus rather than the two it is for.
  const called =
    `PROGRAM P\nVAR inst : FB_Root; b : BOOL; END_VAR\ninst(pIn := ADR(b));\nEND_PROGRAM\n\n` + fb
  expect(lowerSource(called, "P").diagnostics.map((d) => d.code)).not.toContain("pointer-root-input")
})

/**
 * A REFERENCE IS IMPLICITLY DEREFERENCED — `r.x` MEANS `r^.x`, and `r[1]` means `r^[1]`.
 *
 * That is the whole difference between `REFERENCE TO` and `POINTER TO` in IEC: a pointer needs a written `^`, a
 * reference never does. `lowerPlace` applied its field and index steps to the reference VARIABLE, which is neither a
 * struct nor an array, so `r.x` said "member access is not lowered yet" and `r[1]` said "an index on something that is
 * not a sized array". Both read as unbuilt machinery. In fact `pointeePlace` already resolved exactly this — a
 * REFERENCE records its target through `storePointer` as a pointer does, and a scalar `a := rv` already worked. Only
 * the step was missing, which is why the review filed this as MIS-CLASSIFIED rather than unbuilt.
 *
 * The PROPERTY case is the same shape one layer up: `propertyAccess` asked the reference's OWN type twice — the
 * inferred type was `reference`, never `function_block` — so `r.Size` was not recognised as a property at all and fell
 * through to the generic member path. `instancePlace` was already the answer; it was simply never called here, though
 * a body call and a METHOD through the same reference had used it since `xo_reference_to_fb_call`.
 */
describe("a reference is stepped THROUGH, not stepped on", () => {
  const readsBack = (source: string, want: bigint): void => {
    const r = lowerSource(source, "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("a")).toBe(want)
  }

  test("a field is read through a REFERENCE TO a struct", () => readsBack("TYPE Pt : STRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tp : Pt;\n\trv : REFERENCE TO Pt;\n\ta : INT;\nEND_VAR\np.x := 5;\nrv REF= p;\na := rv.x;\nEND_PROGRAM\n", 5n))
  test("a field is written through a REFERENCE TO a struct", () => readsBack("TYPE Pt : STRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tp : Pt;\n\trv : REFERENCE TO Pt;\n\ta : INT;\nEND_VAR\nrv REF= p;\nrv.x := 8;\na := p.x;\nEND_PROGRAM\n", 8n))
  test("an element is read through a REFERENCE TO an array", () => readsBack("PROGRAM PLC_PRG\nVAR\n\tarr : ARRAY[0..2] OF INT;\n\trv : REFERENCE TO ARRAY[0..2] OF INT;\n\ta : INT;\nEND_VAR\narr[1] := 9;\nrv REF= arr;\na := rv[1];\nEND_PROGRAM\n", 9n))
  test("an element is written through a REFERENCE TO an array", () => readsBack("PROGRAM PLC_PRG\nVAR\n\tarr : ARRAY[0..2] OF INT;\n\trv : REFERENCE TO ARRAY[0..2] OF INT;\n\ta : INT;\nEND_VAR\nrv REF= arr;\nrv[2] := 6;\na := arr[2];\nEND_PROGRAM\n", 6n))
  test("a PROPERTY is read through a REFERENCE TO an FB", () => readsBack("FUNCTION_BLOCK FB_C\nVAR\n\tside : INT := 3;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n\nPROGRAM PLC_PRG\nVAR\n\tc : FB_C;\n\trv : REFERENCE TO FB_C;\n\ta : INT;\nEND_VAR\nrv REF= c;\na := rv.Size;\nEND_PROGRAM\n", 3n))
  test("a PROPERTY is written through a REFERENCE TO an FB", () => readsBack("FUNCTION_BLOCK FB_C\nVAR\n\tside : INT := 3;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n\nPROGRAM PLC_PRG\nVAR\n\tc : FB_C;\n\trv : REFERENCE TO FB_C;\n\ta : INT;\nEND_VAR\nrv REF= c;\nrv.Size := 7;\na := c.Size;\nEND_PROGRAM\n", 7n))
  test("and a POINTER still reaches the property through its written ^", () => readsBack("FUNCTION_BLOCK FB_C\nVAR\n\tside : INT := 3;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n\nPROGRAM PLC_PRG\nVAR\n\tc : FB_C;\n\tq : POINTER TO FB_C;\n\ta : INT;\nEND_VAR\nq := ADR(c);\na := q^.Size;\nEND_PROGRAM\n", 3n))
})

// transpile-review 14: `p^ R= c` through a pointer naming two variables STORED the condition in the arm's target instead
// of latching it — CODESYS (`tr_14_set_reset_through_multi_target_pointer`): R= TRUE clears, S= FALSE leaves alone.
test("S= and R= through a pointer naming several variables latch the target, not store the condition", () => {
  const source =
    "PROGRAM P\nVAR\n\tc : BOOL; ct : BOOL := TRUE; a : BOOL := TRUE; b : BOOL; a2 : BOOL; b2 : BOOL; tb : BOOL := TRUE; ta : BOOL; tb2 : BOOL; ta2 : BOOL;\n" +
    "\tp : POINTER TO BOOL; q : POINTER TO BOOL; pt : POINTER TO BOOL; qt : POINTER TO BOOL;\nEND_VAR\n" +
    "p := ADR(a); IF c THEN p := ADR(b); END_IF; p^ R= TRUE;\nq := ADR(a2); IF c THEN q := ADR(b2); END_IF; q^ S= FALSE;\n" +
    "pt := ADR(ta); IF ct THEN pt := ADR(tb); END_IF; pt^ R= TRUE;\nqt := ADR(ta2); IF ct THEN qt := ADR(tb2); END_IF; qt^ S= FALSE;\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["a", "b", "a2", "b2", "ta", "tb", "ta2", "tb2"].map((n) => runner.get(n))).toEqual([false, false, false, false, false, false, false, false])
})

/**
 * A USE AFTER A REFUSED STORE IS NOT `pointer-order` (transpile-restructure 4b, gate review of 4.1's census).
 *
 * `pb := ADR(sv)` refused (`pointer-type`: a POINTER TO BYTE at a STRUCT) left `pb` with no recorded target, so every
 * later `pb^` and `pb + 1` said "dereferenced before any address was stored into it" — false, one was stored the
 * statement before, and the census counted each of those knock-ons as a cross-frame blocker. The use repeats the
 * store's own code and says what happened. And an INTEGER stored into a pointer (`q := lw`, an LWORD) is a byte view
 * (`pointer-value`), not a pointer "copied before any address was stored into it".
 */
describe("a pointer whose store was refused", () => {
  const codes = (src: string) => lowerSource(src, "PLC_PRG").diagnostics.map((d) => `${d.code} | ${d.message}`)

  // A POINTER TO BYTE at a STRUCT (the shape this was found on) is the byte view model 3 holds (design.md §3.3 step
  // 4d); a POINTER TO INT at a STRING is still refused — a string is no image type, so the pointer keeps a TAG
  test("a dereference after a refused store repeats the store's code, not pointer-order", () => {
    const got = codes(
      "PROGRAM PLC_PRG\nVAR\n\ttxt : STRING;\n\tps : POINTER TO INT;\n\tx : INT;\nEND_VAR\nps := ADR(txt);\nx := ps^;\nps := ps + 2;\nEND_PROGRAM\n",
    )
    expect(got.some((d) => d.startsWith("pointer-order"))).toBe(false)
    expect(got[0]!.startsWith("pointer-type")).toBe(true)
    expect(got.slice(1)).toEqual([
      "pointer-type | the pointer variable ps dereferenced after its store was refused (pointer-type)",
      "pointer-type | the pointer variable ps copied after its store was refused (pointer-type)",
    ])
  })

  // A pointer that holds an ADDRESS needs no store before its dereference (model 3): the refused store is its only
  // diagnostic, and it still names the integer for what it is
  test("an integer stored into a pointer is pointer-value, not pointer-order", () => {
    const got = codes(
      "PROGRAM PLC_PRG\nVAR\n\tarr : ARRAY[0..3] OF INT;\n\tp : POINTER TO INT;\n\tq : POINTER TO INT;\n\tlw : LWORD;\n\tv : INT;\nEND_VAR\np := ADR(arr[1]);\nlw := 5;\nq := lw;\nv := q^;\nEND_PROGRAM\n",
    )
    expect(got).toEqual(["pointer-value | an integer (lw) stored as a pointer — its value is a byte address"])
  })
})

/**
 * A TARGET SET READ WHILE IT STILL GROWS (transpile-restructure 4.13 (a)). `p^` lowered while `p` had one recorded target
 * erased to it, and the store that adds the second target comes later in the source — so in a loop the second pass read
 * the first target again. The escape loop now lowers once more with the final sets seeded (`state.grownTargets`).
 * Recorded: conformance `pointer_target_set_grows_after_read` (11 + 22 = 33; the erasure gave 22).
 */
test("a dereference lowered before the store that adds a target reads every target", () => {
  const src =
    "PROGRAM P\nVAR grown : INT; END_VAR\ngrown := F();\nEND_PROGRAM\n\n" +
    "FUNCTION F : INT\nVAR a : INT := 11; b : INT := 22; p : POINTER TO INT; k : INT; END_VAR\nF := 0;\np := ADR(a);\nFOR k := 1 TO 2 DO\n\tF := F + p^;\n\tp := ADR(b);\nEND_FOR\nEND_FUNCTION\n"
  const p = run(ir(src, "P"))
  p.scan()
  expect(p.get("grown")).toBe(33n)
})

// The same growing set read through a COPY made each pass: before the seeded re-lowering the copy erased to the one
// target the set had when `q := p` lowered and answered 22 silently (the vendor's 11 + 22 = 33,
// `pointer_target_set_grows_copied`). Seeded, `p` names two variables when it is copied, and a copy of such a pointer
// builds no arms of its own: refused by name, never the wrong number (review of transpile-restructure 4f).
test("a pointer copied before the store that adds a target is refused by name, not read with one target", () => {
  const src =
    "FUNCTION F : INT\nVAR a : INT := 11; b : INT := 22; p : POINTER TO INT; q : POINTER TO INT; k : INT; END_VAR\nF := 0;\np := ADR(a);\nFOR k := 1 TO 2 DO\n\tq := p;\n\tF := F + q^;\n\tp := ADR(b);\nEND_FOR\nEND_FUNCTION\n\n" +
    "PROGRAM P\nVAR g : INT; END_VAR\ng := F();\nEND_PROGRAM\n"
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(pou).toBeUndefined()
  expect(diagnostics[0]?.code).toBe("pointer-targets")
})

// A FUNCTION's local pointer dereferenced BEFORE the store that gives it its target: refused `pointer-order` until the
// seeded re-lowering, which lowers it with the final set — and every call starts with the pointer NULL, so the read is
// a null dereference. The vendor stops there too (`pointer_deref_before_first_store`: the application never answers,
// as `cc_fp_ptr_deref` records for a plain null dereference; review of transpile-restructure 4f).
test("a FUNCTION's pointer dereferenced before its first store faults as a null dereference, as the vendor stops", () => {
  const src =
    "PROGRAM P\nVAR x : INT; END_VAR\nx := F();\nEND_PROGRAM\n\n" +
    "FUNCTION F : INT\nVAR a : INT := 11; p : POINTER TO INT; END_VAR\nF := p^;\np := ADR(a);\nEND_FUNCTION\n"
  const runner = run(ir(src, "P"))
  expect(() => runner.scan()).toThrow(IecFault)
})

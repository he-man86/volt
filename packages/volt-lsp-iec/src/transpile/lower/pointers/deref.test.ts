/**
 * Lowering tests of `deref.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

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

  test("a dereference after a refused store repeats the store's code, not pointer-order", () => {
    const got = codes(
      "TYPE S : STRUCT\n\tb : BYTE;\n\td : DWORD;\nEND_STRUCT\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tsv : S;\n\tpb : POINTER TO BYTE;\n\tx : BYTE;\nEND_VAR\npb := ADR(sv);\nx := pb^;\npb := pb + 1;\nEND_PROGRAM\n",
    )
    expect(got.some((d) => d.startsWith("pointer-order"))).toBe(false)
    expect(got[0]!.startsWith("pointer-type")).toBe(true)
    expect(got.slice(1)).toEqual([
      "pointer-type | the pointer variable pb dereferenced after its store was refused (pointer-type)",
      "pointer-type | the pointer variable pb copied after its store was refused (pointer-type)",
    ])
  })

  test("an integer stored into a pointer is pointer-value, not pointer-order", () => {
    const got = codes(
      "PROGRAM PLC_PRG\nVAR\n\tarr : ARRAY[0..3] OF INT;\n\tp : POINTER TO INT;\n\tq : POINTER TO INT;\n\tlw : LWORD;\n\tv : INT;\nEND_VAR\np := ADR(arr[1]);\nlw := 5;\nq := lw;\nv := q^;\nEND_PROGRAM\n",
    )
    expect(got.some((d) => d.startsWith("pointer-order"))).toBe(false)
    expect(got[0]).toBe("pointer-value | an integer (lw) stored as a pointer — its value is a byte address")
    expect(got[1]).toBe("pointer-value | the pointer variable q dereferenced after its store was refused (pointer-value)")
  })
})

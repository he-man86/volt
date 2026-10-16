/**
 * Lowering is total: it reports what it cannot lower, never throws, never answers silently wrong — the old lowering
 * test file's "total, never silently wrong" (task 1.8.1) and the corpus-unreachable shapes (task 1.8.2).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { ir, wrap } from "../../../../test/support/transpile.js"

describe("lower — total, never silently wrong", () => {
  test("an unlowerable construct is reported with a code, and the POU does not lower", () => {
    // ADR, not MAX: MAX lowers now. ADR waits on the memory model (design §9), so it stays unlowerable for a while.
    const { pou, diagnostics } = lowerSource(wrap("iCount := ADR(iCount);"))
    expect(pou).toBeUndefined()
    expect(diagnostics.map((d) => d.code)).toEqual(["expr-call"])
    expect(diagnostics[0]!.span.startLine).toBe(5)
  })

  test("bit access through a REFERENCE reads through it: an unbound root input says so, not a bad bit index", () => {
    // pro2193 MapperInputs.pou: `slice : REFERENCE TO BYTE; bit1 := slice.0;`. It was `bit-on-reference` ("phase 4"); the
    // bit is the referenced byte's (conformance `reference_bit_access`, transpile-restructure 4.13 (d)), so what is left
    // is the root's input nobody binds
    const { diagnostics } = lowerSource("PROGRAM P\nVAR_INPUT slice : REFERENCE TO BYTE; END_VAR\nVAR b : BOOL; w : WORD; END_VAR\nb := slice.0;\nEND_PROGRAM\n")
    expect(diagnostics.map((d) => d.code)).toEqual(["pointer-root-input"])
    const beyond = lowerSource("PROGRAM P\nVAR b : BOOL; w : WORD; END_VAR\nb := w.16;\nEND_PROGRAM\n")
    expect(beyond.diagnostics.map((d) => d.code)).toEqual(["bit-index"])
  })

  // This refused a project GVL variable until globals lowered (phase 3 step 5); the refusal it pins moved to a name that
  // still has no storage — a LIBRARY's global, which lowering leaves unmodelled.
  test("a name that is not a frame slot says WHAT it is, using the symbol table", () => {
    const library = { uri: "Library Manager/SomeLib/GVL_Lib.gvl", source: "VAR_GLOBAL\n  gLibCounter : INT;\nEND_VAR\n" }
    const { diagnostics } = lowerSource(
      `
PROGRAM P
VAR
  iCount : INT;
END_VAR
iCount := gLibCounter;
END_PROGRAM
`,
      "P",
      [library],
    )
    expect(diagnostics[0]!.code).toBe("place-not-local")
    expect(diagnostics[0]!.message).toContain("gvl_var")
  })

  test("a GVL variable, read directly or through VAR_EXTERNAL, is the application's storage — one slot for both", () => {
    const { pou, diagnostics } = lowerSource(`
VAR_GLOBAL
  gTotal : INT := 5;
END_VAR

PROGRAM P
VAR_EXTERNAL
  gTotal : INT;
END_VAR
VAR
  iCount : INT;
END_VAR
iCount := gTotal;
gTotal := iCount + 1;
END_PROGRAM
`)
    expect(diagnostics).toEqual([])
    expect(pou!.slots.map((s) => s.name)).toEqual(["iCount"]) // the VAR_EXTERNAL is no local copy
    expect(pou!.globals.map((s) => [s.name, s.init])).toEqual([["gTotal", 5n]])
  })

  // Recorded (`callshape_inout_binding_order`): an in-out is bound where it is written — 201 after a call that moves its
  // index, 101 before it. Both backends bind every in-out after the inputs; where that differs, the call is refused. Why
  // missed: the argument-order recording had inputs only.
  test("an in-out is bound where it is written: after a call in an earlier argument, refused before one", () => {
    const take = "FUNCTION F_Take : INT\nVAR_INPUT stepValue : INT; END_VAR\nVAR_IN_OUT boundValue : INT; END_VAR\nF_Take := boundValue * 10 + stepValue;\nEND_FUNCTION\n"
    const program = (call: string) =>
      `PROGRAM P\nVAR o : FB_O; END_VAR\no();\nEND_PROGRAM\nFUNCTION_BLOCK FB_O\nVAR_OUTPUT got : INT; END_VAR\nVAR numbers : ARRAY[0..3] OF INT := [10, 20, 30, 40]; cursor : INT; END_VAR\ncursor := 0;\ngot := ${call};\nEND_FUNCTION_BLOCK\nMETHOD Advance : INT\ncursor := cursor + 1;\nAdvance := cursor;\nEND_METHOD\n${take}`
    const after = run(ir(program("F_Take(stepValue := Advance(), boundValue := numbers[cursor])"), "P"))
    after.scan()
    expect(after.get("o.got")).toEqual(201n)
    // Written before the call, it was refused (`call-inout-order`) — both backends bound it after the inputs. Its index is
    // now taken where it is written, which the recording shows CODESYS binding: 101.
    const before = run(ir(program("F_Take(boundValue := numbers[cursor], stepValue := Advance())"), "P"))
    before.scan()
    expect(before.get("o.got")).toEqual(101n)
    // A VAR_OUTPUT target is not an in-out. Refused here while unrecorded (review of the batch); recorded since
    // (`callshape_output_index_before_call`): its index is read after the inputs — 7 lands in numbers[1], not numbers[0].
    const output = "FUNCTION F_Out : INT\nVAR_INPUT stepValue : INT; END_VAR\nVAR_OUTPUT res : INT; END_VAR\nres := 7;\nEND_FUNCTION\n"
    const outputRun = run(ir(program("F_Out(res => numbers[cursor], stepValue := Advance())") + output, "P"))
    outputRun.scan()
    expect([outputRun.get("o.numbers[0]"), outputRun.get("o.numbers[1]")]).toEqual([10n, 7n])
    // a binding nothing can move — a constant index — lowers in either order
    const fixed = run(ir(program("F_Take(boundValue := numbers[2], stepValue := Advance())"), "P"))
    fixed.scan()
    expect(fixed.get("o.got")).toEqual(301n)
    // A pointer's target moves with the POINTER, and `p^`'s index is read from it — so the pointer's own value is frozen
    // where the in-out is written, as an index is (conformance `callshape_inout_pointer_before_call`: 101, boundValue
    // still numbers[0] after a later argument repoints p). It was refused (`call-inout-order`).
    const pointed = run(
      ir(
        "PROGRAM P\nVAR o : FB_P; END_VAR\no();\nEND_PROGRAM\nFUNCTION_BLOCK FB_P\nVAR_OUTPUT got : INT; END_VAR\nVAR numbers : ARRAY[0..1] OF INT := [10, 20]; p : POINTER TO INT; END_VAR\np := ADR(numbers[0]);\ngot := F_Take(boundValue := p^, stepValue := Repoint());\nEND_FUNCTION_BLOCK\nMETHOD Repoint : INT\np := ADR(numbers[1]);\nRepoint := 1;\nEND_METHOD\n" +
          take,
        "P",
      ),
    )
    pointed.scan()
    expect([pointed.get("o.got"), pointed.get("o.numbers[0]"), pointed.get("o.numbers[1]")]).toEqual([101n, 10n, 20n])
  })

  // An ANY_INT input's `pValue` taken into a UNION of POINTERs and the caller's variable written through the member its
  // `diSize` selects (conformance `state_any_int_pointer_increment`: 1 -> 6, 2 -> 7, 3 -> 8, 4 -> 9). Three refusals at
  // once until now — `any-input` allowed only `.diSize`, `layout-union` only measured bytes, and a pointer records ONE
  // target while the four call sites pass four variables. An ANY input a call names a VARIABLE for is a hidden
  // VAR_IN_OUT bound to it, so the routine is lowered once per argument type and form 1 is enough.
  test("an ANY input's pValue is the variable the call names, read back through a union of pointers", () => {
    const source =
      "FUNCTION F_Inc : BOOL\nVAR_INPUT input : ANY_INT; incrementBy : INT := 1; END_VAR\nVAR u : DUT_Ptrs; END_VAR\n" +
      "u.p1_Byte := input.pValue;\nCASE input.diSize OF\n1: u.p1_Sint^ := u.p1_Sint^ + TO_SINT(incrementBy);\n2: u.p2_Int^ := u.p2_Int^ + incrementBy;\n4: u.p4_Dint^ := u.p4_Dint^ + incrementBy;\n8: u.p8_Lint^ := u.p8_Lint^ + incrementBy;\nEND_CASE\nF_Inc := TRUE;\nEND_FUNCTION\n" +
      "TYPE DUT_Ptrs :\nUNION\np1_Byte : POINTER TO BYTE;\np1_Sint : POINTER TO SINT;\np2_Int : POINTER TO INT;\np4_Dint : POINTER TO DINT;\np8_Lint : POINTER TO LINT;\nEND_UNION\nEND_TYPE\n"
    const runner = run(
      ir(
        "PROGRAM P\nVAR siArg : SINT := 1; iArg : INT := 2; dArg : DINT := 3; lArg : LINT := 4; done : BOOL; END_VAR\n" +
          "done := F_Inc(siArg, 5);\ndone := F_Inc(iArg, 5);\ndone := F_Inc(dArg, 5);\ndone := F_Inc(lArg, 5);\nEND_PROGRAM\n" +
          source,
        "P",
      ),
    )
    runner.scan()
    expect(["siArg", "iArg", "dArg", "lArg", "done"].map((v) => runner.get(v))).toEqual([6n, 7n, 8n, 9n, true])
    // An ANY argument that is no variable has no address to hand on: `pValue` is refused — and the dereferences that
    // follow then have no target for that same reason, so they repeat `any-input` where each stands. They said
    // `pointer-order` ("before any address was stored"), false — one was stored and refused (transpile-restructure 4b).
    const literal = lowerSource(`PROGRAM P\nVAR done : BOOL; END_VAR\ndone := F_Inc(7, 5);\nEND_PROGRAM\n${source}`, "P").diagnostics.map((d) => d.code)
    expect([literal[0], ...new Set(literal.slice(1))]).toEqual(["any-input", "any-input"])
  })

  // A referenced library's NAMESPACE, read from its `<folder>.library` manifest and bound over the units it materialized
  // (`symbols/bindLibraryNamespaces`). pro2193's `enumErrorSeverity` takes every one of its values from
  // `TO_USINT(L_IE1P.L_IE1P_SeverityLevel.…)`, which folded to nothing: the namespace resolved to nothing, and
  // `constEval` folds no call. Why missed: no fixture ever qualified a name with a library namespace.
  test("an enum value taken from a library namespace, converted, folds to the value the library declares", () => {
    const LIB = "C:/p/Device/Plc Logic/Application/Library Manager/LibSeverity"
    const libraries = [
      { uri: `${LIB}/LibSeverity.library`, source: "LIBRARY LibSeverity\nNAMESPACE LSEV\nRESOLUTION LibSeverity, 1.0.0.0 (Acme)\n" },
      { uri: `${LIB}/E_SEVERITY.dut`, source: "TYPE E_Severity :\n(\n\tLow := 2,\n\tHigh := 30\n);\nEND_TYPE\n" },
    ]
    // `level` states its own start. E_Local's first enumerator is Quiet = 2, and where a variable of such an enum
    // starts is unmeasured (`refuseUnmeasuredEnumDefault`) — a question this test is not about. What it measures is
    // that a library NAMESPACE's values fold, which needs no opinion about defaults: a variable with an initializer
    // never takes the type's.
    const source =
      "TYPE E_Local :\n(\n\tQuiet := TO_USINT(LSEV.E_Severity.Low),\n\tLoud := TO_USINT(LSEV.E_Severity.High)\n) USINT;\nEND_TYPE\n" +
      "PROGRAM P\nVAR level : E_Local := E_Local.Quiet; n : USINT; END_VAR\nlevel := E_Local.Loud;\nn := TO_USINT(level) + TO_USINT(E_Local.Quiet);\nEND_PROGRAM\n"
    const { pou, diagnostics } = lowerSource(source, "P", libraries)
    expect(diagnostics).toEqual([])
    const runner = run(pou!)
    runner.scan()
    expect([runner.get("level"), runner.get("n")]).toEqual([30n, 32n])
    // without the manifest the namespace is not a name at all, and the enum's values do not fold — reported, never guessed
    const noManifest = lowerSource(source, "P", [libraries[1]!])
    expect(noManifest.diagnostics.map((d) => d.code)).toContain("enum-value")
  })

  // Found by the cross-object fixture batch (2026-09-16), each a construct the single-object catalog never held.
  // `xo_reference_to_fb_call`: a REFERENCE TO an FB is called, and its METHOD run, on what it points at — the place
  // resolved, but every call path looked at the reference's OWN type (`stmt-call_stmt`, then `call-method`).
  test("a REFERENCE TO an FB is called, and its METHOD run, on the instance it points at", () => {
    const source =
      "PROGRAM P\nVAR u : FB_U; END_VAR\nu();\nEND_PROGRAM\n" +
      "FUNCTION_BLOCK FB_Engine\nVAR_INPUT throttle : INT; END_VAR\nVAR revs : INT; END_VAR\nrevs := revs + throttle;\nEND_FUNCTION_BLOCK\n" +
      "METHOD Boost : INT\nrevs := revs + 100;\nBoost := revs;\nEND_METHOD\n" +
      "FUNCTION_BLOCK FB_U\nVAR left : FB_Engine; right : FB_Engine; chosen : REFERENCE TO FB_Engine; boosted : INT; END_VAR\n" +
      "chosen REF= right;\nchosen(throttle := 7);\nboosted := chosen.Boost();\nEND_FUNCTION_BLOCK\n"
    const runner = run(ir(source, "P"))
    runner.scan()
    runner.scan()
    // two scans of 7 then +100, all on `right`; `left` is never touched (conformance `xo_reference_to_fb_call`: 214)
    expect([runner.get("u.right.revs"), runner.get("u.boosted"), runner.get("u.left.revs")]).toEqual([214n, 214n, 0n])
  })

  // `xo_interface_array_dispatch`: an ARRAY of interfaces, written per element and called through a runtime index.
  // An interface place was keyed by the variable or an FB field only, so an ELEMENT had no key (`interface-place`).
  test("an ARRAY of interfaces holds one instance per element and dispatches on the tag the element holds", () => {
    const source =
      "PROGRAM P\nVAR a : FB_Add; d : FB_Dbl; ops : ARRAY[1..2] OF ITF_Op; i : INT; total : INT; END_VAR\n" +
      "ops[1] := a;\nops[2] := d;\ntotal := 1;\nFOR i := 1 TO 2 DO\n\ttotal := ops[i].Apply(value := total);\nEND_FOR\nEND_PROGRAM\n" +
      "INTERFACE ITF_Op\nMETHOD Apply : INT\nVAR_INPUT value : INT; END_VAR\nEND_METHOD\nEND_INTERFACE\n" +
      "FUNCTION_BLOCK FB_Add IMPLEMENTS ITF_Op\nVAR calls : INT; END_VAR\nEND_FUNCTION_BLOCK\n" +
      "METHOD Apply : INT\nVAR_INPUT value : INT; END_VAR\ncalls := calls + 1;\nApply := value + 10;\nEND_METHOD\n" +
      "FUNCTION_BLOCK FB_Dbl IMPLEMENTS ITF_Op\nVAR calls : INT; END_VAR\nEND_FUNCTION_BLOCK\n" +
      "METHOD Apply : INT\nVAR_INPUT value : INT; END_VAR\ncalls := calls + 1;\nApply := value * 2;\nEND_METHOD\n"
    const runner = run(ir(source, "P"))
    runner.scan()
    // 1 -> the adder's 11 -> the doubler's 22, each implementation called once (conformance `xo_interface_array_dispatch`)
    expect([runner.get("total"), runner.get("a.calls"), runner.get("d.calls")]).toEqual([22n, 1n, 1n])
  })

  // Batch two of the cross-object fixtures (2026-09-16), two more constructs the single-object catalog never held.
  // `xo2_instance_in_struct`: an FB instance held as a STRUCT FIELD, called through it. Only an FB's layout was looked
  // at, so the call went on as a METHOD of the struct and was refused `call-method`.
  test("an FB instance held in a STRUCT field is called, and its METHOD run, through the field", () => {
    const source =
      "PROGRAM P\nVAR m : FB_M; END_VAR\nm();\nEND_PROGRAM\n" +
      "FUNCTION_BLOCK FB_Motor\nVAR_INPUT speed : INT; END_VAR\nVAR travelled : INT; END_VAR\ntravelled := travelled + speed;\nEND_FUNCTION_BLOCK\n" +
      "METHOD Halt : INT\ntravelled := 0;\nHalt := speed;\nEND_METHOD\n" +
      "TYPE T_Axis : STRUCT drive : FB_Motor; name : STRING(6); END_STRUCT END_TYPE\n" +
      "FUNCTION_BLOCK FB_M\nVAR x : T_Axis; lastSpeed : INT; END_VAR\nx.name := 'X';\nx.drive(speed := 6);\nIF x.drive.travelled > 10 THEN\n\tlastSpeed := x.drive.Halt();\nEND_IF\nEND_FUNCTION_BLOCK\n"
    const runner = run(ir(source, "P"))
    for (let scan = 0; scan < 3; scan++) runner.scan()
    // 6, then 12 which trips the Halt back to 0, then 6 again (conformance `xo2_instance_in_struct`)
    expect([runner.get("m.x.drive.travelled"), runner.get("m.lastSpeed"), runner.get("m.x.name")]).toEqual([6n, 6n, "X"])
  })

  // `xo2_property_override_chain`: a PROPERTY read through SUPER^ runs the BASE's accessor, as `SUPER^.M()` runs the
  // base's METHOD. It was no place at all — `place-shape`, "deref is not a lowerable storage location".
  test("a PROPERTY read through SUPER^ runs the base's accessor, not the override", () => {
    const source =
      "PROGRAM P\nVAR d : FB_D; outside : INT; END_VAR\nd();\noutside := d.Level;\nEND_PROGRAM\n" +
      "FUNCTION_BLOCK FB_B\nVAR stored : INT := 1; getRuns : INT; setRuns : INT; END_VAR\nEND_FUNCTION_BLOCK\n" +
      "PROPERTY Level : INT\nGET\ngetRuns := getRuns + 1;\nLevel := stored;\nEND_GET\nSET\nsetRuns := setRuns + 1;\nstored := Level;\nEND_SET\nEND_PROPERTY\n" +
      "FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR seen : INT; viaSuper : INT; END_VAR\nLevel := 40;\nseen := Level;\nviaSuper := SUPER^.Level;\nEND_FUNCTION_BLOCK\n" +
      "PROPERTY Level : INT\nGET\ngetRuns := getRuns + 1;\nLevel := stored * 2;\nEND_GET\nSET\nsetRuns := setRuns + 1;\nstored := Level + 1;\nEND_SET\nEND_PROPERTY\n"
    const runner = run(ir(source, "P"))
    runner.scan()
    // the derived setter stores 41, the derived getter doubles it, SUPER^ reads the base's 41 (conformance
    // `xo2_property_override_chain`), and three getter runs in all — derived, base, and PLC_PRG's read
    expect([runner.get("d.stored"), runner.get("d.seen"), runner.get("d.viaSuper")]).toEqual([41n, 82n, 41n])
    expect([runner.get("d.getRuns"), runner.get("d.setRuns"), runner.get("outside")]).toEqual([3n, 1n, 82n])
  })

  // `WSTRING_TO_STRING` / `STRING_TO_WSTRING` were `conversion-type` — every STRING conversion was to or from a NUMBER.
  // Recorded first (conformance `xo3_string_wide_conversions`): one code unit per code unit, truncated at the TARGET's
  // capacity, both ways. Every unit the model holds is ASCII (a non-ASCII literal is refused), so nothing is re-encoded.
  test("WSTRING and STRING convert one code unit per code unit, truncated at the target's capacity", () => {
    const runner = run(
      ir(
        "PROGRAM P\nVAR\n\twide : WSTRING(10) := \"abcdefghij\";\n\tnarrow : STRING(4);\n\troomy : STRING(20);\n\tback : WSTRING(3);\n\tshort : STRING(6) := 'hello';\n\twidened : WSTRING(2);\n\tsameText : BOOL;\nEND_VAR\n" +
          "narrow := WSTRING_TO_STRING(wide);\nroomy := WSTRING_TO_STRING(wide);\nback := STRING_TO_WSTRING(roomy);\nwidened := STRING_TO_WSTRING(short);\nsameText := roomy = 'abcdefghij';\nEND_PROGRAM\n",
        "P",
      ),
    )
    runner.scan()
    expect(["narrow", "roomy", "back", "widened", "sameText"].map((v) => runner.get(v))).toEqual(["abcd", "abcdefghij", "abc", "he", true])
  })

  test("lowering never throws, whatever it is handed", () => {
    for (const src of ["", "PROGRAM P END_PROGRAM", wrap("iCount := ptr^;", "iCount : INT;\n  ptr : POINTER TO INT;")])
      expect(() => lowerSource(src)).not.toThrow()
  })

  test("a POU whose statements all lower is still refused when a slot has no runtime representation", () => {
    // An unused POINTER lowered cleanly and made the Rust emitter throw — every backend must take what lowering gives it.
    // A pointer has a representation since phase 3 step 6b (its one target's index), an interface since phase 5 (its
    // instance's tag) — this used an unused interface variable. An array whose bounds do not fold still has none.
    const { pou, diagnostics } = lowerSource(
      "PROGRAM P\nVAR\n  iCount : INT;\n  sized : ARRAY[0..iCount] OF INT;\nEND_VAR\niCount := 1;\nEND_PROGRAM\n",
      "P",
    )
    expect(pou).toBeUndefined()
    expect(diagnostics.map((d) => d.code)).toEqual(["slot-array"])
  })

  test("an ARRAY[*] is a slice only where a call lends it — in a VAR or an FB's VAR_INPUT it is no slot", () => {
    // frontend-conformance 2.3.6: `decl_array_star_in_var`, `_two_stars`, `_in_fb_input` (both vendors refuse them) lowered
    // as if every open array were a VAR_IN_OUT, and the Rust emitter threw on the slot ("no Rust mapping for a array type")
    const fb = (sections: string) =>
      `PROGRAM P\nVAR inst : F; END_VAR\ninst();\nEND_PROGRAM\nFUNCTION_BLOCK F\n${sections}\nVAR out : INT; END_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`
    for (const sections of ["VAR a : ARRAY[*] OF INT; END_VAR", "VAR a : ARRAY[*, *] OF INT; END_VAR", "VAR_INPUT a : ARRAY[*] OF INT; END_VAR"]) {
      const { pou, diagnostics } = lowerSource(fb(sections), "P")
      expect(pou).toBeUndefined()
      expect(diagnostics.map((d) => d.code)).toEqual(["slot-array"])
    }
    // a FUNCTION's VAR_INPUT is lent by its call (`decl_array_star_in_function_input` builds and runs on CODESYS): not
    // refused as a slot — what lowering says of it is its index's (`place-shape`), as before
    const fn = "PROGRAM P\nVAR arr : ARRAY[0..1] OF INT := [4, 5]; r : INT; END_VAR\nr := G(arr);\nEND_PROGRAM\nFUNCTION G : INT\nVAR_INPUT a : ARRAY[*] OF INT; END_VAR\nG := a[1];\nEND_FUNCTION\n"
    expect(lowerSource(fn, "P").diagnostics.map((d) => d.code)).not.toContain("slot-array")
  })

  // frontend-conformance 2.3b review: three type-expression fixtures lowering missed — one emitted Rust that does not
  // build, two that CODESYS builds and runs were refused
  test("a reversed ARRAY is refused by name — it emitted a negative length the Rust compiler rejected", () => {
    // `decl_array_reversed_bounds`: both vendors refuse it ("Lower border must be lower than upper border")
    const codes = (decl: string) => lowerSource(`PROGRAM P\nVAR ${decl} out : INT; END_VAR\nout := 1;\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
    expect(codes("a : ARRAY[5..1] OF INT;")).toEqual(["array-reversed"])
    expect(codes("a : ARRAY[0..1] OF ARRAY[4..2] OF INT;")).toEqual(["array-reversed"])
    expect(codes("a : ARRAY[-3..-1] OF INT;")).toEqual([])
  })

  test("an EMPTY array dimension (lower = upper + 1) is lowered — both vendors build it; one below that is refused", () => {
    // lsp-quick-fixes review of step 1 (2026-10-12): `ARRAY[1..0]` builds clean on both vendors and runs
    // (`qf_c0228_bound_literal_empty`, record:exec), `ARRAY[2..0]` is refused (`qf_c0228_bound_literal_two_below`)
    const codes = (decl: string) => lowerSource(`PROGRAM P\nVAR ${decl} out : INT; END_VAR\nout := 1;\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
    expect(codes("a : ARRAY[1..0] OF INT;")).toEqual([])
    expect(codes("a : ARRAY[0..1] OF ARRAY[3..2] OF INT;")).toEqual([])
    expect(codes("a : ARRAY[2..0] OF INT;")).toEqual(["array-reversed"])
  })

  test("an implicit enum's value is a constant when its variable is an ARRAY OF the enum", () => {
    // `decl_implicit_enum_in_array` (`a[1] := ia_b`, CODESYS runs `out` as 1): `ia_b` was `place-not-local`
    const { pou, diagnostics } = lowerSource("PROGRAM P\nVAR a : ARRAY[0..1] OF (ia_a, ia_b); out : INT; END_VAR\na[1] := ia_b;\nout := a[1];\nEND_PROGRAM\n", "P")
    expect(diagnostics).toEqual([])
    expect(pou).toBeDefined()
  })

  test("a POINTER TO POINTER takes ADR of a pointer and is written through `pp^^`", () => {
    // `decl_pointer_to_pointer_deref` (CODESYS runs x as 5): the two pointers' storage was compared as if only an
    // elementary, struct or array could be a pointer's target — "the address of a variable of another type"
    const { pou, diagnostics } = lowerSource(
      "PROGRAM P\nVAR x : INT; p : POINTER TO INT; pp : POINTER TO POINTER TO INT; out : INT; END_VAR\np := ADR(x);\npp := ADR(p);\npp^^ := 5;\nout := x;\nEND_PROGRAM\n",
      "P",
    )
    expect(diagnostics).toEqual([])
    expect(pou).toBeDefined()
  })

  // Transpiler review 2026-09-15. Why missed: every pointer test took the address of a whole variable or of an element with
  // the index LAST, and every one used the pointer's own target type — no test named a place with an index inside its
  // path, or a byte-sized pointer over a wider variable. Both were REFUSED while a pointer was a tag: its target was a
  // place replayed at every dereference, which would read `i` again then. MODEL 3 (design.md §3.3 step 4d) makes the
  // pointer the ADDRESS, taken once where `ADR` is — so `p := ADR(arr[i].x); i := 3` still reads arr[1].x, and a POINTER
  // TO BYTE over an INT reads its bytes, as CODESYS does (`pointer_byte_walk_struct_padding`).
  test("an address is taken where ADR is — an index before its last step read then — and any pointer type reads its bytes", () => {
    const decls = "TYPE T_S : STRUCT x : INT; END_STRUCT END_TYPE\nPROGRAM P\nVAR arr : ARRAY[1..3] OF T_S; grid : ARRAY[1..3] OF ARRAY[1..3] OF INT; i : INT := 1; j : INT := 2; n : INT; p : POINTER TO INT; pb : POINTER TO BYTE; rv : REFERENCE TO INT; b : BYTE; END_VAR\n"
    const lowered = (body: string) => lowerSource(`${decls}${body}\nEND_PROGRAM\n`, "P")
    const code = (body: string) => lowered(body).diagnostics.map((d) => d.code)
    const after = (body: string, name: string) => {
      const { pou, diagnostics } = lowered(body)
      expect(diagnostics).toEqual([])
      const r = run(pou!)
      r.scan()
      return r.get(name)
    }
    expect(after("arr[1].x := 11; arr[3].x := 33; p := ADR(arr[i].x); i := 3; n := p^;", "n")).toBe(11n)
    expect(after("grid[1][2] := 12; grid[3][2] := 32; p := ADR(grid[i][j]); i := 3; n := p^;", "n")).toBe(12n)
    expect(after("arr[1].x := 11; rv REF= arr[i].x; i := 3; n := rv;", "n")).toBe(11n)
    expect(after("n := 16#0102; pb := ADR(n); b := pb^;", "b")).toBe(2n)
    // and as before: a constant index before the last step, and a runtime index as the last step
    expect(code("p := ADR(arr[2].x); n := p^;")).toEqual([])
    expect(code("p := ADR(grid[2][i]); n := p^;")).toEqual([])
  })

  // Transpiler review 2026-09-15. Why missed: every routine test called a routine that did not reach itself, so the
  // lower-once cache was always filled before a second lookup; nothing tested the lookup DURING lowering.
  test("a FUNCTION or METHOD that calls itself is refused, not lowered without end", () => {
    const code = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
    // the bare self-name is the result variable, refused by both vendors (`call-recursive`); `THIS^.M()` is a call no
    // recording refuses (`call-recursion`, transpile-refusal-classification 2.x)
    expect(code("PROGRAM P\nVAR n : INT; END_VAR\nn := F_Down(3);\nEND_PROGRAM\nFUNCTION F_Down : INT\nVAR_INPUT k : INT; END_VAR\nIF k > 0 THEN F_Down := F_Down(k - 1); END_IF\nEND_FUNCTION\n")).toContain("call-recursive")
    expect(code("PROGRAM P\nVAR inst : FB_R; END_VAR\ninst.M();\nEND_PROGRAM\nFUNCTION_BLOCK FB_R\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD M\nn := n + 1;\nIF n < 3 THEN THIS^.M(); END_IF\nEND_METHOD\n")).toContain("call-recursion")
  })

  // Transpiler review 2026-09-15. Why missed: the globals tests read and wrote GVL variables and called a PROGRAM; none
  // declared an FB INSTANCE in a GVL, and the rustc crate check is the only thing that sees the double borrow.
  test("an FB instance declared in a GVL is refused as a call target — `g.inst.call(g)` borrows g twice", () => {
    const code = (body: string) =>
      lowerSource(`PROGRAM P\n${body}\nEND_PROGRAM\nVAR_GLOBAL\n  gInst : FB_G;\nEND_VAR\nFUNCTION_BLOCK FB_G\nVAR n : INT; END_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\nMETHOD M\nn := 0;\nEND_METHOD\n`, "P").diagnostics.map((d) => d.code)
    expect(code("gInst();")).toEqual(["call-global-instance"])
    expect(code("gInst.M();")).toEqual(["call-global-instance"])
  })

  // Transpiler review 2026-09-15. Why missed: the in-out tests bound ONE VAR_IN_OUT per call, and the alias test compared
  // it with the called instance only — never two parameters on one variable, never a METHOD reached through THIS^.
  test("a VAR_IN_OUT is refused when the call already holds its variable — through another in-out, or through THIS^", () => {
    const code = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
    const two = "FUNCTION_BLOCK FB_Two\nVAR_IN_OUT a : INT; b : INT; END_VAR\na := b;\nEND_FUNCTION_BLOCK\n"
    expect(code(`PROGRAM P\nVAR pair : FB_Two; n : INT; m : INT; END_VAR\npair(a := n, b := n);\nEND_PROGRAM\n${two}`)).toEqual(["call-inout-alias"])
    expect(code(`PROGRAM P\nVAR pair : FB_Two; n : INT; m : INT; END_VAR\npair(a := n, b := m);\nEND_PROGRAM\n${two}`)).toEqual([])
    // `THIS^.Store(dest := n)` lends the instance's own field to its own METHOD. It was refused only because two `&mut` of
    // one instance cannot be printed; it lowers now — as a copy written back, or, when Store also reaches n by NAME (where
    // a copy would be stale), by substituting the path into the instance (conformance `callshape_own_field_inout_read_by_name`).
    const self = (store: string) =>
      `FUNCTION_BLOCK FB_S\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Store\nVAR_IN_OUT dest : INT; END_VAR\n${store}\nEND_METHOD\nMETHOD Outer\nTHIS^.Store(dest := n);\nEND_METHOD\n`
    const through = run(ir(`PROGRAM P\nVAR sv : FB_S; END_VAR\nsv.Outer();\nEND_PROGRAM\n${self("dest := 1;")}`, "P"))
    through.scan()
    expect(through.get("sv.n")).toEqual(1n)
    const byName = run(ir(`PROGRAM P\nVAR sv : FB_S; END_VAR\nsv.Outer();\nEND_PROGRAM\n${self("dest := n + 1;")}`, "P"))
    byName.scan()
    expect(byName.get("sv.n")).toEqual(1n)
  })

  // Transpiler review 2026-09-15. Why missed: every call test passed constants or variables as arguments; the crate check
  // never held a call inside a call, where the printed Rust borrows `g` (or the one instance) twice.
  // It was refused (`call-nested`) while the order a call's arguments run in was unmeasured. Recorded since — as written
  // (conformance `callshape_argument_order`) — each argument holding a call is taken first, in a `let`, so the same
  // instance is never borrowed twice in one argument list.
  test("a routine called inside another call's arguments runs first, where it is written", () => {
    const fb = "FUNCTION_BLOCK FB_B\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT k : INT; END_VAR\nn := n + k;\nM := n;\nEND_METHOD\nFUNCTION F : INT\nVAR_INPUT k : INT; END_VAR\nF := k;\nEND_FUNCTION\n"
    const runner = run(ir(`PROGRAM P\nVAR a : FB_B; nested : INT; twice : INT; side : INT; END_VAR\nnested := a.M(k := a.M(k := 1));\ntwice := F(k := F(k := 1));\nside := a.M(k := 1) + F(k := 2);\nEND_PROGRAM\n${fb}`, "P"))
    runner.scan()
    // the inner M adds 1 and returns 1; the outer adds that and returns 2; then M adds 1 more (3) beside F's 2
    expect(["nested", "twice", "side", "a.n"].map((v) => runner.get(v))).toEqual([2n, 1n, 5n, 3n])
  })

  // Transpiler review 2026-09-15. Why missed: the SIZEOF fixtures are a plain struct and an FB of plain variables; the
  // layout of a derived type or of an FB's VAR_IN_OUT was never recorded, and nothing asked for it.
  test("SIZEOF of a derived type or of an FB with VAR_IN_OUT is refused — neither layout is measured", () => {
    const types = "TYPE T_Base : STRUCT a : INT; END_STRUCT END_TYPE\nTYPE T_Derived EXTENDS T_Base : STRUCT b : INT; END_STRUCT END_TYPE\nFUNCTION_BLOCK FB_Io\nVAR_IN_OUT v : INT; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Base\nVAR a : INT; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Derived EXTENDS FB_Base\nVAR b : INT; END_VAR\nEND_FUNCTION_BLOCK\n"
    const code = (arg: string) => lowerSource(`PROGRAM P\nVAR n : ULINT; END_VAR\nn := SIZEOF(${arg});\nEND_PROGRAM\n${types}`, "P").diagnostics.map((d) => d.code)
    expect(code("T_Derived")).toEqual(["sizeof-unmeasured"])
    expect(code("FB_Io")).toEqual(["sizeof-unmeasured"])
    expect(code("FB_Derived")).toEqual(["sizeof-unmeasured"])
    expect(code("T_Base")).toEqual([])
  })

  // Transpiler review 2026-09-15. Why missed: the enum fixtures number values and store them; none declares the TYPE's
  // own default (`:= B` after the list), which no code read.
  test("an enum type with a default value starts every variable AT that member", () => {
    // Was "refused — a variable of it would start at 0", which was the honest state while nothing measured it.
    // `type_enum_type_level_default` asked CODESYS on 2026-09-18: `TYPE E : (Idle := 0, Busy := 1) := Busy` starts at
    // Busy, recorded 1. So the refusal is gone and the rule is the vendor's.
    const r = lowerSource("TYPE E : (Idle := 0, Busy := 1) := Busy;\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\te : E;\n\tx : DINT;\nEND_VAR\nx := e;\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("x")).toBe(1n)
  })

  // Phase 3½: every METHOD call resolves against the instance's own type — which holds only while an instance is never
  // seen through its base type. A base-typed VAR_IN_OUT bound to a derived instance would dispatch on the parameter's
  // type; that is not modelled, so it is refused, as is a SUPER^ with no base to name.
  test("a derived instance bound to a base-typed VAR_IN_OUT, and SUPER^ outside a derived FB, are refused", () => {
    const code = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
    const fbs =
      "FUNCTION_BLOCK FB_B\nVAR n : INT; END_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_D EXTENDS FB_B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Take\nVAR_IN_OUT b : FB_B; END_VAR\nVAR seen : INT; END_VAR\nseen := b.n;\nEND_FUNCTION_BLOCK\n"
    expect(code(`PROGRAM P\nVAR d : FB_D; take : FB_Take; END_VAR\ntake(b := d);\nEND_PROGRAM\n${fbs}`)).toEqual(["call-inout-derived"])
    expect(code(`PROGRAM P\nVAR b : FB_B; take : FB_Take; END_VAR\ntake(b := b);\nEND_PROGRAM\n${fbs}`)).toEqual([])
    const plain = "FUNCTION_BLOCK FB_Plain\nVAR n : INT; END_VAR\nSUPER^();\nEND_FUNCTION_BLOCK\n"
    expect(code(`PROGRAM P\nVAR x : FB_Plain; END_VAR\nx();\nEND_PROGRAM\n${plain}`)).toEqual(["call-super"])
  })

  // A METHOD's VAR_INST becomes a field when the method lowers — so a SIZEOF taken before that call and one after would
  // differ, and where CODESYS lays the variable out is not measured.
  test("SIZEOF of an FB whose METHOD has VAR_INST is refused", () => {
    const { diagnostics } = lowerSource(
      "PROGRAM P\nVAR n : ULINT; END_VAR\nn := SIZEOF(FB_K);\nEND_PROGRAM\nFUNCTION_BLOCK FB_K\nVAR x : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Tick\nVAR_INST kept : INT; END_VAR\nkept := kept + 1;\nEND_METHOD\n",
      "P",
    )
    expect(diagnostics.map((d) => d.code)).toEqual(["sizeof-unmeasured"])
  })

  // In Rust a PROGRAM runs moved out of `Programs` and back, so a program whose run reaches its own instance — here
  // through an FB it calls — would read a stand-in there. Refused, rather than read wrong.
  test("a PROGRAM whose run reaches its own instance through an FB it calls is refused", () => {
    const { diagnostics } = lowerSource(
      "PROGRAM P\nPRG_Self();\nEND_PROGRAM\nPROGRAM PRG_Self\nVAR peek : FB_Peek; runs : INT; END_VAR\nruns := runs + 1;\npeek();\nEND_PROGRAM\nFUNCTION_BLOCK FB_Peek\nVAR seen : INT; END_VAR\nseen := PRG_Self.runs;\nEND_FUNCTION_BLOCK\n",
      "P",
    )
    expect(diagnostics.map((d) => d.code)).toContain("call-program-reentrant")
  })

  // The init step reaches instances through the frame; one inside an array (or a global, or a routine's local) is where
  // the walk does not follow and its timing is unmeasured — refused, never silently left uninitialised.
  test("a call_after_global_init_slot FB inside an array is refused", () => {
    const { diagnostics } = lowerSource(
      "PROGRAM P\nVAR many : ARRAY[1..2] OF FB_I; END_VAR\nmany[1]();\nEND_PROGRAM\nFUNCTION_BLOCK FB_I\nVAR inits : INT; END_VAR\nEND_FUNCTION_BLOCK\n{attribute 'call_after_global_init_slot' := '50000'}\nMETHOD AfterGlobalInit\ninits := inits + 1;\nEND_METHOD\n",
      "P",
    )
    expect(diagnostics.map((d) => d.code)).toEqual(["attr-init-unreached"])
  })

  // An FB lowered on its own has no caller, so the harness is one: each in-out gets a variable beside the instance, bound
  // to every scan's call. The oracle for it is the CALLED shape, which is recorded — so the root must give the same values.
  test("an FB with VAR_IN_OUT lowered on its own runs on harness-owned in-outs, as a caller's binding does", () => {
    const fb = "FUNCTION_BLOCK FB_Io\nVAR_IN_OUT v : INT; END_VAR\nVAR n : INT; END_VAR\nn := n + 1;\nv := v + n;\nEND_FUNCTION_BLOCK\n"
    const root = run(ir(fb, "FB_Io"))
    const called = run(ir(`PROGRAM P\nVAR v : INT; inst : FB_Io; END_VAR\ninst(v := v);\nEND_PROGRAM\n${fb}`, "P"))
    for (let scan = 0; scan < 3; scan++) {
      root.scan()
      called.scan()
      expect(root.get("v")).toEqual(called.get("v"))
    }
    expect(root.get("v")).toEqual(6n)
    // an ARRAY[*] stays refused: only a caller's array gives it a size
    const open = lowerSource("FUNCTION_BLOCK FB_Open\nVAR_IN_OUT many : ARRAY[*] OF INT; END_VAR\nmany[0] := 1;\nEND_FUNCTION_BLOCK\n", "FB_Open")
    expect(open.diagnostics.map((d) => d.code)).toEqual(["root-inout"])
  })

  test("an initializer that does not fold RUNS, in declaration order — and is never silently dropped", () => {
    // It was dropped once: the slot started at its default with no diagnostic — which is how every STRING slot
    // lost its initial value (constEval folds no strings) while each string case still "lowered". It was then
    // REFUSED, which this test asserted.
    //
    // Both were wrong about the same thing. A CODESYS initializer is an initialisation SEQUENCE, measured on SP21
    // (`declarations/init-sequence.ts`): it runs ONCE before the first scan, after the globals, in declaration
    // order, and may be any expression. So `other : INT := iCount` with `iCount` declared BEFORE it is ordinary —
    // it reads `iCount`'s default, because the body has not run yet.
    const ran = lowerSource(wrap("iCount := 1;", "iCount : INT;\n  other : INT := iCount;"))
    expect(ran.diagnostics).toEqual([])
    const p = run(ran.pou!)
    p.scan()
    expect(p.get("other")).toBe(0n) // the init step read the DEFAULT, not the 1 the body writes
    expect(p.get("iCount")).toBe(1n)

    // Reading a declaration that comes LATER reads it before its own initializer has run: `i : INT := ABS(other); other :
    // INT := -7;` is 0 on SP21 (`cfold_non_constant_argument`). It was refused while a constant was the slot's starting
    // value rather than a statement (it would have answered 7); the init step's position rule makes the later constant a
    // statement after `i`'s (transpile-restructure 5.7, `init/position.ts`).
    const later = lowerSource(wrap(";", "i : INT := ABS(other);\n  other : INT := -7;"))
    expect(later.diagnostics).toEqual([])
    const q = run(later.pou!)
    q.scan()
    expect([q.get("i"), q.get("other")]).toEqual([0n, -7n])
  })
})

/**
 * LOWERING IS TOTAL FOR SHAPES THE CORPUS DOES NOT CONTAIN.
 *
 * `src/transpile/index.ts` states the contract: invalid input ends in a `LowerDiagnostic`, never a throw and never
 * an invented meaning. `test/corpus/corpus-lowering.test.ts` gates that over 29k files of real customer
 * code — which is evidence, not proof. Real engineers do not write a year 300000 and do not step a pointer over a
 * struct with no fields; a transpiler other people depend on meets both anyway. These live here, beside the code
 * that answers them, rather than in the corpus gate that cannot reach them.
 *
 * Each asserts BOTH halves of the contract — that it does not throw, AND that it does not quietly mean something
 * else. The second half is not decoration: the first fix for the date literal returned `undefined`, which fell
 * through to the string branch (a date literal's AST value IS the string "300000-01-01") and turned
 * `D#300000-01-01` into a STRING constant with no diagnostic at all. Trading a loud crash for a silent wrong
 * answer is a worse bug than the one being fixed, and only an assertion about the DIAGNOSTIC catches it.
 *
 * Found by review 2026-09-17.
 */
describe("the shapes the corpus cannot reach", () => {
  const lowered = (pou: string, src: string): { codes: string[]; threw: string | null } => {
    try {
      return { codes: lowerSource(src, pou, []).diagnostics.map((d) => d.code), threw: null }
    } catch (error) {
      return { codes: [], threw: (error as Error).message }
    }
  }

  test("a date literal past JS Date's range is reported, not thrown, and is not silently a string", () => {
    // `Date.UTC` answers NaN past about year 275760 and `BigInt(NaN)` throws
    for (const src of [
      "PROGRAM P\nVAR\n\td : DATE;\nEND_VAR\nd := D#300000-01-01;\nEND_PROGRAM\n",
      "PROGRAM P\nVAR\n\td : DATE := D#300000-01-01;\nEND_VAR\nEND_PROGRAM\n", // the initializer path is a second site
    ]) {
      const r = lowered("P", src)
      expect(r.threw).toBeNull()
      expect(r.codes).toEqual(["bad-literal"])
    }
  })

  test("a pointer stepped over an element occupying no bytes steps bytes, never divides by the element", () => {
    // `byteSize` legitimately answers 0 for a struct with no laid-out fields; `% 0n` threw on BigInt while a step was
    // counted in elements. Model 3 steps a pointer by BYTES (design.md §3.3 step 4d): nothing is divided by.
    const r = lowered(
      "Q",
      "TYPE EMPTY : STRUCT END_STRUCT END_TYPE\n\nPROGRAM Q\nVAR\n\tarr : ARRAY[0..2] OF EMPTY;\n" +
        "\tp : POINTER TO EMPTY;\n\tq : POINTER TO EMPTY;\nEND_VAR\np := ADR(arr[0]);\nq := p + 4;\nEND_PROGRAM\n",
    )
    expect(r.threw).toBeNull()
    expect(r.codes).toEqual([])
  })

  test("the ordinary temporal literals still lower, so the refusal did not widen", () => {
    expect(lowered("R", "PROGRAM R\nVAR\n\td : DATE := D#2026-09-17;\nEND_VAR\nd := D#2000-01-01;\nEND_PROGRAM\n")).toEqual({
      codes: [],
      threw: null,
    })
    expect(lowered("T", "PROGRAM T\nVAR\n\tt : TIME := T#1S;\nEND_VAR\nt := T#2M3S;\nEND_PROGRAM\n")).toEqual({
      codes: [],
      threw: null,
    })
  })
})

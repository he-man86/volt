/**
 * Jumps and labels (openspec lower-jumps-and-labels): a body whose top level holds a label a JMP names lowers to one
 * `labeled` node, and the interpreter runs it as CODESYS records (conformance `tr_jmp_*`, `nt_*jump*`, 2026-10-31).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { ir, wrap } from "../../../../test/support/transpile.js"

describe("lower — JMP and labels", () => {
  test("a forward jump passes the statements before its label (`tr_jmp_forward_skip`: a 1, b 0, c 3)", () => {
    const r = run(ir(wrap("a := 1;\nJMP skip;\nb := 2;\nskip:\nc := 3;", "a : INT; b : INT; c : INT;")))
    r.scan()
    expect([r.get("a"), r.get("b"), r.get("c")]).toEqual([1n, 0n, 3n])
  })

  test("a backward jump is a loop a counter ends (`tr_jmp_backward_counter_loop`: after 2 scans n 6, total 21)", () => {
    const r = run(ir(wrap("again:\nn := n + 1;\ntotal := total + n;\nIF n < 5 THEN\n\tJMP again;\nEND_IF", "n : INT; total : INT;")))
    r.scan()
    expect([r.get("n"), r.get("total")]).toEqual([5n, 15n])
    r.scan()
    expect([r.get("n"), r.get("total")]).toEqual([6n, 21n])
  })

  test("a jump leaves the loop it stands in for a later label (`tr_jmp_out_of_loop_to_later_label`)", () => {
    const body = "FOR i := 1 TO 10 DO\n\tIF i = 3 THEN\n\t\tJMP done;\n\tEND_IF\n\tk := k + 1;\nEND_FOR\nz := 100;\ndone:\nm := i;"
    const r = run(ir(wrap(body, "i : INT; k : INT; m : INT; z : INT;")))
    r.scan()
    expect([r.get("i"), r.get("k"), r.get("m"), r.get("z")]).toEqual([3n, 2n, 3n, 0n])
  })

  test("RETURN leaves a labeled body (`tr_return_midway`: a 1, b 0, c 0)", () => {
    const r = run(ir(wrap("a := 1;\nJMP over;\nb := 9;\nover:\nIF stop THEN\n\tRETURN;\nEND_IF\nc := 3;", "stop : BOOL := TRUE; a : INT; b : INT; c : INT;")))
    r.scan()
    expect([r.get("a"), r.get("b"), r.get("c")]).toEqual([1n, 0n, 0n])
  })

  test("a jump to the label at the body's end leaves the body (`stmt_label_at_end`)", () => {
    const r = run(ir(wrap("again:\nn := n + 1;\nIF n > 2 THEN\n\tJMP fin;\nEND_IF\nJMP again;\nfin:", "n : INT;")))
    r.scan()
    expect(r.get("n")).toBe(3n)
  })

  test("a label no JMP names is no statement; a body with none is no labeled node", () => {
    const pou = ir(wrap("first:\na := 1;", "a : INT;"))
    expect(pou.body.map((s) => s.kind)).toEqual(["assign"])
  })

  test("a JMP to a label inside a block is refused by name", () => {
    const d = lowerSource(wrap("JMP inside;\nIF a = 0 THEN\ninside:\n\ta := 1;\nEND_IF", "a : INT;"), "P").diagnostics
    expect(d.map((x) => x.code)).toEqual(["stmt-jmp"])
  })

  test("a network body jumps across its networks (`nt_jmp_over_network`, `nt_coil_written_before_jump`, `nt_return_on_value`)", () => {
    const net = (body: string, vars: string) => `PROGRAM P\nVAR\n${vars}\nEND_VAR\n%LANGUAGE LD\n${body}\nEND_PROGRAM\n`
    const over = run(ir(net("%NETWORK\nJMP.skip := a;\n%NETWORK\nx := TRUE;\n%NETWORK\nskip:\ny := TRUE;\n%NETWORK\nJMP.skip2 := b;\n%NETWORK\nz := TRUE;\n%NETWORK\nskip2:\nw := TRUE;", "a : BOOL := TRUE; b : BOOL; x : BOOL; y : BOOL; z : BOOL; w : BOOL;"), "P"))
    over.scan()
    expect(["x", "y", "z", "w"].map((v) => over.get(v))).toEqual([false, true, true, true])
    const coil = run(ir(net("%NETWORK\ny := JMP.skip := a;\n%NETWORK\nx := TRUE;\n%NETWORK\nskip:\nz := TRUE;", "a : BOOL := TRUE; y : BOOL; x : BOOL; z : BOOL;"), "P"))
    coil.scan()
    expect(["y", "x", "z"].map((v) => coil.get(v))).toEqual([true, false, true])
    const ret = run(ir(net("%NETWORK\ny := TRUE;\n%NETWORK\nRETURN := a;\n%NETWORK\nx := TRUE;", "a : BOOL := TRUE; y : BOOL; x : BOOL;"), "P"))
    ret.scan()
    expect(["y", "x"].map((v) => ret.get(v))).toEqual([true, false])
  })
})

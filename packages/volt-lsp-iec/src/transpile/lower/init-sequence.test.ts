/**
 * The initialisation sequence — and the four ways it was WRONG when it first landed, each reproduced here.
 *
 * The semantics are measured on CODESYS SP21 (conformance `declarations/init-sequence.ts`,
 * `declarations/constant-folding.ts`): an initializer runs ONCE before the first scan, after the globals, in
 * strict declaration order, and may be any expression. What follows is the part a review found: every one of
 * these lowered CLEANLY and gave a wrong answer, which is the failure mode `init-not-constant` exists to prevent.
 */
import { test, expect } from "bun:test"
import { lowerSource } from "./index.js"
import { run } from "../interp/index.js"

const FB_I =
  "FUNCTION_BLOCK FB_I\nVAR\n\tstarted : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
  "METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\nstarted := 5;\nEND_METHOD\n\n"
const F_INC = "FUNCTION F_Inc : INT\nVAR_INPUT\n\tv : INT;\nEND_VAR\nF_Inc := v + 1;\nEND_FUNCTION\n\n"

const lower = (pre: string, decls: string, body = ";") =>
  lowerSource(`${pre}PROGRAM PLC_PRG\nVAR\n\t${decls}\nEND_VAR\n${body}\nEND_PROGRAM\n`, "PLC_PRG")
const codes = (pre: string, decls: string, body = ";") => lower(pre, decls, body).diagnostics.map((d) => d.code)

test("a STRUCT does not get the DECLARING POU's init sequence as a routine", () => {
  // `lw.bodies` holds FBs and PROGRAMs, never a struct, so a `?? declaring` fallback handed a struct the enclosing
  // POU's lowering and built `STRUCT.__INIT` out of ITS pending inits — whose slot indices index the POU's frame.
  // It wrote into an unrelated struct field, ran the statement twice, and threw where the index was out of range.
  const r = lower(`TYPE T_Hold :\nSTRUCT\n\ta : DWORD;\n\tinner : FB_I;\nEND_STRUCT\nEND_TYPE\n\n${FB_I}`, "p : POINTER TO INT := ADR(x);\n\tx : INT := 3;\n\th : T_Hold;")
  expect(r.diagnostics).toEqual([])
  expect(r.pou!.routines.map((x) => x.key)).not.toContain("T_HOLD.__INIT")
  const p = run(r.pou!)
  p.scan()
  expect(p.get("h.a")).toBe(0n) // `p`'s address went into `p`, not into an unrelated field
})

test("a DERIVED function block runs its base's field initializers too", () => {
  // The base's `pendingInits` live on the BASE's lowering, and `inherit` copies its slots but re-runs nothing — so
  // `d.pb` stayed 0 with no diagnostic. The base's statements are valid on a derived instance because `inherit`
  // pushes the base's fields FIRST, at the indices they have in the base's own frame.
  const src =
    "FUNCTION_BLOCK FB_Base\nVAR\n\tm : INT := 7;\n\tpb : POINTER TO INT := ADR(m);\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
    "FUNCTION_BLOCK FB_Derived EXTENDS FB_Base\nVAR\n\tq : INT;\nEND_VAR\nq := 1;\nEND_FUNCTION_BLOCK\n\n"
  const r = lower(src, "b : FB_Base;\n\td : FB_Derived;", "d();")
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  expect(p.get("b.pb")).not.toBe(0n)
  expect(p.get("d.pb")).not.toBe(0n)
  // and each instance's pointer follows its OWN field
  p.set("d.m", 42n)
  p.set("b.m", 9n)
  expect(p.get("d.m")).toBe(42n)
  expect(p.get("b.m")).toBe(9n)
})

test("the guards see a read wherever it is — a call's argument, an index, a struct's depth", () => {
  // Each of these lowered clean and answered as though the later declaration were already initialized. The walk
  // handled `load`/`convert`/`unary`/`binary`/`builtin` and stopped at everything else.
  expect(codes(F_INC, "i : INT := F_Inc(other);\n\tother : INT := -7;")).toEqual(["init-reads-later"])
  expect(codes("", "arr : ARRAY[0..3] OF INT := [10,11,12,13];\n\ti : INT := arr[k];\n\tk : INT := 2;")).toEqual(["init-reads-later"])
  expect(codes(F_INC + FB_I, "holder : FB_I;\n\tseen : INT := F_Inc(holder.started);")).toEqual(["init-reads-instance"])
  // an instance reached through a STRUCT field is still an instance
  expect(codes(`TYPE T_H :\nSTRUCT\n\tinner : FB_I;\nEND_STRUCT\nEND_TYPE\n\n${FB_I}`, "holder : T_H;\n\tseen : INT := holder.inner.started;")).toEqual([
    "init-reads-instance",
  ])
})

test("and the ordinary shapes still lower", () => {
  expect(codes(F_INC, "other : INT := -7;\n\ti : INT := F_Inc(other);")).toEqual([])
  expect(codes("", "x : INT := 5;\n\tp : POINTER TO INT := ADR(x);")).toEqual([])
  expect(codes(`TYPE T_P :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n\n`, "cfg : T_P := (n := 9);\n\tcopied : INT := cfg.n;")).toEqual([])
})

/**
 * The initialisation sequence — and the four ways it was WRONG when it first landed, each reproduced here.
 *
 * The semantics are measured on CODESYS SP21 (conformance `declarations/init-sequence.ts`,
 * `declarations/constant-folding.ts`): an initializer runs ONCE before the first scan, after the globals, in
 * strict declaration order, and may be any expression. What follows is the part a review found: every one of
 * these lowered CLEANLY and gave a wrong answer, which is the failure mode `init-not-constant` exists to prevent.
 */
import { test, expect } from "bun:test"
import { lowerSource } from "../index.js"
import { run } from "../../interp/index.js"

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
  // handled `load`/`convert`/`unary`/`binary`/`builtin` and stopped at everything else. A later SCALAR or ARRAY now reads
  // its type's zero — its constant is a statement after the read (the position rule, transpile-restructure 5.7;
  // `cfold_non_constant_argument`: 0) — wherever the read is; a later INSTANCE's or struct's fields, folded per type, stay
  // refused, wherever the read is too.
  const scalar = lower(F_INC, "i : INT := F_Inc(other);\n\tother : INT := -7;\n\tarr : ARRAY[0..3] OF INT := [10,11,12,13];\n\tj : INT := arr[k];\n\tk : INT := 2;")
  expect(scalar.diagnostics).toEqual([])
  const s = run(scalar.pou!)
  s.scan()
  expect(["i", "other", "j", "k"].map((v) => s.get(v))).toEqual([1n, -7n, 10n, 2n])
  const T_P = "TYPE T_P :\nSTRUCT\n\tn : INT := 4;\nEND_STRUCT\nEND_TYPE\n\n"
  expect(codes(F_INC + T_P, "i : INT := F_Inc(cfg.n);\n\tcfg : T_P;")).toEqual(["init-reads-later"])
  expect(codes(F_INC + FB_I, "i : INT := F_Inc(later.started);\n\tlater : FB_I;")).toEqual(["init-reads-later"])
  // gate 5c: through a POINTER an earlier initializer aimed at the later struct — it answered the type-folded 4
  expect(codes(T_P, "p : POINTER TO T_P := ADR(cfg);\n\ti : INT := p^.n;\n\tcfg : T_P;")).toEqual(["init-reads-later"])
  // An instance's field is read AFTER its FB_Init when the instance is declared first — the init step interleaves them
  // by declaration (`initseq_after_fb_init`: 5; transpile-review 23) — so only an instance whose STRUCTURED initializer
  // is applied after every FB_Init is still refused, wherever the read is
  expect(codes(F_INC + FB_I, "holder : FB_I := (started := 9);\n\tseen : INT := F_Inc(holder.started);")).toEqual(["init-reads-instance"])
  const read = lower(F_INC + FB_I, "holder : FB_I;\n\tseen : INT := F_Inc(holder.started);")
  expect(read.diagnostics).toEqual([])
  const p = run(read.pou!)
  p.scan()
  expect(p.get("seen")).toBe(6n)
  // an instance reached through a STRUCT field is still an instance
  const deep = lower(`TYPE T_H :\nSTRUCT\n\tinner : FB_I;\nEND_STRUCT\nEND_TYPE\n\n${FB_I}`, "holder : T_H;\n\tseen : INT := holder.inner.started;")
  expect(deep.diagnostics).toEqual([])
  const q = run(deep.pou!)
  q.scan()
  expect(q.get("seen")).toBe(5n)
})

// transpile-restructure 5.8 (design.md §3.4 step 5d): `insideInstance` refused `holder.started` and let `holder.Get()`
// through — a METHOD run on the instance reads it as much as a field does, and what either sees after the structured
// initializer is unrecorded. The instance ITSELF (a place stopping ON it, reached through struct fields too) is now a read
// of it, as its fields are; `ADR(holder)` stays no read. Why missed: the test above read fields only.
test("an instance declared with a structured initializer: a method run on it or the instance itself is a read too", () => {
  const GET = "METHOD Get : INT\nGet := started;\nEND_METHOD\n\n"
  const FB_G = FB_I + GET
  expect(codes(F_INC + FB_G, "holder : FB_I := (started := 9);\n\tseen : INT := F_Inc(holder.Get());")).toEqual(["init-reads-instance"])
  // reached through a STRUCT field (an FB without FB_Init: an enclosing structured initializer on one with FB_Init is
  // `fb-init-order`)
  const FB_N = "FUNCTION_BLOCK FB_N\nVAR\n\tstarted : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" + GET
  const T_H = "TYPE T_H :\nSTRUCT\n\tinner : FB_N;\nEND_STRUCT\nEND_TYPE\n\n"
  expect(codes(F_INC + T_H + FB_N, "holder : T_H := (inner := (started := 9));\n\tseen : INT := F_Inc(holder.inner.Get());")).toEqual(["init-reads-instance"])
  // ...as its field is
  expect(codes(F_INC + T_H + FB_N, "holder : T_H := (inner := (started := 9));\n\tseen : INT := F_Inc(holder.inner.started);")).toEqual(["init-reads-instance"])
  // without a structured initializer it still lowers (the instance's FB_Init ran at its position: 5)
  const read = lower(F_INC + FB_G, "holder : FB_I;\n\tseen : INT := F_Inc(holder.Get());")
  expect(read.diagnostics).toEqual([])
  const p = run(read.pou!)
  p.scan()
  expect(p.get("seen")).toBe(6n)
  // an address is no read
  expect(codes(FB_G, "holder : FB_I := (started := 9);\n\tp : POINTER TO FB_I := ADR(holder);")).toEqual([])
  // gate 5d review: a place stopping on the STRUCT holding the instance copies its state as much (it gave 9)
  expect(codes(T_H + FB_N, "holder : T_H := (inner := (started := 9));\n\tcopy : T_H := holder;")).toEqual(["init-reads-instance"])
})

// gate 5d review: an instance passed as an INTERFACE lowers to a tag, its place lent to the callee only after the guards
// ran (`interfaces/lend.ts`), so the read walk never met it — a later instance with a structured initializer answered 3
// (its initializer applied before i's, declared earlier). Why missed: 5.9's walk test built its lent place by hand.
test("an instance handed to a call as an interface reaches the guards", () => {
  const I_X = "INTERFACE I_X\nMETHOD Get : INT\nEND_METHOD\nEND_INTERFACE\n\n"
  const FB_X = "FUNCTION_BLOCK FB_X IMPLEMENTS I_X\nVAR\n\tn : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Get : INT\nGet := n;\nEND_METHOD\n\n"
  const F_GET = "FUNCTION F_Get : INT\nVAR_INPUT\n\titf : I_X;\nEND_VAR\nF_Get := itf.Get();\nEND_FUNCTION\n\n"
  const pre = I_X + FB_X + F_GET
  expect(codes(pre, "i : INT := F_Get(itf := later);\n\tlater : FB_X := (n := 3);")).toEqual(["init-reads-later"])
  expect(codes(pre, "i : INT := F_Get(itf := later);\n\tlater : FB_X;")).toEqual(["init-reads-later"])
  expect(codes(pre, "x : FB_X := (n := 3);\n\ti : INT := F_Get(itf := x);")).toEqual(["init-reads-instance"])
  // an earlier instance with no structured initializer still lowers: its 7
  const r = lower(pre, "x : FB_X;\n\ti : INT := F_Get(itf := x);")
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  expect(p.get("i")).toBe(7n)
})

// transpile-restructure 5.9 (design.md §3.4 step 5d): the read walk skipped a call's FREEZES — an in-out's index taken
// where it is written, ahead of a later argument's call — so `arr[cfg.n]` read a later struct's field and lowered clean
// (answering arr[0] + 1). The walk is `childrenOf` now; what it reads there reaches the guards.
test("a read inside a call's freeze reaches the guards", () => {
  const T_P = "TYPE T_P :\nSTRUCT\n\tn : INT := 4;\nEND_STRUCT\nEND_TYPE\n\n"
  const F_NEXT = "FUNCTION F_Next : INT\nF_Next := 1;\nEND_FUNCTION\n\n"
  const F_IO = "FUNCTION F_Io : INT\nVAR_IN_OUT\n\tx : INT;\nEND_VAR\nVAR_INPUT\n\tv : INT;\nEND_VAR\nF_Io := x + v;\nEND_FUNCTION\n\n"
  expect(codes(T_P + F_NEXT + F_IO, "arr : ARRAY[0..4] OF INT;\n\ti : INT := F_Io(x := arr[cfg.n], v := F_Next());\n\tcfg : T_P;")).toEqual(["init-reads-later"])
  // an earlier index still lowers, read where the in-out is written (arr[2] + 1)
  const r = lower(F_NEXT + F_IO, "arr : ARRAY[0..4] OF INT := [1, 2, 3, 4, 5];\n\tk : INT := 2;\n\ti : INT := F_Io(x := arr[k], v := F_Next());")
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  expect(p.get("i")).toBe(4n)
})

test("and the ordinary shapes still lower", () => {
  expect(codes(F_INC, "other : INT := -7;\n\ti : INT := F_Inc(other);")).toEqual([])
  expect(codes("", "x : INT := 5;\n\tp : POINTER TO INT := ADR(x);")).toEqual([])
  expect(codes(`TYPE T_P :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n\n`, "cfg : T_P := (n := 9);\n\tcopied : INT := cfg.n;")).toEqual([])
})

/**
 * THE SPECULATION BUG, and why the mechanism that caused it is gone.
 *
 * The first version of the deferral decided "constant or not" by ATTEMPTING the fold and treating its failure as
 * "defer" — which meant lowering speculatively and discarding the diagnostics (`Lowering.quietly`). Lowering
 * MEMOIZES: `globalPlace` caches a global, `storageOf` caches a layout. Discarding the refusal left the half-built
 * entity in the cache, and the next reference hit the cache and never re-reported. A POU lowered CLEAN with a
 * global silently at 0.
 *
 * `foldsToConstant` answers the same question from the AST and the scope, so nothing is lowered speculatively and
 * `quietly` no longer exists. These are the shapes that reached it.
 */
const F_GET = "FUNCTION F_Get : INT\nF_Get := 41;\nEND_FUNCTION\n\n"

test("a GLOBAL whose initializer is refused is reported, not cached at its default", () => {
  // `SHL(gBad, 2)` is what used to trigger the speculative lowering that declared `gBad` and threw its refusal away
  const r = lowerSource(
    `${F_GET}VAR_GLOBAL\n\tgBad : INT := F_Get();\nEND_VAR\n\nPROGRAM PLC_PRG\nVAR\n\tx : INT := SHL(gBad, 2);\n\ty : INT;\nEND_VAR\ny := gBad;\nEND_PROGRAM\n`,
    "PLC_PRG",
  )
  expect(r.diagnostics.map((d) => d.code)).toContain("init-not-constant")
  expect(r.pou).toBeUndefined()
})

test("a STRUCT FIELD whose initializer is refused is reported too — and never deferred", () => {
  // A layout has no init step, so deferring a field would queue a statement nothing emits: the same silent default.
  const r = lowerSource(
    `${F_GET}TYPE T_S :\nSTRUCT\n\ta : INT := F_Get();\nEND_STRUCT\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tn : INT := SHL(INT#1, SIZEOF(T_S));\n\tsx : T_S;\n\tout : INT;\nEND_VAR\nout := sx.a;\nEND_PROGRAM\n`,
    "PLC_PRG",
  )
  expect(r.diagnostics.map((d) => d.code)).toContain("init-not-constant")
  expect(r.pou).toBeUndefined()
})

/**
 * THE BACKSTOP FOR THE FIFTH. All four defects above were one shape — an initializer that produced nothing while
 * the POU lowered clean — and each was fixed where it arose. `init-dropped` closes the shape itself: `declareVars`
 * now refuses when an initializer lowers to undefined and no diagnostic was recorded, so a future path that forgets
 * to speak fails loud instead of defaulting silently.
 *
 * It fires on no fixture (2291) and no corpus POU (6985), which is the point — every current path is paired with a
 * refusal. Reaching it needs a bail removed, verified by injection on 2026-09-20 with `scalarInit`'s
 * `init-not-constant` deleted: the struct-field case below reported `init-dropped` instead of lowering clean.
 * So what is pinned here is the other direction — that it does NOT fire on an initializer that legitimately
 * produces the default, which is what would turn the backstop into a wall.
 */
test("an initializer that IS the type's default is not mistaken for a dropped one", () => {
  const r = lower("", "a : INT := 0;\n\tb : TIME := T#0MS;\n\tc : BOOL := FALSE;\n\td : STRING := '';")
  expect(r.diagnostics).toEqual([])
  expect(r.pou!.slots.filter((x) => ["a", "b", "c", "d"].includes(x.name)).length).toBe(4)
})

test("a global AT an address lowering does not model keeps its refusal", () => {
  // otherwise a hardware-mapped variable is silently modelled as ordinary storage. (`%MQ8` stood here, which is no
  // address at all — an area, no size letter, then `Q8` — and the parser refuses it since frontend-conformance 2.2.7;
  // `%I*` is an address, incomplete, which lowering does not model — and CODESYS and TwinCAT build exactly this, an
  // initialized incomplete address in a VAR_GLOBAL: recorded 2026-10-01, and not kept as a fixture only because a GVL's
  // initializer would raise a NOSCOPE ceiling — the answer is in `test/conformance/fixtures/grammar/literals.ts`.)
  const r = lowerSource(
    "VAR_GLOBAL\n\tgB AT %I* : BYTE := 2;\nEND_VAR\n\nPROGRAM PLC_PRG\nVAR\n\tx : BYTE := SHL(gB, 2);\n\tz : BYTE;\nEND_VAR\nz := gB;\nEND_PROGRAM\n",
    "PLC_PRG",
  )
  expect(r.diagnostics.map((d) => d.code)).toContain("var-at")
  expect(r.pou).toBeUndefined()
})

test("and the folds that must keep working, do", () => {
  const value = (decls: string, read: string): unknown => {
    const r = lowerSource(`PROGRAM PLC_PRG\nVAR\n\t${decls}\nEND_VAR\n;\nEND_PROGRAM\n`, "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    return p.get(read)
  }
  expect(value("d : DINT := ANY_TO_DINT(16#80000000);", "d")).toBe(-2147483648n)
  expect(value("w : DWORD := (SHL(UINT_TO_DWORD(3), 16) OR 16#1);", "w")).toBe(196609n)
  expect(value("n : UDINT := SIZEOF(DINT);", "n")).toBe(4n)
})

/**
 * A DECLARATION'S `REF=` BINDS, and the parser used to forget which operator introduced the initializer.
 *
 * `c.eatPunct(":=") ?? c.eatPunct("REF=")` accepted both and recorded neither, so `r : REFERENCE TO UDINT REF= v`
 * arrived at lowering as an ordinary assignment: no target was recorded, and every later read of `r` was refused
 * `pointer-order`. That was the single largest line in its histogram — 141 corpus POUs, all of them reaching
 * `ONTIME.pou`'s `refSeconds`. Recording `initOp` took `pointer-order`'s reach from 177 POUs to 105.
 *
 * The statement form (`r REF= v;`) was always measured and always worked; only the DECLARATION form was lost. So
 * what is asserted here is that the two agree — and the values, not merely that it lowers.
 */
test("a REFERENCE bound at its declaration reads and writes its target, per instance, across scans", () => {
  const r = lower("", "v : UDINT := 7;\n\tref : REFERENCE TO UDINT REF= v;\n\tseen : UDINT;", "seen := ref;\nref := ref + 1;")
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  p.scan()
  // `seen := ref` READ through it (7 on the first scan, 8 on the second), and `ref := ref + 1` WROTE through it
  // into `v` — twice, so the binding survived the scan boundary.
  //
  // NOT asserted: `p.get("ref")`. Form 1 ERASES the reference (pointer-model.md §2) — its slot holds 1, the
  // non-null marker, not the pointee. Asserting the target's value there was a claim about monitoring that this
  // model does not make; `get` reads the reference's own storage.
  expect([p.get("v"), p.get("seen")]).toEqual([9n, 8n])
})

test("a REFERENCE field bound at its declaration is per INSTANCE, not shared", () => {
  const src =
    `PROGRAM PLC_PRG\nVAR a : FB_R; b : FB_R; END_VAR\na();\na();\nb();\nEND_PROGRAM\n\n` +
    `FUNCTION_BLOCK FB_R\nVAR n : UDINT := 0; rx : REFERENCE TO UDINT REF= n; END_VAR\nrx := rx + 1;\nEND_FUNCTION_BLOCK\n`
  const r = lowerSource(src, "PLC_PRG")
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  expect([p.get("a.n"), p.get("b.n")]).toEqual([2n, 1n])
})

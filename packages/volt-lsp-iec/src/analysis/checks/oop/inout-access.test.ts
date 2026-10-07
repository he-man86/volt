/**
 * inout-access — the two VAR_IN_OUT checks (analysis-conformance 1.12), each tested as it was in its own file.
 *
/**
 * inout-external-access — C0178. External access to an FB's VAR_IN_OUT member (read or write) is rejected;
 * the FB's own THIS/SUPER access and every other member kind stay silent (zero-FP).
 *
/**
 * inout-own-access — C0371, a WARNING. A method/action touching its enclosing FB's VAR_IN_OUT. The FB's own
 * main body may touch it freely (no warning); only a member scope (method/action) does. Wording live-verified
 * byte-identical against the real lenze-mid build.
 */
import { describe, test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

describe("inout-external-access (C0178)", () => {
  const FB = `\nFUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nVAR_INPUT\n inp : INT;\nEND_VAR\nVAR\n loc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const diag = (body: string): { code: string; message: string }[] => {
    const src = `PROGRAM PLC_PRG\nVAR\n inst : FB;\n i : INT;\nEND_VAR\n${body}\nEND_PROGRAM${FB}`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  }
  const codes = (body: string): string[] => diag(body).map((d) => d.code)

  // The compiler reports BOTH for an external access — the C0178 error and the C0371 warning naming the body that
  // reached in, `__MAIN` for a main body (conformance `cc5_inout_external_access`: four diagnostics for two accesses).
  test("C0178 — external READ of a VAR_IN_OUT member, with the C0371 warning beside it", () => {
    const ds = diag("i := inst.io;")
    expect(ds.map((d) => d.code)).toEqual(["inout-no-external-access", "inout-own-access"])
    expect(ds[0].message).toBe(`No external access to VAR_IN_OUT parameter 'io' of 'FB'."`)
    expect(ds[1].message).toBe(`Access to VAR_IN_OUT 'io' declared in 'FB' from external context '__MAIN'`)
  })

  test("C0178 — external WRITE of a VAR_IN_OUT member (not external-write)", () => {
    expect(codes("inst.io := 5;")).toEqual(["inout-no-external-access", "inout-own-access"])
  })

  test("a VAR_INPUT member is externally accessible — no FP", () => {
    expect(codes("i := inst.inp;")).toEqual([])
    expect(codes("inst.inp := 5;")).toEqual([])
  })

  test("a method accessing its OWN FB's VAR_IN_OUT is the C0371 warning, NOT the C0178 error", () => {
    const src = `FUNCTION_BLOCK FB_Test\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD METH : BOOL\nVAR\n x : INT;\nEND_VAR\nio := x;\nEND_METHOD`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }])
    // Default config: the C0371 warning (default on), never the C0178 error.
    const def = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    expect(def.map((d) => ({ code: d.code, sev: d.severity }))).toEqual([{ code: "inout-own-access", sev: "warning" }])
    // A project that disabled the warning: no diagnostic at all (still never the C0178 error).
    const off = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys", diagnostics: { "inout-own-access": "off" } }) })
    expect(off).toEqual([])
  })
})

describe("inout-own-access (C0371)", () => {
  // The check is ON by default; pass it explicitly to be robust to the default flipping.
  const diag = (src: string) => {
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  }

  test("a method touching its FB's VAR_IN_OUT warns (C0371), byte-identical", () => {
    const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nio := 5;\nEND_METHOD`
    const ds = diag(src).filter((d) => d.code === "inout-own-access")
    expect(ds.length).toBe(1)
    expect(ds[0].severity).toBe("warning")
    expect(ds[0].message).toBe("Access to VAR_IN_OUT 'io' declared in 'FB' from external context 'Meth'")
  })

  test("fires once per ACCESS (like CODESYS — its 96 raw warnings dedupe to 20 unique)", () => {
    const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nio := io + 1;\nEND_METHOD`
    expect(diag(src).filter((d) => d.code === "inout-own-access").length).toBe(2) // LHS + RHS access
  })

  test("the FB's OWN main body touching its VAR_IN_OUT does NOT warn (it lives there)", () => {
    const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nio := io + 1;\nEND_FUNCTION_BLOCK`
    expect(diag(src).filter((d) => d.code === "inout-own-access")).toEqual([])
  })

  test("a property GET/SET accessor touching the FB's VAR_IN_OUT warns, context '__get'/'__set'<Prop>", () => {
    const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nPROPERTY Pos : INT\nGET\nPos := io;\nEND_GET\nSET\nio := Pos;\nEND_SET\nEND_PROPERTY`
    const ds = diag(src).filter((d) => d.code === "inout-own-access").map((d) => d.message)
    expect(ds).toContain("Access to VAR_IN_OUT 'io' declared in 'FB' from external context '__getPos'")
    expect(ds).toContain("Access to VAR_IN_OUT 'io' declared in 'FB' from external context '__setPos'")
  })

  test("a method touching a plain local (not a VAR_IN_OUT) does NOT warn", () => {
    const src = `FUNCTION_BLOCK FB\nVAR\n loc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nloc := loc + 1;\nEND_METHOD`
    expect(diag(src).filter((d) => d.code === "inout-own-access")).toEqual([])
  })

  test("ON by default (CODESYS default; hardly any project disables it) — fires without opting in", () => {
    const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nio := 5;\nEND_METHOD`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    const ds = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    expect(ds.filter((d) => d.code === "inout-own-access").length).toBe(1)
  })

  test("a project that disabled the warning can turn it off (lints.inoutOwnAccess=false)", () => {
    const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nio := 5;\nEND_METHOD`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    const ds = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys", diagnostics: { "inout-own-access": "off" } }) })
    expect(ds.filter((d) => d.code === "inout-own-access")).toEqual([])
  })

  test("a call argument's PARAMETER name is not a reference — one access, one warning", () => {
    // Why missed: `F(book := book)` counted the formal parameter as well as the value, so one access warned twice
    // (conformance `xo3_inout_chain_four_deep`).
    const src = `FUNCTION F_mark : BOOL\nVAR_IN_OUT\nbook : INT;\nEND_VAR\nF_mark := TRUE;\nEND_FUNCTION\n\nFUNCTION_BLOCK FB_inner\nVAR_IN_OUT\nbook : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Deeper\nF_mark(book := book);\nEND_METHOD`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    const msgs = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "inout-own-access")
      .map((d) => d.message)
    expect(msgs).toEqual(["Access to VAR_IN_OUT 'book' declared in 'FB_inner' from external context 'Deeper'"])
  })
})

// analysis-conformance 3.6 (both vendors, recorded 2026-10-06): an INITIALIZER is an access too — an FB instance
// initialized through its FB's VAR_IN_OUT from the POU that declares it (`ioinit_fb_instance_literal`,
// `oopa_fb_init_inout_other_type`: "… from external context '<that POU>'"), and an ARRAY / STRUCT initializer reading the
// FB's own VAR_IN_OUT from FB_INIT (`ioinit_array_initializer`, `ioinit_struct_initializer`); a plain initializer
// reading it draws no such warning (`cc4_inout_in_initializer`)
describe("an initializer's access to a VAR_IN_OUT (C0371)", () => {
  const run = (src: string): string[] => {
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "inout-own-access")
      .map((d) => d.message)
  }
  test("an FB instance initialized through its FB's VAR_IN_OUT, from the declaring POU", () => {
    const src = `FUNCTION_BLOCK B\nVAR_IN_OUT\n target : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK A\nVAR\n own : INT;\n w : B := (target := own);\nEND_VAR\nEND_FUNCTION_BLOCK`
    expect(run(src)).toEqual(["Access to VAR_IN_OUT 'target' declared in 'B' from external context 'A'"])
  })
  test("an ARRAY or STRUCT initializer reading the FB's own VAR_IN_OUT, from FB_INIT; a plain one not", () => {
    const st = `TYPE S :\nSTRUCT\n x : INT;\nEND_STRUCT\nEND_TYPE\n`
    expect(run(`FUNCTION_BLOCK F\nVAR_IN_OUT\n src : INT;\nEND_VAR\nVAR\n c : ARRAY[0..1] OF INT := [src, 1];\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
      "Access to VAR_IN_OUT 'src' declared in 'F' from external context 'FB_INIT'",
    ])
    expect(run(`${st}FUNCTION_BLOCK F\nVAR_IN_OUT\n src : INT;\nEND_VAR\nVAR\n v : S := (x := src);\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
      "Access to VAR_IN_OUT 'src' declared in 'F' from external context 'FB_INIT'",
    ])
    expect(run(`FUNCTION_BLOCK F\nVAR_IN_OUT\n src : INT;\nEND_VAR\nVAR\n c : INT := src;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
  })
})

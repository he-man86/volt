/**
 * this-super-context (C0045 THIS / C0122 SUPER) — used in a PROGRAM/FUNCTION where they're invalid.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const errs = (src: string): string[] => {
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "this-not-allowed" || d.code === "super-not-allowed")
    .map((d) => d.message)
}

test("THIS/SUPER in a PROGRAM are flagged; in a FUNCTION_BLOCK they are fine", () => {
  expect(errs(`PROGRAM P\nVAR t:INT;\nEND_VAR\nTHIS^.t := 1;\nEND_PROGRAM`)).toEqual(["Expression THIS is not allowed in this context"])
  expect(errs(`PROGRAM P\nVAR t:INT;\nEND_VAR\nSUPER^.t := 1;\nEND_PROGRAM`)).toEqual(["Expression SUPER is not allowed in this context"])
  // lower case is the same error — the check compared exactly and let these through (conformance `cc_self_this_*`)
  expect(errs(`PROGRAM P\nVAR t:INT;\nEND_VAR\nthis^.t := 1;\nEND_PROGRAM`)).toEqual(["Expression THIS is not allowed in this context"])
  expect(errs(`PROGRAM P\nVAR t:INT;\nEND_VAR\nsuper^.t := 1;\nEND_PROGRAM`)).toEqual(["Expression SUPER is not allowed in this context"])
  expect(errs(`FUNCTION_BLOCK F\nVAR t:INT;\nEND_VAR\nTHIS^.t := 1;\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// SUPER in a function block that EXTENDS nothing is the PROGRAM's error, "Expression SUPER is not allowed in this context",
// and a call through it is also no call target, named AS WRITTEN up to its `(`: 'SUPER^' for `SUPER^()`, 'SUPER^.Get' for
// `SUPER^.Get()` — the hole it leaves then converted and dereferenced as any refused name's (`refuse_super_without_base`,
// `expr_super_without_base`, both vendors 2026-10-02). There was a fixed "… instead of 'SUPER^'" on every SUPER here.
test("SUPER in a base-less function block: not allowed, and its call no call target as written (refuse_super_without_base, expr_super_without_base, E27)", () => {
  const all = (src: string): string[] => {
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.severity === "error")
      .map((d) => d.message)
      .sort()
  }
  expect(all(`FUNCTION_BLOCK F\nVAR n : INT;\nEND_VAR\nSUPER^();\nn := 1;\nEND_FUNCTION_BLOCK`)).toEqual([
    "Expression SUPER is not allowed in this context",
    "Program name, function or function block instance expected instead of 'SUPER^'",
  ])
  expect(all(`FUNCTION_BLOCK F\nVAR out : INT;\nEND_VAR\nout := SUPER^.Get();\nEND_FUNCTION_BLOCK`)).toEqual([
    "'SUPER^' is no structured variable",
    "Cannot convert type 'Unknown type: 'SUPER^.Get()'' to type 'INT'",
    "Expression SUPER is not allowed in this context",
    "Program name, function or function block instance expected instead of 'SUPER^.Get'",
  ])
})

// THIS and SUPER WITHOUT their `^` are the pointers themselves, which have no members: `THIS.v` is "'THIS' is no structured
// variable" and the conversion of the hole; `SUPER.Get()` that, and no call target as written (`expr_this_member_without_deref`,
// `expr_super_without_deref`, both vendors 2026-10-02).
test("a member off THIS or SUPER without its `^`: no structured variable (expr_this_member_without_deref, expr_super_without_deref, E27)", () => {
  const all = (src: string): string[] => {
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.severity === "error")
      .map((d) => d.message)
      .sort()
  }
  expect(all(`FUNCTION_BLOCK F\nVAR v : INT := 4;\nout : INT;\nEND_VAR\nout := THIS.v;\nEND_FUNCTION_BLOCK`)).toEqual([
    "'THIS' is no structured variable",
    "Cannot convert type 'Unknown type: 'THIS.v'' to type 'INT'",
  ])
  expect(all(`FUNCTION_BLOCK B\nEND_FUNCTION_BLOCK\nMETHOD Get : INT\nGet := 4;\nEND_METHOD\nFUNCTION_BLOCK F EXTENDS B\nVAR out : INT;\nEND_VAR\nout := SUPER.Get();\nEND_FUNCTION_BLOCK`)).toEqual([
    "'SUPER' is no structured variable",
    "Cannot convert type 'Unknown type: 'SUPER.Get()'' to type 'INT'",
    "Program name, function or function block instance expected instead of 'SUPER.Get'",
  ])
  // …and with the `^` nothing is said
  expect(all(`FUNCTION_BLOCK F\nVAR v : INT := 4;\nout : INT;\nEND_VAR\nout := THIS^.v;\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// …and `SUPER.Get()` WITHOUT the `^` in a function block that extends nothing is the base-less answer alone: not allowed,
// the call target as written ONCE, and the hole — no "'SUPER' is no structured variable" (`expr_super_without_deref_without_base`,
// both vendors 2026-10-02). Both walks named the call target, so it was said twice, beside a structured-variable message
// the vendors do not give here.
test("SUPER.Get() in a base-less function block: one call-target message, no structured-variable one (expr_super_without_deref_without_base, E27)", () => {
  const pr = (src: string) => parseSource(src, { networkText: true })
  const src = `FUNCTION_BLOCK F\nVAR out : INT;\nEND_VAR\nout := SUPER.Get();\nEND_FUNCTION_BLOCK`
  const parsed = pr(src)
  const project = build.buildSymbolTable([{ uri: "F", parseResult: parsed, source: src }])
  const msgs = computeSemanticDiagnostics({ uri: uriFor(parsed), parseResult: parsed, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()
  expect(msgs).toEqual([
    "Cannot convert type 'Unknown type: 'SUPER.Get()'' to type 'INT'",
    "Expression SUPER is not allowed in this context",
    "Program name, function or function block instance expected instead of 'SUPER.Get'",
  ])
})

import { describe, expect, test } from "bun:test"
import { attribute, isSiteLiteral, messageLiteral, messagePointer, siteMatcher, sitePointer, verdict, type SiteEvidence } from "./probe-refusal-evidence.js"

const site = (s: Partial<SiteEvidence>): SiteEvidence => ({ at: "x.ts:1", literal: "", pointer: "none", ran: 0, vendorRefused: 0, corpus: 0, ...s })

describe("probe-refusal-evidence: a pointer is only what the evidence states", () => {
  test("a message points at a kind only when it says one", () => {
    expect(messagePointer("a difference of addresses whose byte offsets are not measured")).toBe("not-measured")
    expect(messagePointer("which value arrives is not recorded")).toBe("not-measured")
    expect(messagePointer("x is not modelled")).toBe("not-modelled")
    expect(messagePointer("CODESYS refuses this")).toBe("invalid")
    expect(messagePointer("${arg.param.name} is not a parameter of ${layout.name}")).toBe("none")
    // the wordings the code uses for not-modelled (globals.ts:78, address.ts:92)
    expect(messagePointer("${list} is a library's global list, which lowering leaves unmodelled")).toBe("not-modelled")
    expect(messagePointer("a pointer value this does not model")).toBe("not-modelled")
  })

  test("a message joining two refusals with ', or' states the kind of one of them only", () => {
    expect(messagePointer("${text}: an address that is incomplete, or of a shape not modelled")).toBe("two-cases")
    expect(messagePointer("${t.name} has a member whose overlaid bytes are not measured, or an initial value")).toBe("two-cases")
    // a kind stated after the dash covers every alternative; a list with no kind stated says nothing
    expect(messagePointer("a FOR step holding a call, or a limit holding one — how often it runs is not recorded")).toBe("not-measured")
    expect(messagePointer("an interface used other than to call through it, store it, or compare it with 0")).toBe("none")
    expect(messagePointer("a string, given something other than ADR(...) of one, a cursor, or a pointer to one")).toBe("none")
  })

  test("the message is the literal argument after the code — never the code on the next line", () => {
    const line = '    if (scope === undefined) return lw.bail("call-target", `${name} did not bind`, span)'
    const next = "    const unmeasured = part.varSections.find((s) => s.sectionKind !== \"VAR\")"
    expect(messageLiteral(line, next, line.indexOf('"call-target"') + '"call-target"'.length)).toBe("${name} did not bind")
    // a bail that wraps: the literal opens the next line
    const wrapped = '    return lw.bail("adr-offset",'
    expect(messageLiteral(wrapped, '      "a difference whose byte offsets are not measured", e.span)', wrapped.indexOf(","))).toBe("a difference whose byte offsets are not measured")
    // the code is not a bail argument here: no message
    expect(messageLiteral('  const code = "stmt-call_stmt"', "  return lw.bail(code, `${x} is no instance`, span)", 31)).toBe("")
  })

  test("a template literal with a template nested in a placeholder is read whole (lower-source.ts:87, address.ts:266)", () => {
    const line = '        lowerDiagnostic("no-unit", `no PROGRAM or FUNCTION_BLOCK${name === undefined ? "" : ` named ${name}`}`, span),'
    const literal = messageLiteral(line, "", line.indexOf('"no-unit"') + '"no-unit"'.length)
    expect(literal).toBe('no PROGRAM or FUNCTION_BLOCK${name === undefined ? "" : ` named ${name}`}')
    expect(siteMatcher(literal).test("no PROGRAM or FUNCTION_BLOCK named PLC_PRG")).toBe(true)
    expect(siteMatcher(literal).test("no PROGRAM or FUNCTION_BLOCK")).toBe(true)
    const ptr =
      '    return lw.bail("pointer-targets", `${pointer === undefined ? "an address compared" : `${pointer.name} holds addresses, and`} ${text} is not in the image — a tag`, span)'
    const l2 = messageLiteral(ptr, "", ptr.indexOf('"pointer-targets"') + '"pointer-targets"'.length)
    expect(l2).toEndWith("is not in the image — a tag")
    expect(siteMatcher(l2).test("p holds addresses, and x is not in the image — a tag")).toBe(true)
  })

  test("a code literal that is no refusal is no site: a union type, a default parameter", () => {
    const at = (line: string, code: string): boolean => isSiteLiteral(line, line.indexOf(`"${code}"`), `"${code}"`.length)
    expect(at('  code: "graphical-body" | "parse" | "call-library"', "graphical-body")).toBe(false)
    expect(at('  code: "graphical-body" | "parse" | "call-library"', "parse")).toBe(false)
    expect(at('export function lowerPlace(lw: Lowering, e: Expr, notAMember = "place-shape"): Place | undefined {', "place-shape")).toBe(false)
    expect(at('    return lw.bail("place-shape", "a character", e.span)', "place-shape")).toBe(true)
    expect(at('  if (!parsed.ok) return { code: "parse", message: parsed.firstError }', "parse")).toBe(true)
    expect(at('      const code = kind === "program" ? "call-program" : kind === "method" ? "call-this" : "stmt-call_stmt"', "stmt-call_stmt")).toBe(true)
    expect(at('      "root-inout",', "root-inout")).toBe(true)
  })

  test("a site matcher accepts its own messages, with any template text", () => {
    expect(siteMatcher("${text}: an address that is incomplete, or of a shape not modelled").test("b AT %I0.0: an address that is incomplete, or of a shape not modelled")).toBe(true)
    expect(siteMatcher("${text} overlaps ${clash} — the vendor aliases them").test("b AT %I0.0: an address that is incomplete, or of a shape not modelled")).toBe(false)
  })

  test("a diagnostic is attributed to the most specific site that matches it", () => {
    const sites = [site({ at: "a.ts:1", literal: "${x}: ${why}" }), site({ at: "a.ts:2", literal: "${x}: an address that is incomplete" })]
    expect(attribute(sites, "%MX3: an address that is incomplete").map((s) => s.at)).toEqual(["a.ts:2"])
    expect(attribute(sites, "%MX3: overlaps").map((s) => s.at)).toEqual(["a.ts:1"])
    expect(attribute([site({ literal: "only this" })], "something else")).toEqual([])
  })

  test("sites tied on the most fixed text are ambiguous — every tied site is returned, none is picked", () => {
    const sites = [site({ at: "invoke.ts:159", literal: "${a} is called" }), site({ at: "names.ts:67", literal: "${b} is called" })]
    expect(attribute(sites, "X is called").map((s) => s.at)).toEqual(["invoke.ts:159", "names.ts:67"])
  })
})

describe("probe-refusal-evidence: per-site pointers", () => {
  test("valid ST rules out invalid and leaves the other two undecided", () => {
    expect(sitePointer(site({ ran: 1 }))).toBe("valid")
    expect(sitePointer(site({ corpus: 3 }))).toBe("valid")
    expect(sitePointer(site({ pointer: "invalid", corpus: 3 }))).toBe("conflict (valid ST, message says invalid)")
    expect(sitePointer(site({ pointer: "not-measured", ran: 2 }))).toBe("not-measured")
  })

  test("only vendor-refused hits point at invalid, tentatively", () => {
    expect(sitePointer(site({ vendorRefused: 2 }))).toBe("invalid?")
    expect(sitePointer(site({ pointer: "two-cases", vendorRefused: 12 }))).toBe("invalid?")
  })

  test("a message alone is tentative; silence is none", () => {
    expect(sitePointer(site({ pointer: "not-modelled" }))).toBe("not-modelled?")
    expect(sitePointer(site({}))).toBe("none")
  })
})

describe("probe-refusal-evidence: a code is decided only when every site is", () => {
  test("every site naming one kind decides it", () => {
    expect(verdict([site({ pointer: "not-measured", ran: 2 }), site({ pointer: "not-measured" })])).toBe("not-measured")
    expect(verdict([site({ pointer: "not-modelled" })])).toBe("not-modelled?")
    expect(verdict([site({ vendorRefused: 3 }), site({ vendorRefused: 1 })])).toBe("invalid?")
  })

  test("sites refusing invalid ST and valid ST are a split candidate, whichever site states a kind", () => {
    // var-at: addresses.ts:69 hit only by vendor-refused fixtures, :112 by vendor-run ones
    const v = verdict([site({ pointer: "two-cases", vendorRefused: 12 }), site({ ran: 8 }), site({})])
    expect(v).toBe("undecided (split? invalid ST at one site, valid ST at another)")
  })

  test("a kind stated at some sites, silence at the others, is only partly decided", () => {
    // any-input: 3 sites say not measured, 5 say nothing
    const v = verdict([site({ pointer: "not-measured", corpus: 8 }), site({ pointer: "not-measured" }), site({ pointer: "not-measured" }), site({}), site({}), site({}), site({}), site({})])
    expect(v).toBe("partly decided (not-measured at 3 of 8 sites)")
  })

  test("a message joining two refusals is a split candidate", () => {
    expect(verdict([site({ pointer: "two-cases", vendorRefused: 1, corpus: 19 })])).toStartWith("undecided (split?")
  })

  test("two stated kinds are a split candidate; silence is undecided", () => {
    expect(verdict([site({ pointer: "not-measured", ran: 1 }), site({ pointer: "not-modelled", ran: 1 })])).toBe("undecided (split? sites say not-measured + not-modelled)")
    expect(verdict([site({})])).toBe("undecided (no evidence)")
    expect(verdict([site({ ran: 1 }), site({})])).toBe("undecided (valid ST: not-modelled or not-measured)")
  })

  test("a pseudo-entry (unattributed, ambiguous) is no site: out of the count and out of the split test", () => {
    // any-input: 3 of its 8 real sites say not measured; its unattributed hits are not a ninth site
    const any = [site({ pointer: "not-measured", corpus: 4 }), site({ pointer: "not-measured" }), site({ pointer: "not-measured" }), site({}), site({}), site({}), site({}), site({}), site({ at: "(unattributed)", corpus: 2 })]
    expect(verdict(any)).toBe("partly decided (not-measured at 3 of 8 sites)")
    // stmt-call_stmt: its only valid-ST evidence is unattributed — no site is valid, so no split
    expect(verdict([site({}), site({ vendorRefused: 3 }), site({ at: "(unattributed)", vendorRefused: 7, corpus: 2 })])).toBe("partly decided (invalid at 1 of 2 sites)")
    expect(verdict([site({ at: "(one of a.ts:1, a.ts:2)", ran: 2 })])).toBe("undecided (no evidence)")
  })

  test("a conflict at any site leaves the code undecided", () => {
    expect(verdict([site({ pointer: "invalid", ran: 1 })])).toBe("undecided (conflict at x.ts:1: valid ST, message says invalid)")
  })
})

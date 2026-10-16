/**
 * The network-text operand checks (`_operands.ts`): an undeclared name, an unknown member, a binary operator's operands
 * and a conversion's argument — the ST checks' own rules and wording, over the operands of a network.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import type { LibraryManifest } from "../../../frontend/library/index.js"
import { computeNetworkTextDiagnostics, messagesFor } from "../../index.js"
import { doc, project, vgDiags } from "../../../../test/support/network-docs.js"

const vgByCode = (src: string, code: string): number => vgDiags(src).filter((d) => d.code === code).length

// network-undeclared-identifier — the network-text analogue of ST's unresolved-identifier, sharing its resolution rules.
const vgUndeclared = (src: string, manifests: readonly LibraryManifest[] = []): string[] =>
  computeNetworkTextDiagnostics(doc(src), project(doc(src), manifests), messagesFor("codesys"))
    .filter((d) => d.code === "network-undeclared-identifier")
    .map((d) => d.message)

test("network text: an operand declared nowhere IS flagged, byte-identical to the compiler", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := nope;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual(["Identifier 'nope' not defined"])
})

test("network text: declared vars and splits resolve (no undeclared diagnostic)", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
split1 := a AND b;
out := split1;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src)).toEqual([])
})

test("network text: R_EDGE / F_EDGE are flags on their operand, not calls of something undeclared", () => {
  // v1 left an edge as a trailing RISING/FALLING word in the operand, which this check had to skip by name. v2 spells
  // it `R_EDGE(x)`, a flag with no ST reading, so no word of the text ever reaches the undeclared check.
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; a : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := R_EDGE(a);
out := F_EDGE(NOT a);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src)).toEqual([])
  expect(vgUndeclared(src.replace("R_EDGE(a)", "R_EDGE(nope)"))).toEqual(["Identifier 'nope' not defined"]) // the operand still is checked
})

test("network text: a referenced library's namespace resolves when its manifest is bound", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
out := PACK_ML.gFlag;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual(["Identifier 'PACK_ML' not defined"]) // unknown → flagged
  // the library materialized nothing; its manifest still binds the namespace (`bindLibraryNamespaces`)
  expect(vgUndeclared(src, [{ uri: "App/Library Manager/PackML/PackML.library", folder: "PackML", dir: "App/Library Manager/PackML/", namespace: "PACK_ML", library: "PackML", dependencies: [], materialization: 4 }])).toEqual([]) // known → resolves
})

// network-unknown-member — the network-text analogue of ST's `a.b` member check (wired once the qualified_only binder
// bug that caused the lenze `Mach1` FPs was fixed). Shares `unresolvedMembers` + `notAMember` wording.
test("network text: an unknown struct member IS flagged; a real one stays quiet (network-unknown-member)", () => {
  const src = `TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR p : Pt; out : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
out := p.x;
out := p.nope;
END_NETWORK
END_FUNCTION_BLOCK`
  const msgs = vgDiags(src).filter((d) => d.code === "network-unknown-member").map((d) => d.message)
  expect(msgs).toEqual(["'nope' is no component of 'Pt'"]) // p.x quiet, p.nope flagged
})

test("network text: a qualified_only GVL chain does NOT false-positive (lenze Mach1 regression)", () => {
  // bare `Mach1` binds to the GVL block (not HMI's qualified-only member), so `Mach1.Genflags.bReady`
  // resolves cleanly through the GVL global's struct type — zero unknown-member FPs.
  const files: Record<string, string> = {
    "file:///Mach1.gvl": `{attribute 'qualified_only'}\nVAR_GLOBAL\n\tGenflags : UDT_GeneralFlags;\nEND_VAR`,
    "file:///HMI.gvl": `{attribute 'qualified_only'}\nVAR_GLOBAL\n\tMach1 : sUDT_HMIVar_Mach1;\nEND_VAR`,
    "file:///Types.dut": `TYPE UDT_GeneralFlags : STRUCT bReady : BOOL; END_STRUCT END_TYPE\nTYPE sUDT_HMIVar_Mach1 : STRUCT other : BOOL; END_STRUCT END_TYPE`,
    "file:///FB_User.pou": `FUNCTION_BLOCK FB_User\nVAR x : BOOL; END_VAR\nIMPLEMENTATION FBD
NETWORK\nx := Mach1.Genflags.bReady;\nEND_NETWORK\nEND_FUNCTION_BLOCK`,
  }
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  const proj = build.buildSymbolTable(docs, [], "codesys")
  const fbDoc = docs.find((d) => d.uri === "file:///FB_User.pou")!
  const diags = computeNetworkTextDiagnostics(fbDoc, proj, messagesFor("codesys"))
  expect(diags.filter((d) => d.code === "network-unknown-member")).toEqual([])
  expect(diags.filter((d) => d.code === "network-undeclared-identifier")).toEqual([])
})

// Corpus-found (lenze FB_Lenze_i550, Network 1): a conversion-call OPERAND whose argument sign-changes into the
// conversion's source type. network text never ran the conversion-arg check before — the whole type-check class was blind
// to graphical bodies. Byte-identical to the CODESYS build.
test("network text: a conversion-arg operand that sign-changes (UINT_TO_WORD of an INT) warns like ST", () => {
  const src = `FUNCTION_BLOCK F
VAR w : WORD; i : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
w := UINT_TO_WORD(i);
END_NETWORK
END_FUNCTION_BLOCK`
  const d = vgDiags(src).find((x) => x.code === "sign-change-conversion")
  expect(d?.severity).toBe("warning")
  expect(d?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
})

test("network text: a bad binary operand (MOD on REAL) is flagged like ST", () => {
  const src = `FUNCTION_BLOCK F
VAR a : REAL; b : REAL; out : REAL; END_VAR
IMPLEMENTATION FBD
NETWORK
out := a MOD b;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "binary-op-type-mismatch")).toBe(1)
})

test("network text: an undeclared name of the old wire shape is a compiler message, not a push refusal", () => {
  // openspec bridge-refusal-review 1.3: the push writes it as a variable and the build reports it — both vendors,
  // `rcc_network_undeclared_wire_shape` (2026-10-04): "Identifier 'g7' not defined" and the hole it leaves. (P12: the
  // old `g<n>` wires fail as what they are now, an undeclared variable.)
  const fb = (statement: string) =>
    `FUNCTION_BLOCK FB\nVAR out : BOOL; x : BOOL; END_VAR\nIMPLEMENTATION LD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  expect(vgDiags(fb("out := g5;")).map((d) => d.message).sort()).toEqual([
    "Cannot convert type 'Unknown type: 'g5'' to type 'BOOL'",
    "Identifier 'g5' not defined",
  ])
  expect(vgDiags(fb("out := `g5`;")).map((d) => d.message)).toContain("Identifier 'g5' not defined")
  expect(vgDiags(fb("out := g5;")).map((d) => d.code)).not.toContain("NETWORK_BAD_EXPRESSION")
})

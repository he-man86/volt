/**
 * The network-text reader's TREE (openspec ld-fbd-coverage 2R.6b, `v2-spec.md`): what the parse hands the checks and the
 * services — one statement per NWL item, a box in the EN slot of the box it enables, the splits and their references, the
 * parallel, a box's type as the reader decided it and how its consumer reads it, the ST readings the type engine runs
 * over, and the recovery that keeps what was read. Which texts are accepted and which refused, by name, is the shared case
 * set's (`network-cases.test.ts`, the bridge's `NetworkTextCaseTests`) — not repeated here.
 */
import { expect, test } from "bun:test"
import {
  type BodySpan,
  type Expr,
  type NetworkScopeView,
  type NetworkTextBody,
  type NetworkTextStatement,
  type NetworkValue,
  isGraphicalBody,
  networkValueExpr,
  parseSource,
  statementExprs,
  statementTargets,
  STRUCTURE_ONLY,
  unitBodies,
  walkExpr,
  walkValues,
} from "../../syntax/index.js"
import { parseNetworkText } from "./network-parse.js"

/** A POU whose graphical body is `networks`, under the line stating LD. */
function body(networks: string, marker = "%LANGUAGE LD"): BodySpan {
  const src = `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\n${marker}\n${networks}\nEND_FUNCTION_BLOCK\n`
  const b = unitBodies(parseSource(src, { networkText: true }, "codesys").units[0]!).find(isGraphicalBody)
  if (b === undefined) throw new Error("no graphical body")
  return b
}
const parse = (networks: string, scope: NetworkScopeView | typeof STRUCTURE_ONLY = STRUCTURE_ONLY): NetworkTextBody =>
  parseNetworkText(body(networks), scope, "codesys")
const net = (statements: string, header = "NETWORK"): string => `${header}\n${statements}\nEND_NETWORK`
const codes = (networks: string): string[] => parse(networks).diagnostics.map((d) => d.code)
const clean = (networks: string, scope: NetworkScopeView | typeof STRUCTURE_ONLY = STRUCTURE_ONLY): NetworkTextStatement[] => {
  const b = parse(networks, scope)
  expect(b.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([])
  return b.networks.flatMap((n) => n.statements)
}
const only = (statements: string, scope: NetworkScopeView | typeof STRUCTURE_ONLY = STRUCTURE_ONLY): NetworkTextStatement => {
  const s = clean(net(statements), scope)
  expect(s).toHaveLength(1)
  return s[0]!
}
const valueOf = (s: NetworkTextStatement): NetworkValue => {
  if (s.kind === "assign" || s.kind === "split_def" || s.kind === "value") return s.value
  throw new Error(`no value on a ${s.kind}`)
}
const idents = (e: Expr | undefined): string[] => {
  const out: string[] = []
  if (e !== undefined) walkExpr(e, (x) => x.kind === "ident_expr" && out.push(x.name))
  return out
}
const scope = (instances: Record<string, string> = {}, pous: string[] = [], names: string[] = []): NetworkScopeView => ({
  isPou: (n) => pous.some((p) => p.toUpperCase() === n.toUpperCase()),
  instanceType: (h) => Object.entries(instances).find(([k]) => k.toUpperCase() === h.toUpperCase())?.[1],
  declares: (n) => [...Object.keys(instances), ...pous, ...names].some((x) => x.toUpperCase() === n.toUpperCase()),
})

// ── the body and its header ─────────────────────────────────────────────────────────────────

test("the line states the language and a network has no order number", () => {
  const b = parse(net("out := a;"))
  expect(b.language).toBe("LD")
  expect(b.networks).toHaveLength(1)
  expect(b.networks[0]!.index).toBe(0)
  expect(parseNetworkText(body(net("out := a;"), "%LANGUAGE FBD"), STRUCTURE_ONLY, "codesys").language).toBe("FBD")
})

test("a numbered header and a LET are refused as the push refuses them, never read", () => {
  // The phrases are the shared cases' (`refuse/grammar.cases` header-number, let-statement): one answer on both readers.
  expect(parse("NETWORK 0 LD\n  out := a;\nEND_NETWORK").diagnostics.map((d) => [d.code, d.message])).toEqual([
    ["NETWORK_PARSE", `'0' in a NETWORK header: the header is NETWORK [LABEL: x] [DISABLED] [TITLE: "…"], and it ends at its newline.`],
  ])
  const let_ = parse(net("LET g0 := TRUE;"))
  expect(let_.networks.flatMap((n) => n.statements)).toEqual([])
  expect(let_.diagnostics.map((d) => [d.code, d.message])).toEqual([["NETWORK_PARSE", "'g0': an item ends with `;`."]])
})

test("the header carries LABEL, DISABLED and TITLE, exact, IEC's escapes decoded", () => {
  const n = parse(net("out := a;", 'NETWORK LABEL: Done DISABLED TITLE: "Tray $"A$" ready$Nnext $$5 "')).networks[0]!
  expect(n.label?.text).toBe("Done")
  expect(n.title).toBe('Tray "A" ready\r\nnext $5 ')
  expect(n.disabled).toBe(true)
})

test("an unclosed network is NETWORK_NOT_CLOSED", () => {
  expect(codes("NETWORK\n  out := a;")).toEqual(["NETWORK_NOT_CLOSED"])
})

test("the comment is the // lines before the first statement, trailing spaces kept", () => {
  const n = parse(net("// step:  \n//\n//     indented\n// // quoted\nout := a;")).networks[0]!
  expect(n.comment).toBe("step:  \n\n    indented\n// quoted")
})

test("a finding keeps the statements read before it, and the next network is read", () => {
  const b = parse(net("x := a;\ny := (b);\nz := c;") + "\n" + net("w := d;"))
  expect(b.diagnostics.map((d) => d.code)).toEqual(["NETWORK_BAD_EXPRESSION"])
  expect(b.networks[0]!.statements.map((s) => s.kind)).toEqual(["assign"])
  expect(b.networks[1]!.statements).toHaveLength(1)
})

test("a finding stands at the token the bridge names", () => {
  const b = parse(net("x := a ADD b MUL c;"))
  const d = b.diagnostics[0]!
  expect(d.code).toBe("NETWORK_BAD_EXPRESSION")
  expect(d.message).toContain("one word is one box")
  expect(d.span.startCol).toBe(13) // `MUL`, 0-based: two spaces of indentation, then `x := a ADD b `
})

// ── splits (B6) ─────────────────────────────────────────────────────────────────────────────

test("a split is its VarId: defined once, referenced below, and listed with its references", () => {
  const b = parse(net("split175 := TRUE;\nsplit176 := split175 AND a;\nx := split176;\ny := split176 AND split175;"))
  expect(b.diagnostics).toEqual([])
  const n = b.networks[0]!
  expect(n.splits.map((s) => [s.name.text, s.varId, s.references.length])).toEqual([
    ["split175", 175, 2],
    ["split176", 176, 2],
  ])
  expect(n.statements.map((s) => s.kind)).toEqual(["split_def", "split_def", "assign", "assign"])
  expect(valueOf(n.statements[2]!).kind).toBe("split_ref")
})

test("a split beside a declaration of its name is the split; the variable is the backticked word (P1)", () => {
  const text = net("split1 := a;\nx := split1;\n`split1` := split1;")
  expect(parse(text).diagnostics).toEqual([])
  const scoped = parse(text, scope({}, [], ["split1"]))
  expect(scoped.diagnostics).toEqual([])
  expect(scoped.networks[0]!.statements.map((s) => s.kind)).toEqual(["split_def", "assign", "assign"])
})

// ── ENO and EN ──────────────────────────────────────────────────────────────────────────────

test("a box that shows ENO is read through it: one item, one tree", () => {
  const v = valueOf(only("StartAuto := MOVE 860 => AutoSpeed ENO EN go;"))
  expect(v.kind === "word" && [v.word, v.hasEno, v.readBy, v.en?.kind]).toEqual(["MOVE", true, "eno", "operand"])
  const top = valueOf(only("MOVE 860 => AutoSpeed ENO EN go;"))
  expect(top.kind === "word" && [top.hasEno, top.readBy]).toEqual([true, undefined])
  const value = valueOf(only("x := a ADD b EN go;"))
  expect(value.kind === "word" && [value.hasEno, value.readBy]).toEqual([false, "value"])
})

test("a chain: the box in the EN slot of another, laid out as a staircase or on one line, is one tree", () => {
  const stair = only("x := MOVE 3 => Q ENO EN\n       MOVE 2 => P ENO EN\n         MOVE 1 => R ENO EN c;")
  const line = only("x := MOVE 3 => Q ENO EN MOVE 2 => P ENO EN MOVE 1 => R ENO EN c;")
  const outs = (v: NetworkValue): string[] => (v.kind === "word" ? [v.outputs[0]!.text, ...(v.en !== undefined ? outs(v.en) : [])] : [])
  expect(outs(valueOf(stair))).toEqual(["Q", "P", "R"])
  expect(outs(valueOf(line))).toEqual(["Q", "P", "R"])
})

test("a continuation line no deeper than its item's first line is the missing `;`", () => {
  const b = parse(net("x := MOVE 3 => Q ENO EN\nMOVE 1 => R ENO EN c;"))
  expect(b.diagnostics.map((d) => d.message)).toEqual([
    "missing `;`? A line indented no deeper than its item's first line starts a new item, so the item before it ends with `;`.",
  ])
})

test("the empty enable is an empty slot, and the box's EN token is kept", () => {
  const v = valueOf(only("iRPM MUL 6 => oDrive EN;"))
  expect(v.kind).toBe("word")
  if (v.kind !== "word") return
  expect(v.en?.kind).toBe("empty_slot")
  expect(v.enSpan).toBeDefined()
})

// ── the parallel (B8) ───────────────────────────────────────────────────────────────────────

test("a parallel is its feed, its branches in stored order and its mode", () => {
  const v = valueOf(only("lamp := start BRANCH (a,\n                       b AND c) SHORTCIRCUIT;"))
  expect(v.kind).toBe("parallel")
  if (v.kind !== "parallel") return
  expect(v.input?.kind).toBe("operand")
  expect(v.branches.map((b) => b.kind)).toEqual(["operand", "word"])
  expect(v.shortCircuit).toBe(true)
  const unfed = valueOf(only("lamp := BRANCH (a, b);"))
  expect(unfed.kind === "parallel" && unfed.input === undefined && !unfed.shortCircuit).toBe(true)
})

// ── calls ───────────────────────────────────────────────────────────────────────────────────

test("a call box carries its type as the reader decided it: an instance's FB, an unnamed instance's type, a POU's name", () => {
  const sc = scope({ t1: "TON" })
  const call = (s: NetworkTextStatement) => {
    const v = valueOf(s)
    if (v.kind !== "call") throw new Error(v.kind)
    return v
  }
  const fb = call(only("q := t1 : TON(IN := go, PT := T#1S).Q;", sc))
  expect([fb.boxType, fb.instance, fb.output?.text, fb.readBy]).toEqual(["TON", true, "Q", "name"])
  const unnamed = call(only("??? : L_MC1P_Axis(xEnable := go);", sc))
  expect([unnamed.boxType, unnamed.unnamed, unnamed.type?.text]).toEqual(["L_MC1P_Axis", true, "L_MC1P_Axis"])
  const fn = call(only("x := LIMIT(0, v, 100);", sc))
  expect([fn.boxType, fn.instance, fn.readBy]).toEqual(["LIMIT", undefined, "value"])
  const declaredEno = call(only("ready := d1 : Dryer(iOn := on);", scope({ d1: "Dryer" })))
  expect([declaredEno.hasEno, declaredEno.readBy]).toEqual([true, "eno"])
})

test("the wired ENO pin is a target of the box, after its outputs, and no parameter of a callee", () => {
  const v = valueOf(only("MOVE 0 => x ENO => lamp EN c;"))
  expect(v.kind === "word" && v.eno?.target?.text).toBe("lamp")
  expect([...statementTargets(only("MOVE 0 => x ENO => lamp EN c;"))].map((t) => t.text)).toEqual(["x", "lamp"])
})

test("EXECUTE: its lines are ST, parsed as such", () => {
  const s = only("EXECUTE\ni := i + 1;\n  END_EXECUTE ENO EN go;")
  const v = valueOf(s)
  expect(v.kind === "execute" && v.ok && v.statements.length).toBe(1)
})

// ── the ST readings ─────────────────────────────────────────────────────────────────────────

test("a box word reads as ST's operator over its operands; MOVE as ST's MOVE call", () => {
  const add = networkValueExpr(valueOf(only("x := a ADD b ADD c;")))
  expect(add?.kind).toBe("paren")
  expect(add?.kind === "paren" && add.inner.kind === "binary" && add.inner.op).toBe("+")
  const gt = networkValueExpr(valueOf(only("x := a GT 40;")))
  expect(gt?.kind === "paren" && gt.inner.kind === "binary" && gt.inner.op).toBe(">")
  const move = networkValueExpr(valueOf(only("x := MOVE b;")))
  expect(move?.kind === "call" && move.callee.kind === "ident_expr" && move.callee.name).toBe("MOVE")
})

test("a box read through its ENO and an edge read as an opaque BOOL; a parallel has no reading", () => {
  const eno = networkValueExpr(valueOf(only("x := MOVE 1 => A ENO EN c;")))
  expect(eno?.kind === "literal" && eno.literalKind).toBe("bool")
  const edge = networkValueExpr(valueOf(only("x := R_EDGE a;")))
  expect(edge?.kind === "literal" && edge.literalKind).toBe("bool")
  expect(networkValueExpr(valueOf(only("x := s BRANCH (a, b);")))).toBeUndefined()
})

test("every operand is read once — inside a box read through its ENO, an EN source, a parallel and a box's => pins", () => {
  const s = only("lamp R= (tMul MUL height => tInt ENO EN go AND descend) BRANCH (elev GE tInt EN, down) SHORTCIRCUIT;")
  const names = statementExprs(s).flatMap(idents).sort()
  expect(names).toEqual(["descend", "down", "elev", "go", "height", "lamp", "tInt", "tInt", "tMul"].sort())
})

test("a backticked operand is ONE operand whose text is parsed as an ST expression", () => {
  const v = valueOf(only("MOVE `DINT_TO_LREAL(pos)/10` => target ENO EN go;"))
  expect(v.kind).toBe("word")
  if (v.kind !== "word") return
  const operand = v.operands[0]!
  expect(operand.kind === "operand" && operand.backticked && operand.expr?.kind).toBe("binary")
})

test("every value of a statement is walked, the boxes in EN slots included", () => {
  const s = only("x := MOVE 2 => B ENO EN\n       MOVE 1 => A ENO EN c;")
  expect([...walkValues(s)].filter((v) => v.kind === "word").length).toBe(2)
})

test("the structure-only reader asks the declarations nothing", () => {
  expect(codes(net("q := t1 : TON(IN := go).Q;"))).toEqual([])
})

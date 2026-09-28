/**
 * The network text v2 parser (openspec network-text-literal-nwl 5.1): one statement per vendor item, the per-network
 * `VAR_TEMP` wire block, chained targets, backticks, `.ENO`, `=> v`, EN on any call, `R_EDGE`/`F_EDGE`, structural
 * parentheses, `PARALLEL`, `value;`, `END_IF;`/`END_EXECUTE;` and EXECUTE's value form — each raising the bridge
 * reader's finding where the bridge raises it (`NetworkTextReaderTests`, `NetworkTextGateTests` in volt-cli).
 */
import { expect, test } from "bun:test"
import { type BodySpan, type Expr, isGraphicalBody, parseSource, unitBodies, walkExpr } from "../syntax/index.js"
import { type NetworkScopeView, STRUCTURE_ONLY, parseNetworkText } from "./parser.js"
import { networkValueExpr, statementExprs } from "./exprs.js"
import type { NetworkTextBody, NetworkTextStatement, NetworkValue } from "./ast.js"

/** A POU whose graphical body is `networks`, under the line stating LD. */
function body(networks: string, marker = "IMPLEMENTATION LD"): BodySpan {
  const src = `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\n${marker}\n${networks}\nEND_FUNCTION_BLOCK\n`
  const b = unitBodies(parseSource(src).units[0]!).find(isGraphicalBody)
  if (b === undefined) throw new Error("no graphical body")
  return b
}
const parse = (networks: string): NetworkTextBody => parseNetworkText(body(networks), STRUCTURE_ONLY)
const net = (statements: string, header = "NETWORK"): string => `${header}\n${statements}\nEND_NETWORK`
const codes = (networks: string): string[] => parse(networks).diagnostics.map((d) => d.code)
const clean = (networks: string): NetworkTextStatement[] => {
  const b = parse(networks)
  expect(b.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([])
  return b.networks.flatMap((n) => n.statements)
}
const only = (statements: string): NetworkTextStatement => {
  const s = clean(net(statements))
  expect(s).toHaveLength(1)
  return s[0]!
}
const valueOf = (s: NetworkTextStatement): NetworkValue => {
  if (s.kind === "assign" || s.kind === "wire_def" || s.kind === "value") return s.value
  throw new Error(`no value on a ${s.kind}`)
}
const idents = (e: Expr | undefined): string[] => {
  const out: string[] = []
  if (e !== undefined) walkExpr(e, (x) => x.kind === "ident_expr" && out.push(x.name))
  return out
}

// ── the body and its header ─────────────────────────────────────────────────────────────────

test("the line states the language and a network has no order number", () => {
  const b = parse(net("out := a;"))
  expect(b.language).toBe("LD")
  expect(b.networks).toHaveLength(1)
  expect(b.networks[0]!.index).toBe(0)
  expect(parseNetworkText(body(net("out := a;"), "IMPLEMENTATION FBD"), STRUCTURE_ONLY).language).toBe("FBD")
})

test("v1 text is refused naming a re-pull, never read", () => {
  // v1 under the line stating LD — what a clean merge makes of an un-pushed v1 edit: the line decides the reader, and
  // the reader refuses v1 once, by name, reading no statement of it. (The bare comment marker that used to head a v1
  // body is no boundary any more: such a body is ST to this server, and the older-format manifest says re-pull.)
  const v1 = parseNetworkText(body("NETWORK 0 LD\n  LET g0 := TRUE;\nEND_NETWORK"), STRUCTURE_ONLY)
  expect(v1.networks.flatMap((n) => n.statements)).toEqual([])
  expect(v1.diagnostics.map((d) => d.code)).toEqual(["NETWORK_PARSE"])
  expect(v1.diagnostics[0]!.message).toContain("re-pull")
  // …and inside a v2 body, a LET statement or a numbered header is v1 too.
  expect(parse(net("LET g0 := TRUE;")).diagnostics[0]!.message).toContain("re-pull")
  expect(parse("NETWORK 3 LD\n  out := a;\nEND_NETWORK").diagnostics[0]!.message).toContain("re-pull")
})

test("the header carries LABEL, TITLE and DISABLED, and a title spells ST's escapes", () => {
  const n = parse(net("out := a;", 'NETWORK LABEL: Done TITLE: "Tray $"A$" ready$Nnext $$5" DISABLED')).networks[0]!
  expect(n.label?.text).toBe("Done")
  expect(n.title).toBe('Tray "A" ready\nnext $5')
  expect(n.disabled).toBe(true)
})

test("the header ends at its newline: DISABLED on the next line is a statement", () => {
  const s = clean(net("DISABLED := a;"))
  expect(parse(net("DISABLED := a;")).networks[0]!.disabled).toBe(false)
  expect(s[0]!.kind).toBe("assign")
})

test("a header field twice, or a word the header does not hold, is refused", () => {
  expect(codes(net("out := a;", "NETWORK LABEL: a LABEL: b"))).toEqual(["NETWORK_PARSE"])
  expect(codes(net("out := a;", "NETWORK LD"))).toEqual(["NETWORK_PARSE"])
})

test("the comment is the // lines before the first statement, and one after a statement is refused", () => {
  const n = parse(net("// step:\n//\n//     indented\n// // quoted\nout := a;")).networks[0]!
  expect(n.comment).toBe("step:\n\n    indented\n// quoted")
  expect(codes(net("out := a;\n// trailing"))).toEqual(["NETWORK_PARSE"])
})

test("an unclosed network is NETWORK_NOT_CLOSED", () => {
  expect(codes("NETWORK\n  out := a;\n")).toEqual(["NETWORK_NOT_CLOSED"])
})

// ── wires ───────────────────────────────────────────────────────────────────────────────────

test("a VAR_TEMP wire is defined by assignment and referenced bare", () => {
  const b = parse(net("VAR_TEMP g0, g1 : BOOL; END_VAR\ng0 := TRUE;\ng1 := (g0 AND a);\nout := g1;"))
  expect(b.diagnostics).toEqual([])
  const n = b.networks[0]!
  expect(n.wires.map((w) => `${w.name.text}:${w.typeText}`)).toEqual(["g0:BOOL", "g1:BOOL"])
  expect(n.statements.map((s) => s.kind)).toEqual(["wire_def", "wire_def", "assign"])
  expect(valueOf(n.statements[2]!).kind).toBe("wire_ref")
  expect(n.wires[1]!.definition).toBe(n.statements[1] as never)
})

test("the block may run across lines, and its type is parsed", () => {
  const n = parse(net("VAR_TEMP\n  g1 : BOOL;\n  g2 : STRING (80);\nEND_VAR\ng1 := a;\ng2 := s;\nout := g1;")).networks[0]!
  expect(n.wires.map((w) => w.typeText)).toEqual(["BOOL", "STRING (80)"])
  expect(n.wires[0]!.type?.kind).toBe("named_type")
})

test("an undeclared assignment is a coil on a variable, never a wire", () => {
  const s = only("g5 := a;")
  expect(s.kind).toBe("assign")
})

const WIRE_MISUSE: ReadonlyArray<[string, string, string]> = [
  ["declared, never defined", "VAR_TEMP g1 : BOOL; END_VAR\nout := a;", "NETWORK_BAD_EXPRESSION"],
  ["referenced before its definition", "VAR_TEMP g1 : BOOL; END_VAR\nout := g1;\ng1 := a;", "NETWORK_BAD_EXPRESSION"],
  ["defined with S=", "VAR_TEMP g1 : BOOL; END_VAR\ng1 S= a;", "NETWORK_BAD_EXPRESSION"],
  ["defined inside a chain", "VAR_TEMP g1 : BOOL; END_VAR\ng1 := out := a;", "NETWORK_BAD_EXPRESSION"],
  ["not named g<digits>", "VAR_TEMP speed : BOOL; END_VAR\nout := a;", "NETWORK_BAD_EXPRESSION"],
  ["a second block", "VAR_TEMP g1 : BOOL; END_VAR\ng1 := a;\nVAR_TEMP g2 : BOOL; END_VAR", "NETWORK_BAD_EXPRESSION"],
  ["declared twice", "VAR_TEMP g1, G1 : BOOL; END_VAR\ng1 := a;", "NETWORK_DUPLICATE_NAME"],
  ["defined twice", "VAR_TEMP g1 : BOOL; END_VAR\ng1 := a;\ng1 := b;", "NETWORK_DUPLICATE_NAME"],
  ["also spelled as a call head", "VAR_TEMP g1 : BOOL; END_VAR\ng1 := a;\n`g1`(x);", "NETWORK_DUPLICATE_NAME"],
]
for (const [what, statements, code] of WIRE_MISUSE)
  test(`a wire ${what} is ${code}`, () => {
    expect(codes(net(statements))).toContain(code)
  })

// ── statements ──────────────────────────────────────────────────────────────────────────────

test("a chained assignment is ONE assign with its targets and storage in order", () => {
  const s = only("x :=\ny S=\nz R= v;")
  expect(s.kind).toBe("assign")
  if (s.kind === "assign") {
    expect(s.targets.map((t) => `${t.op} ${t.text}`)).toEqual([":= x", "S= y", "R= z"])
    expect(idents(s.targets[1]!.expr)).toEqual(["y"])
  }
})

test("S= is the storage operator after a target however spaced, and a comparison inside a group", () => {
  const s = only("x S = a;")
  expect(s.kind === "assign" && s.targets[0]!.op).toBe("S=")
  const g = valueOf(only("out := (R = x);"))
  expect(g.kind === "group" && g.op).toBe("=")
})

test("a top-level value, the empty item, and the IF form each are one statement", () => {
  expect(clean(net("MOVE(EN := a, b);\n;\nIF a THEN JMP Done; END_IF;\nRETURN;")).map((s) => s.kind)).toEqual([
    "value",
    "empty",
    "jump",
    "return",
  ])
})

test("END_IF without its ; is NETWORK_PARSE, and a statement without ; too", () => {
  expect(codes(net("IF a THEN JMP Done; END_IF"))).toEqual(["NETWORK_PARSE"])
  expect(codes(net("out := a"))).toEqual(["NETWORK_PARSE"])
})

test("after JMP a word of the text is the label", () => {
  const s = only("JMP Execute;")
  expect(s.kind === "jump" && s.target.text).toBe("Execute")
})

// ── values ──────────────────────────────────────────────────────────────────────────────────

test("a backticked operand is ONE operand whose text is parsed as an ST expression", () => {
  const v = valueOf(only("P := `fc_dinttotime(T.Start,2)`;"))
  expect(v.kind).toBe("operand")
  if (v.kind === "operand") {
    expect(v.backticked).toBe(true)
    expect(v.expr?.kind).toBe("call")
    expect(idents(v.expr)).toEqual(["fc_dinttotime", "T", "Start"])
  }
})

test("a backticked target and a backticked call head", () => {
  const s = only("`arr[i + 1]` := `Network`(x);")
  expect(s.kind).toBe("assign")
  if (s.kind === "assign") {
    expect(s.targets[0]!.expr?.kind).toBe("index")
    expect(s.value.kind === "call" && s.value.head.text).toBe("Network")
  }
})

test("a keyword of the text at operand position is refused unless backticked", () => {
  expect(codes(net("out := Let;"))).toContain("NETWORK_BAD_EXPRESSION")
  expect(codes(net("out := `Let`;"))).toEqual([])
})

test("EN is a pin of any call, `EN := ,` an unwired one, and .ENO a suffix", () => {
  const v = valueOf(only("lamp := MOVE(EN := c, 0, => Status).ENO;"))
  expect(v.kind).toBe("call")
  if (v.kind === "call") {
    expect(v.eno).toBe(true)
    expect(v.pins.map((p) => `${p.kind}:${p.name?.text ?? ""}`)).toEqual(["input:EN", "input:", "output:"])
  }
  const u = valueOf(only("out := GE(EN := , a, b);"))
  expect(u.kind === "call" && u.pins[0]!.kind === "input" && u.pins[0]!.value.kind).toBe("empty_slot")
  expect(clean(net("Prog(EN := go);"))[0]!.kind).toBe("value")
})

test(".ENO on a box nothing consumes is NETWORK_BAD_EXPRESSION, as is ENO =>", () => {
  expect(codes(net("MOVE(EN := c, 0).ENO;"))).toEqual(["NETWORK_BAD_EXPRESSION"])
  expect(codes(net("f(ENO => x);"))).toEqual(["NETWORK_BAD_EXPRESSION"])
})

test("=> v fills an output slot, a named pin names one, and a bare => passes one over", () => {
  const v = valueOf(only("t1(IN := a, PT := pt, ET => el, => , => q);"))
  expect(v.kind === "call" && v.pins.map((p) => (p.kind === "output" ? `${p.name?.text ?? "_"}=>${p.target?.text ?? ""}` : "in"))).toEqual([
    "in",
    "in",
    "ET=>el",
    "_=>",
    "_=>q",
  ])
})

test("edges are flags on their operand, NOT inside, and nested edges or NOT outside refused", () => {
  const e = valueOf(only("MOVE(EN := R_EDGE(bStart), 1, => nMode);"))
  expect(e.kind === "call" && e.pins[0]!.kind === "input" && e.pins[0]!.value.kind).toBe("edge")
  const f = valueOf(only("out := F_EDGE(NOT x);"))
  expect(f.kind === "edge" && !f.rising && f.operand.kind).toBe("not")
  expect(codes(net("out := NOT R_EDGE(x);"))).toEqual(["NETWORK_BAD_EXPRESSION"])
  expect(codes(net("out := R_EDGE(F_EDGE(x));"))).toEqual(["NETWORK_UNSUPPORTED"])
  expect(codes(net("out := R_EDGE(NOT NOT x);"))).toEqual(["NETWORK_BAD_EXPRESSION"])
})

test("a flag on a wire reference, a Parallel or an empty slot is NETWORK_UNSUPPORTED", () => {
  expect(codes(net("VAR_TEMP g3 : BOOL; END_VAR\ng3 := a;\nout := NOT g3;"))).toEqual(["NETWORK_UNSUPPORTED"])
  expect(codes(net("out := NOT PARALLEL(a, b);"))).toEqual(["NETWORK_UNSUPPORTED"])
  expect(codes(net("f(NOT , a);"))).toEqual(["NETWORK_UNSUPPORTED"])
})

test("parentheses are structural: the NOT box, the modifier, and a pair that is no box", () => {
  const kinds = clean(net("o1 := NOT(a);\no2 := NOT a;\no3 := NOT (a AND b);\no4 := NOT((a AND b));\no5 := NOT (a);")).map((s) => {
    const v = valueOf(s)
    return v.kind === "not" ? `not ${v.operand.kind}` : v.kind === "call" ? `call ${v.head.text}` : v.kind
  })
  expect(kinds).toEqual(["call NOT", "not operand", "not group", "call NOT", "call NOT"])
  expect(codes(net("out := ((a AND b));"))).toEqual(["NETWORK_BAD_EXPRESSION"])
})

test("an operator word before a group is the operator after an empty slot, before a pin list a call head", () => {
  const g = valueOf(only("out := ( AND (x OR y));"))
  expect(g.kind === "group" && g.operands.map((o) => o.kind)).toEqual(["empty_slot", "group"])
  const c = valueOf(only("AND(EN := go, a, b, => out);"))
  expect(c.kind === "call" && c.head.text).toBe("AND")
})

test("one operator kind per group, and an unknown operator named", () => {
  expect(codes(net("out := (a AND b OR c);"))).toEqual(["NETWORK_BAD_EXPRESSION"])
  expect(codes(net("out := (a ^ b);"))).toContain("NETWORK_UNKNOWN_OPERATOR")
})

test("PARALLEL is its own value: fed, unfed, a measured MODE, and IN := , refused", () => {
  const p = valueOf(only("ResetSafetyGuard S= PARALLEL(IN := g54x, StartFlag, tReset);"))
  expect(p.kind === "parallel" && [p.input?.kind, p.branches.length]).toEqual(["operand", 2])
  const q = valueOf(only("out := PARALLEL(MODE := Sequential, IN := f, a, b);"))
  expect(q.kind === "parallel" && q.mode?.text).toBe("Sequential")
  expect(codes(net("out := PARALLEL(IN := , a, b);"))).toEqual(["NETWORK_UNSUPPORTED"])
  expect(codes(net("out := PARALLEL(MODE := Other, a, b);"))).toEqual(["NETWORK_UNSUPPORTED"])
})

test("EXECUTE: a statement, the empty body, and the value form, its lines parsed as ST", () => {
  const b = parse(net("EXECUTE(EN := bRun)\nIF bStart THEN\n\ttarget := 40 + 2;\nEND_IF\n  END_EXECUTE;\nEXECUTE\n\n  END_EXECUTE;\nout := EXECUTE\nx := 1;\n  END_EXECUTE.ENO;"))
  expect(b.diagnostics).toEqual([])
  const values = b.networks[0]!.statements.map(valueOf)
  expect(values.map((v) => v.kind === "execute" && [v.en !== undefined, v.ok, v.eno, v.statements.length])).toEqual([
    [true, true, false, 1],
    [false, true, false, 0],
    [false, true, true, 1],
  ])
  expect(codes(net("out := EXECUTE\nx := 1;\n  END_EXECUTE;"))).toEqual(["NETWORK_BAD_EXPRESSION"])
  expect(codes(net("EXECUTE\nx := 1;\n  END_EXECUTE"))).toEqual(["NETWORK_PARSE"])
})

test("a snippet line starting with Network is snippet text, not a header", () => {
  expect(clean(net("EXECUTE\nNetworkState := 1;\n  END_EXECUTE;"))).toHaveLength(1)
})

test("??? : TYPE(…) is an unnamed instance call, and ??? an operand or a target", () => {
  const v = valueOf(only("??? : TON(IN := a, PT := t);"))
  expect(v.kind === "call" && v.unnamedType?.text).toBe("TON")
  const s = only("??? := a;")
  expect(s.kind === "assign" && s.targets[0]!.unnamed).toBe(true)
})

test("a backticked head that is no name, or a POU named like a construct, is NETWORK_UNSUPPORTED", () => {
  expect(codes(net("`fbs[1]`(IN := a);"))).toEqual(["NETWORK_UNSUPPORTED"])
  expect(codes(net("`R_EDGE`(x);"))).toEqual(["NETWORK_UNSUPPORTED"])
})

// ── the ST reading ──────────────────────────────────────────────────────────────────────────

// An edge and a box read through `.ENO` have a reading: spec 5.1 types `R_EDGE`/`F_EDGE` BOOL→BOOL and `.ENO` BOOL (their
// typing is held in network/network.test.ts). Only a Parallel and a group with an empty slot have none.
test("a group, a NOT, a call, an edge and an .ENO have an ST reading; a Parallel and an empty slot do not", () => {
  const read = (statements: string) => networkValueExpr(valueOf(only(statements)))?.kind
  expect(read("out := ((a AND b) OR c);")).toBe("paren")
  expect(read("out := NOT a;")).toBe("unary")
  expect(read("out := MAX(a, b);")).toBe("call")
  expect(read("out := R_EDGE(a);")).toBeDefined()
  expect(read("out := MOVE(EN := c, 0, => s).ENO;")).toBeDefined()
  expect(read("out := PARALLEL(a, b);")).toBeUndefined()
  expect(read("out := ( * a);")).toBeUndefined()
})

test("every operand is read once, inside the constructs ST cannot spell", () => {
  const names = (statements: string) => statementExprs(only(statements)).flatMap(idents)
  expect(names("out := PARALLEL(IN := f, R_EDGE(a), (b AND c));").sort()).toEqual(["a", "b", "c", "f", "out"])
  expect(names("AND(EN := go, x, y, => q);").sort()).toEqual(["go", "q", "x", "y"])
  expect(names("lamp := MOVE(EN := c, R_EDGE(e), => s).ENO;").sort()).toEqual(["EN", "MOVE", "c", "e", "lamp", "s"]) // the pin name is a param ident, as in ST
})

// ── section-5 review: where the LSP read text otherwise than the bridge reader ─────────────────────

/** A scope as the parser asks it — the bridge's `NetworkScope.Contains` / `IsPou` / `InstanceType`: `pous` are POUs,
 *  `instances` maps an FB instance to its FB type. */
const scope = (pous: string[], names: string[] = [], instances: Record<string, string> = {}): NetworkScopeView => {
  const has = (list: string[], n: string) => list.some((c) => c.toUpperCase() === n.toUpperCase())
  const inst = (n: string) => Object.entries(instances).find(([k]) => k.toUpperCase() === n.toUpperCase())?.[1]
  return {
    isPou: (n) => has(pous, n),
    instanceType: inst,
    contains: (n) => has([...pous, ...names, ...Object.keys(instances)], n),
  }
}
const scoped = (networks: string, sc: NetworkScopeView): string[] =>
  parseNetworkText(body(networks), sc).diagnostics.map((d) => `${d.code}: ${d.message}`)

test("an operator head's argument list holding an EXECUTE box whose ST holds an operator word is a call", () => {
  // The bridge writer's own text: its reader accepts it, because the look-ahead walks THROUGH the EXECUTE body.
  const b = parse(
    "NETWORK\n  out := AND(EN := go, EXECUTE\n  x := a AND b;\n  END_EXECUTE.ENO, c);\nEND_NETWORK\nNETWORK\n  y := a;\nEND_NETWORK",
  )
  expect(b.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([])
  expect(b.networks.map((n) => n.statements.length)).toEqual([1, 1])
  const v = valueOf(b.networks[0]!.statements[0]!)
  expect(v.kind === "call" && [v.head.text, v.pins.length]).toEqual(["AND", 3])
})

test("a wire's VarId out of the vendor's range is refused, as the bridge's int parse refuses it", () => {
  expect(parse(net("VAR_TEMP g99999999999 : BOOL; END_VAR\ng99999999999 := a;\nout := g99999999999;")).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
    "NETWORK_BAD_EXPRESSION: the wire g99999999999 carries a VarId out of range.",
  ])
  expect(codes(net("VAR_TEMP g2147483647 : BOOL; END_VAR\ng2147483647 := a;\nout := g2147483647;"))).toEqual([])
  expect(codes(net("VAR_TEMP g2147483648 : BOOL; END_VAR\ng2147483648 := a;\nout := g2147483648;"))).toEqual(["NETWORK_BAD_EXPRESSION"])
})

test("an output pin's target records no storage operator: the text holds `=>`, not `:=`", () => {
  const v = valueOf(only("t1(IN := a, Q => out, => q);"))
  expect(v.kind === "call" && v.pins.flatMap((p) => (p.kind === "output" ? [p.target?.op] : []))).toEqual([undefined, undefined])
  const s = only("x := y S= a;")
  expect(s.kind === "assign" && s.targets.map((t) => t.op)).toEqual([":=", "S="])
})

test("a POU or instance named like a construct is refused at the call, whatever its argument list", () => {
  for (const [statement, word] of [
    ["R_EDGE(IN := a, PT := T#1S);", "R_EDGE"],
    ["o := F_EDGE(a, b);", "F_EDGE"],
    ["o := r_edge(a);", "R_EDGE"],
    ["PARALLEL(x := 1);", "PARALLEL"],
  ] as const) {
    const got = scoped(net(statement), scope([word]))
    expect(got).toHaveLength(1)
    expect(got[0]).toStartWith(`NETWORK_UNSUPPORTED: a POU or instance named ${word}:`)
  }
  // A VARIABLE of that name is no reason — it never heads a call.
  expect(scoped(net("o := R_EDGE(a);"), scope([], ["R_EDGE"]))).toEqual([])
})

test("a bare wire-shaped name no VAR_TEMP and no scope declares is refused; backticked it is the variable", () => {
  const sc = scope(["f"], ["out", "x"])
  const refusal = "NETWORK_BAD_EXPRESSION: 'g5' is shaped like a wire and is declared neither in this network's VAR_TEMP block nor in scope."
  for (const statement of ["out := g5;", "g5 := x;", "f(x, => g5);", "out := (x AND g5);"])
    expect(scoped(net(statement), sc)).toEqual([refusal])
  expect(scoped(net("out := `g5`;"), sc)).toEqual([])
  expect(scoped(net("out := g5;"), scope(["f"], ["out", "g5"]))).toEqual([])
})

test("a wire named like a name in scope is NETWORK_DUPLICATE_NAME", () => {
  expect(scoped(net("VAR_TEMP g1 : BOOL; END_VAR\ng1 := a;\nout := g1;"), scope([], ["G1", "out", "a"]))).toEqual([
    "NETWORK_DUPLICATE_NAME: the wire g1 names a variable in scope (case-insensitively); the writer would have named it the lowest free g<n>.",
  ])
})

// ── section-5 second review ────────────────────────────────────────────────────────────────────

test("the scope is an explicit argument: structure-only is a value, never an omitted one", () => {
  // A reader of the statements that forgot the POU's scope lost the three scope findings without a trace; the type
  // now refuses the omission (the bridge's `NetworkScope.Empty`, "explicit, never a default").
  // @ts-expect-error — the scope is required
  expect(() => parseNetworkText(body(net("out := a;")))).not.toThrow()
  expect(parseNetworkText(body(net("out := g5;")), STRUCTURE_ONLY).diagnostics).toEqual([])
  expect(scoped(net("out := g5;"), scope([], ["out"]))).toEqual([
    "NETWORK_BAD_EXPRESSION: 'g5' is shaped like a wire and is declared neither in this network's VAR_TEMP block nor in scope.",
  ])
})

test("a call of an instance is typed by the instance's FB: one whose FB is named like a construct is refused", () => {
  const sc = scope(["R_EDGE", "TMR"], ["a"], { e1: "R_EDGE", R_EDGE: "TMR" })
  expect(scoped(net("e1(CLK := a);"), sc)).toEqual([
    "NETWORK_UNSUPPORTED: a POU named R_EDGE: the text reads R_EDGE(…) as its own construct, so a call of it has no spelling.",
  ])
  expect(scoped(net("`R_EDGE`(IN := a);"), sc)).toEqual([
    "NETWORK_UNSUPPORTED: an instance named R_EDGE: the text reads it as its own construct.",
  ])
})

test("the line may end in blanks, as the bridge's line may", () => {
  const b = parseNetworkText(body(net("out := a;"), "IMPLEMENTATION FBD \t"), STRUCTURE_ONLY)
  expect([b.language, b.diagnostics, b.networks.map((n) => n.statements.length)]).toEqual(["FBD", [], [1]])
})

test("a call box carries its type as the reader decided it: an instance's FB, an unnamed instance's type, a POU's name", () => {
  // The fact lived in a side table keyed by the node, read back with a fallback to the HEAD: a call built anywhere but
  // parseCall would have been typed by its instance name — `t1`, not its FB — silently.
  const sc = scope(["F_Scale"], ["a", "x", "out"], { t1: "TON" })
  const call = (statements: string) => {
    const b = parseNetworkText(body(net(statements)), sc)
    expect(b.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([])
    const v = valueOf(b.networks[0]!.statements[0]!)
    if (v.kind !== "call") throw new Error(`no call: ${v.kind}`)
    return v
  }
  expect(call("t1(IN := a);").boxType).toBe("TON")
  expect(call("out := F_Scale(x);").boxType).toBe("F_Scale")
  expect(call("??? : TOF(IN := a);").boxType).toBe("TOF")
})

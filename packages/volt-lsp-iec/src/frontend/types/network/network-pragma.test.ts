/**
 * The pragma (openspec ld-fbd-coverage 2.3): `{Member := value}` after a box, read as the bridge reads it
 * (`NetworkPragmaTests` in volt-cli) — the literal, the member table, and the reader's refusals by name.
 */
import { expect, test } from "bun:test"
import {
  type BodySpan,
  type NetworkTextBody,
  isGraphicalBody,
  parsePragma,
  parseSource,
  pragmaStrings,
  spell,
  STRUCTURE_ONLY,
  unitBodies,
} from "../../syntax/index.js"
import { parseNetworkText } from "./network-parse.js"

function body(statements: string): BodySpan {
  const src =
    "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n\tt1 : TON;\nEND_VAR\nIMPLEMENTATION FBD\n" +
    `NETWORK\n${statements}\nEND_NETWORK\nEND_FUNCTION_BLOCK\n`
  const b = unitBodies(parseSource(src, { networkText: true }, "codesys").units[0]!).find(isGraphicalBody)
  if (b === undefined) throw new Error("no graphical body")
  return b
}
const parse = (statements: string): NetworkTextBody => parseNetworkText(body(statements), STRUCTURE_ONLY, "codesys")

test("a pragma's literal reads back as it is spelled", () => {
  for (const spelled of [
    "{OutputParam.Names := ['']}",
    "{OutputParam.Names := ['Q', 'ET']}",
    "{CallType := FunctionBlock}",
    "{EN := FALSE}",
    "{BranchCounter := 328}",
    "{SymbolComment := 'it$'s $$5$N$R$T$01'}",
    "{OutputParam.Names := []}",
  ]) {
    const p = parsePragma(spelled.slice(1, -1))
    if ("error" in p) throw new Error(p.error)
    expect(`{${p.member} := ${spell(p.value)}}`).toBe(spelled)
  }
})

test("a string keeps every character", () => {
  const p = parsePragma("SymbolComment := 'it$'s $$5$N$R$T$01 é'")
  if ("error" in p) throw new Error(p.error)
  expect(p.value).toEqual({ kind: "text", text: "it's $5\n\r\t\u0001 é" })
})

test("a malformed pragma is refused by name", () => {
  for (const [inner, why] of [
    ["OutputParam.Names ['']", "no `:=`"],
    ["1x := 2", "no member name"],
    ["A := ", "no value"],
    ["A := 'open", "unclosed string"],
    ["A := [1, [2]]", "a list inside a list"],
    ["A := 1 2", "one member and one value"],
    // `$hh` is exactly two hex digits, as the bridge reads it (gate 2-3 review: C# once took `'$A '` as a line feed).
    ["A := ['$A ']", "the escape '$A'"],
    ["A := ['$ A']", "the escape '$ '"],
    ["A := ['$+1']", "the escape '$+'"],
  ] as const) {
    const p = parsePragma(inner)
    expect("error" in p ? p.error : "").toContain(why)
  }
})

test("S1: a bit operator's stored output reads as its pragmas, on the group", () => {
  const b = parse("  out := (a AND b){OutputParam.Names := ['']}{OutputParam.Types := ['BOOL']};")
  expect(b.diagnostics).toEqual([])
  const s = b.networks[0]!.statements[0]!
  if (s.kind !== "assign" || s.value.kind !== "group") throw new Error("not a group")
  expect(pragmaStrings(s.value.pragmas, "OutputParam.Names")).toEqual([""])
  expect(pragmaStrings(s.value.pragmas, "OutputParam.Types")).toEqual(["BOOL"])
})

test("a call's pragmas stand before its suffix, an Execute box's after END_EXECUTE", () => {
  const b = parse(
    "  out := t1(IN := a){OutputParam.Names := ['Q', 'ET']}{OutputParam.Types := ['BOOL', 'TIME']};\n" +
      "  out := t1(IN := a){OutputParam.Names := ['Q', 'ET']}.ENO;\n" +
      "  EXECUTE\n  a := b;\n  END_EXECUTE{OutputParam.Names := ['ENO']};",
  )
  expect(b.diagnostics).toEqual([])
  const [first, second, third] = b.networks[0]!.statements
  if (first?.kind !== "assign" || first.value.kind !== "call") throw new Error("not a call")
  expect(pragmaStrings(first.value.pragmas, "OutputParam.Names")).toEqual(["Q", "ET"])
  if (second?.kind !== "assign" || second.value.kind !== "call") throw new Error("not a call")
  expect(second.value.eno).toBe(true)
  if (third?.kind !== "value" || third.value.kind !== "execute") throw new Error("not an execute")
  expect(pragmaStrings(third.value.pragmas, "OutputParam.Names")).toEqual(["ENO"])
})

test("a pragma the member table does not hold is refused by name, with the bridge's code", () => {
  for (const [statement, code, why] of [
    ["  out := (a AND b){Nonsense := 1};", "NETWORK_UNSUPPORTED", "no member of a box"],
    ["  out := (a AND b){OutputParam.Names := 1};", "NETWORK_BAD_EXPRESSION", "takes a list of strings"],
    ["  out := (a AND b){OutputParam.Names := [1]};", "NETWORK_BAD_EXPRESSION", "takes a list of strings"],
    ["  out := (a AND b){OutputParam.Names := ['']}{OutputParam.Names := ['']};", "NETWORK_DUPLICATE_NAME", "twice"],
    ["  out := (a AND b){OutputParam.Names ['']};", "NETWORK_PARSE", "no `:=`"],
    ["  out := (a AND b){OutputParam.Names := [''];", "NETWORK_PARSE", "unclosed pragma"],
  ] as const) {
    const d = parse(statement).diagnostics[0]
    expect(d?.code).toBe(code)
    expect(d?.message).toContain(why)
  }
})

test("a stored output type the pragma spells types the wire its box feeds", () => {
  // A plain AND stores no slot, so its stored DINT is the pragma's — and the wire's declared type agrees with it.
  const b = parse("  VAR_TEMP g1 : DINT; END_VAR\n  g1 := (a AND b){OutputParam.Types := ['DINT']};\n  out := g1;")
  expect(b.diagnostics).toEqual([])
  // Without it, the rule reads a bit operator as a bit string, which DINT is not.
  expect(parse("  VAR_TEMP g1 : DINT; END_VAR\n  g1 := (a AND b);\n  out := g1;").diagnostics.map((d) => d.code)).toEqual([
    "NETWORK_BAD_EXPRESSION",
  ])
})

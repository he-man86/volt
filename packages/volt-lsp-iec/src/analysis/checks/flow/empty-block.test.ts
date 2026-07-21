/**
 * empty-block — C0013 + C0426. An empty control-flow block or CASE arm. Wording verified live against
 * CODESYS 3.5.21: "At least one statement is expected" (no trailing period — the doc wording had drifted).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

function eb(body: string) {
  const src = `PROGRAM PLC_PRG\nVAR b : BOOL; i : INT; END_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter(
    (d) => d.code === "empty-block",
  )
}

test("an empty IF-THEN body is flagged, byte-identical to CODESYS", () => {
  const d = eb("IF b THEN\nEND_IF")
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("error")
  expect(d[0]?.message).toBe("At least one statement is expected")
})

test("empty ELSIF / ELSE / FOR / WHILE / REPEAT bodies are each flagged", () => {
  expect(eb("IF b THEN i := 1; ELSIF b THEN\nEND_IF")).toHaveLength(1)
  expect(eb("IF b THEN i := 1; ELSE\nEND_IF")).toHaveLength(1)
  expect(eb("FOR i := 0 TO 3 DO\nEND_FOR")).toHaveLength(1)
  expect(eb("WHILE b DO\nEND_WHILE")).toHaveLength(1)
  expect(eb("REPEAT\nUNTIL b\nEND_REPEAT")).toHaveLength(1)
})

test("an empty CASE arm is flagged (C0426); comma fall-through is not", () => {
  expect(eb("CASE i OF\n1:\n2: i := 1;\nEND_CASE")).toHaveLength(1) // separate empty label → error
  expect(eb("CASE i OF\n1, 2: i := 1;\nEND_CASE")).toEqual([]) // comma-shared body → legal
})

test("a lone `;` satisfies the body (parses to an empty statement) — not flagged", () => {
  expect(eb("IF b THEN\n;\nEND_IF")).toEqual([])
})

test("a comment-only body is legal in CODESYS — not flagged (the FP guard)", () => {
  expect(eb("IF b THEN\n// placeholder\nEND_IF")).toEqual([])
  expect(eb("IF b THEN\n(* todo *)\nEND_IF")).toEqual([])
})

test("non-empty bodies are never flagged", () => {
  expect(eb("IF b THEN i := 1; END_IF")).toEqual([])
  expect(eb("FOR i := 0 TO 3 DO i := i; END_FOR")).toEqual([])
})

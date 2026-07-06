/**
 * Error-tolerance fuzz (A.3 gate). The parser must NEVER throw — on any input it returns
 * `{ units, errors }`. Deterministic mutation sweep (no RNG, so failures reproduce):
 * every prefix truncation and every single-character deletion of representative sources.
 */
import { test, expect } from "bun:test"
import { parseSource, parseStatements, lex } from "../src/syntax/index.js"

const SAMPLES = [
  `FUNCTION_BLOCK FB EXTENDS Base VAR n : INT(0..9) := 3; a : ARRAY[0..2] OF REAL; END_VAR n := n + 1; END_FUNCTION_BLOCK`,
  `TYPE E : (A := 0, B, C) DINT; END_TYPE`,
  `PROGRAM P VAR s : STRING(80); END_VAR IF s = '' THEN RETURN; END_IF END_PROGRAM`,
  `INTERFACE I METHOD M : BOOL VAR_INPUT x : INT; END_VAR END_METHOD END_INTERFACE`,
]

function mutations(src: string): string[] {
  const out: string[] = []
  for (let i = 0; i <= src.length; i++) out.push(src.slice(0, i)) // prefixes
  for (let i = 0; i < src.length; i++) out.push(src.slice(0, i) + src.slice(i + 1)) // single deletions
  return out
}

test("parseSource never throws on mutated input", () => {
  for (const sample of SAMPLES) {
    for (const m of mutations(sample)) {
      expect(() => parseSource(m)).not.toThrow()
    }
  }
})

test("parseStatements never throws on mutated bodies", () => {
  for (const sample of SAMPLES) {
    for (const m of mutations(sample)) {
      const tokens = lex(m).filter((t) => t.kind !== "eof")
      const span = { start: 0, end: m.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
      expect(() => parseStatements({ kind: "body", tokens, span })).not.toThrow()
    }
  }
})

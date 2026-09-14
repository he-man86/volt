/**
 * Operator coverage — every operator the grammar accepts appears in at least one conformance fixture.
 *
 * Why this exists: the replay (replay.test.ts) fails only on a FALSE POSITIVE, and its agreement ratchet only counts
 * fixtures that already exist. A construct with no fixture is therefore invisible to both — and the corpus cannot
 * help, since real projects do not contain invalid code. That is how `**` (not an operator in CODESYS) and chained
 * `S=`/`R=` (valid, but rejected by our parser) went unnoticed until the transpiler's execution oracle compiled them.
 * When this was first measured (2026-09-14), `/`, `<=`, `&`, `XOR`, `AND_THEN` and `OR_ELSE` had no fixture at all.
 *
 * The binary operators come from the grammar's OWN table, so a new operator fails this test until it has a fixture.
 */
import { expect, test } from "bun:test"
import { BINARY_PRECEDENCE } from "../../src/syntax/expression.js"
import { lex } from "../../src/syntax/index.js"
import { ALL_TESTS } from "./fixtures/index.js"

/** Operators outside the binary table — unary, assignment (`statements.ts` `assignOpOf`), output binding, deref. */
const OTHER_OPERATORS = ["NOT", ":=", "S=", "R=", "REF=", "=>", "^"]

test("every operator the grammar accepts has at least one conformance fixture", () => {
  const operators = [...BINARY_PRECEDENCE.flatMap((row) => row.ops), ...OTHER_OPERATORS]
  const seen = new Set<string>()
  for (const fixture of ALL_TESTS)
    for (const source of [fixture.source, fixture.plcPrgBody ?? ""])
      for (const token of lex(source)) seen.add((token.kind === "keyword" ? (token.keyword ?? token.text) : token.text).toUpperCase())
  expect(operators.filter((op) => !seen.has(op))).toEqual([])
})

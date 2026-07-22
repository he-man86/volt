/**
 * implicit-conversion — the WARNINGs derived from `classifyConversion`: narrow (loss) + sign-change. Both
 * wordings confirmed live (only "Possible"/"possible" differs per vendor). Also pins that an ERROR kind
 * (integer narrowing) does NOT also produce a conversion warning — one site, one diagnostic.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../index.js"

const conv = (decls: string, body: string, vendor: Vendor = "codesys") => {
  const src = `FUNCTION_BLOCK F\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const p = buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project: p, config: resolveConfig({ vendor }) }).filter(
    (d) => d.code === "narrowing-conversion" || d.code === "sign-change-conversion",
  )
}

test("narrowing (LREAL→REAL) warns 'possible loss of information'", () => {
  const d = conv("r : REAL; l : LREAL;", "r := l;")
  expect(d).toHaveLength(1)
  expect(d[0]).toMatchObject({ severity: "warning", code: "narrowing-conversion" })
  expect(d[0]?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
})

test("sign-change (WORD→INT) warns byte-identical; vendor differs only in caps", () => {
  const cs = conv("x : INT; w : WORD;", "x := w;")
  expect(cs[0]).toMatchObject({ severity: "warning", code: "sign-change-conversion" })
  expect(cs[0]?.message).toBe("Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : Possible change of sign")
  const tc = conv("x : INT; w : WORD;", "x := w;", "twincat")
  expect(tc[0]?.message).toBe("Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : possible change of sign")
})

test("sign-change fires both directions (signed→unsigned too)", () => {
  const d = conv("u : UINT; i : INT;", "u := i;")
  expect(d[0]?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
})

test("an integer narrowing (DINT→INT) is an ERROR, not a conversion warning — no double diagnostic", () => {
  expect(conv("x : INT; d : DINT;", "x := d;")).toEqual([]) // the assignment-type-mismatch check owns it
})

test("a safe widening (SINT→INT) produces no conversion warning", () => {
  expect(conv("x : INT; s : SINT;", "x := s;")).toEqual([])
})

// ── conversion-function ARGUMENTS: `<SRC>_TO_<DST>(arg)` implicitly converts `arg` to `<SRC>` ──────────────
// Corpus-found (lenze): `REAL_TO_DINT(<LREAL>)` and `UINT_TO_WORD(<INT>)` — CODESYS warns on the argument
// exactly as an assignment to a `<SRC>` variable would. The assignment-only check missed this whole class.

test("conversion arg that narrows (REAL_TO_DINT of an LREAL) warns 'loss of information'", () => {
  const d = conv("d : DINT; l : LREAL;", "d := REAL_TO_DINT(l);")
  expect(d).toHaveLength(1)
  expect(d[0]?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
})

test("conversion arg that sign-changes (UINT_TO_WORD of an INT) warns 'change of sign'", () => {
  const d = conv("w : WORD; i : INT;", "w := UINT_TO_WORD(i);")
  expect(d).toHaveLength(1)
  expect(d[0]?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
})

test("conversion arg already the source type does NOT warn (zero-FP)", () => {
  expect(conv("r : REAL; i : INT;", "r := INT_TO_REAL(i);")).toEqual([]) // arg INT = source INT
  expect(conv("i : INT; w : WORD;", "i := WORD_TO_INT(w);")).toEqual([]) // arg WORD = source WORD
  expect(conv("s : STRING; i : INT;", "s := TO_STRING(i);")).toEqual([]) // TO_STRING has no elementary source
})

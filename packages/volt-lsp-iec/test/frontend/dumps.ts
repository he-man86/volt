/**
 * THE FRONT-END, WRITTEN DOWN — the dump builders the phase-0 measurements and snapshot F share (openspec
 * `frontend-conformance`, design.md §5). Each builder takes one parsed source (and, from 0.3 on, the bound project it
 * lives in) and returns plain text lines, so a measurement can count them and a snapshot can compare them byte for byte.
 *
 *   parseErrors      every error the two parse passes record (declarations; each ST statement body), worded as the
 *                    LSP words them for the vendor — the only parse errors a client ever sees (0.1)
 *   printFindings    what is not a fixed point of the printer: the formatter over the whole document, and `exprText`
 *                    over every expression (0.2)
 *   resolutionDump   every identifier occurrence → the declaration it binds to, or NONE (0.3)
 *   typeDump         every expression → its inferred type (0.4)
 *   foldDump         every initializer and every constant expression → its `constEval` value (0.4)
 *
 * Lines carry `line:col` (1-based line, 0-based column, as spans do) and never an absolute path, so a dump taken in a
 * temporary worktree compares equal to one taken here.
 */
import { messagesFor, parseErrorMessage, vendorReportsParseError } from "../../src/analysis/index.js"
import { bodyConditionWorld, type Scope } from "../../src/frontend/symbols/index.js"
import {
  parseDocument,
  bodyStatements,
  unitBodies,
  type Dialect,
  type ParseError,
  type ParseResult,
  type Span,
} from "../../src/frontend/syntax/index.js"
import { measuredStBody } from "./st-bodies.js"

export const at = (s: Span): string => `${s.startLine}:${s.startCol}`

/** A source parsed as the LSP parses it. */
export interface Parsed {
  id: string
  uri: string
  source: string
  dialect: Dialect
  parseResult: ParseResult
}

/** Parsed ONCE per file object and dialect: the corpus's files and each fixture's own item and PLC_PRG are the same
 *  objects to every measurement (`sources.ts` reads them once), and the printer census, the parse census and the bound
 *  census each parsed them again (2026-10-02). A parse is read-only to every caller — the replay rebinds one too. */
export function parse(file: { id: string; uri: string; source: string }, dialect: Dialect): Parsed {
  let byDialect = parses.get(file)
  if (byDialect === undefined) parses.set(file, (byDialect = new Map()))
  let parsed = byDialect.get(dialect)
  if (parsed === undefined)
    byDialect.set(dialect, (parsed = { ...file, dialect, parseResult: parseDocument(file.uri, file.source, { networkText: true }, dialect) }))
  return parsed
}
const parses = new WeakMap<object, Map<Dialect, Parsed>>()

// ─── 0.1 parse errors ────────────────────────────────────────────────────────────────────────────────────────

export interface ParseErrorRow {
  /** `decl` — the top-level parse; `body` — an ST statement body. */
  pass: "decl" | "body"
  at: string
  message: string
}

/**
 * Every parse error a client would see for the bound file `b` on `vendor`: both passes, the vendor's wording of "Unexpected token",
 * and without the ones that vendor's compiler does not report (`vendorReportsParseError`) — the same stream
 * `checks/syntax/parse-errors.ts` drains. On TwinCAT a message said twice on one LINE is seen once, because
 * `computeDiagnostics` folds TwinCAT's output per line (`dedupePerLine`: TwinCAT never says the same thing twice
 * on one line) — so a refused `LDATE#2024-01-01`, whose cascade pairs `'-'` twice, is counted as TwinCAT records it
 * (task 2.2.6, when the cascade moved from `refused-name` into the parser).
 *
 * A body is parsed in the world the analysis gives it (`bodyConditionWorld`: the project's names, its vendor, its
 * measured environment — the recording projects' for a fixture), so a chain on the project's names (`defined (pou: …)`,
 * `hasattribute`, …) is decided here as it is for the user and its syntax errors are counted (frontend-conformance 2.7
 * review: a world without the names refused the chain and lost the errors the user is shown).
 */
export function parseErrors(b: Bound, vendor: Dialect): ParseErrorRow[] {
  const p = b.parsed
  const messages = messagesFor(vendor)
  const row = (pass: ParseErrorRow["pass"], e: ParseError): ParseErrorRow => ({
    pass,
    at: at(e.span),
    message: parseErrorMessage(e, messages),
  })
  const out: ParseErrorRow[] = []
  for (const e of p.parseResult.errors) if (vendorReportsParseError(e, vendor)) out.push(row("decl", e))
  for (const unit of p.parseResult.units)
    for (const body of unitBodies(unit)) {
      if (!measuredStBody(body)) continue
      for (const e of bodyStatements(body, bodyConditionWorld(b.project, unit, body)).errors) if (vendorReportsParseError(e, vendor)) out.push(row("body", e))
    }
  if (vendor !== "twincat") return out
  const seen = new Set<string>()
  return out.filter((r) => {
    const key = `${r.at.split(":")[0]}\u0000${r.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── 0.3 / 0.4 the bound dumps ───────────────────────────────────────────────────────────────────────────────

/** A parsed source, bound: the project it lives in (its library manifests and device instances bound too). */
export interface Bound {
  parsed: Parsed
  project: Scope
}


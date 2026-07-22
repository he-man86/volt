/**
 * Diagnostic-identity invariants (behavior-conformance). The *wire identity* of a diagnostic — its `code`,
 * `codeDescription`, and uniqueness — is what a client shows the user, and no analysis test asserts it
 * (they test `DiagnosticItem`, pre-wire). Two invariants, checked over the server's real responses:
 *   1. Every diagnostic `code` is the CODESYS `Cnnnn` the check mirrors (recognisable, cross-referable to
 *      the IDE), OR a documented exception (graphical `VG_*`, a parse error with no code, or a semantic
 *      slug not yet mapped to a catalog code — see KNOWN_UNMAPPED).
 *   2. No two diagnostics on one document share `(range, code)` — the duplicate that PR #86 fixed at the
 *      transport now can't silently return via the compute path.
 */
import { test, expect } from "bun:test"
import { CAPS, harness } from "./harness.js"
import { allowedCode } from "./diagnostic-codes.js"

const C0032 = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
const VG_UNCLOSED = `FUNCTION_BLOCK G\nVAR out : BOOL;\nEND_VAR\nNETWORK 0 LD\nout := TRUE;\nEND_FUNCTION_BLOCK`
const PARSE_ERR = `FUNCTION_BLOCK H\nVAR\n x : ;\nEND_VAR\nEND_FUNCTION_BLOCK`

test("a mapped check shows the recognisable Cnnnn, once, with a docs link", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.open("file:///F.fb", C0032)
  const diags = (await h.pull("file:///F.fb")).filter((d) => d.code === "C0032")
  expect(diags.length).toBe(1)
  expect(diags[0]?.codeDescription?.href).toMatch(/^https?:\/\//)
  h.dispose()
})

test("every diagnostic code is a Cnnnn or a documented exception", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  const docs: [string, string][] = [
    ["file:///F.fb", C0032],
    ["file:///G.fb", VG_UNCLOSED],
    ["file:///H.fb", PARSE_ERR],
  ]
  const offenders: string[] = []
  for (const [uri, text] of docs) {
    await h.open(uri, text)
    for (const d of await h.pull(uri)) if (!allowedCode(d.code)) offenders.push(`${uri}: ${String(d.code)}`)
  }
  expect(offenders).toEqual([])
  h.dispose()
})

test("no two diagnostics on a document share (range, code)", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  const docs: [string, string][] = [
    ["file:///F.fb", C0032],
    ["file:///G.fb", VG_UNCLOSED],
    ["file:///H.fb", PARSE_ERR],
  ]
  const dupes: string[] = []
  for (const [uri, text] of docs) {
    await h.open(uri, text)
    const seen = new Set<string>()
    for (const d of await h.pull(uri)) {
      const r = d.range
      const key = `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}|${String(d.code)}`
      if (seen.has(key)) dupes.push(`${uri}: ${key}`)
      seen.add(key)
    }
  }
  expect(dupes).toEqual([])
  h.dispose()
})

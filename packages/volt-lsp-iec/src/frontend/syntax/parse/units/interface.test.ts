/**
 * INTERFACE property accessors — the forms the bridge actually materializes.
 *
 * An interface accessor has no BODY (DIALECT D21: it declares that a getter exists and nothing more), and this
 * parser read that as "and therefore nothing between `GET` and `END_GET`". Bodiless is not declaration-less.
 * A live census of pro2193 found 263 accessors holding a bare `VAR`/`END_VAR` — interface ones included — so
 * the moment volt-cli stopped dropping those declarations on pull, five of the corpus's interfaces stopped
 * parsing: the VAR section fell through to the stray-VAR arm (a C0149 false positive on legal code) and
 * `END_GET` then arrived with nothing expecting it.
 *
 * The corpus gate is what FOUND that. These are the acknowledgements, so the shapes are pinned here where a
 * failure names the construct instead of naming a customer file.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../index.js"

const parse = (src: string) => parseSource(src)

test("an interface accessor may declare vars — the vendor stores them and they are not a body", () => {
  const pr = parse(`INTERFACE IThing
PROPERTY Enabled : BOOL
SET
VAR
END_VAR
END_SET
END_PROPERTY
END_INTERFACE`)

  // THE REGRESSION: this reported `unexpected keyword 'END_SET' inside INTERFACE`, plus a C0149 for a stray
  // VAR section that is not stray at all.
  expect(pr.errors).toEqual([])
  const itf = pr.units[0]
  expect(itf?.kind).toBe("interface")
  if (itf?.kind !== "interface") return
  expect(itf.properties).toHaveLength(1)
  expect(itf.properties[0]?.hasSetter).toBe(true)
  expect(itf.properties[0]?.hasGetter).toBe(false)
  // The declaration is consumed, not re-reported as an interface-level VAR.
  expect(itf.strayVarSections ?? []).toEqual([])
})

test("both accessors may declare, independently", () => {
  const pr = parse(`INTERFACE IThing
PROPERTY Level : INT
GET
VAR
	tmp : INT;
END_VAR
END_GET
SET
VAR
END_VAR
END_SET
END_PROPERTY
END_INTERFACE`)

  expect(pr.errors).toEqual([])
  const itf = pr.units[0]
  if (itf?.kind !== "interface") throw new Error("expected an interface")
  expect(itf.properties[0]?.hasGetter).toBe(true)
  expect(itf.properties[0]?.hasSetter).toBe(true)
})

test("an ACCESS MODIFIER before the declaration is a FUNCTION BLOCK property's form, not an interface's", () => {
  // The census counted 14 `PUBLIC`, 12 `PROTECTED` and 11 `PRIVATE` accessor declarations in pro2193, and it
  // did NOT separate interface accessors from function-block ones — so there is no evidence the form occurs
  // on an interface, and widening this parser to take it would make the LSP more permissive than the
  // compiler on a shape nothing has been seen to produce. What IS evidenced is the FB case
  // (`CassetteFB.NegativeLimitReachedY`), and it parses.
  const fb = parse(`FUNCTION_BLOCK FB_Thing
VAR
END_VAR

PROPERTY Level : INT
SET
PRIVATE
VAR
END_VAR
Level := 1;
END_SET
END_PROPERTY
END_FUNCTION_BLOCK`)
  expect(fb.errors).toEqual([])

  // On an INTERFACE the same text is still reported. If a real project ever produces one, THAT is the
  // evidence to widen on — not this test.
  const itf = parse(`INTERFACE IThing
PROPERTY Level : INT
SET
PRIVATE
VAR
END_VAR
END_SET
END_PROPERTY
END_INTERFACE`)
  expect(itf.errors.length).toBeGreaterThan(0)
})

test("the forms that already worked still work — bare keyword and empty block", () => {
  const pr = parse(`INTERFACE IThing
PROPERTY A : BOOL
GET
SET
END_PROPERTY
PROPERTY B : BOOL
GET
END_GET
END_PROPERTY
END_INTERFACE`)

  expect(pr.errors).toEqual([])
  const itf = pr.units[0]
  if (itf?.kind !== "interface") throw new Error("expected an interface")
  expect(itf.properties.map((p) => [p.hasGetter, p.hasSetter])).toEqual([
    [true, true],
    [true, false],
  ])
})

test("a %FOLDER directive still rides alongside the declaration", () => {
  const pr = parse(`INTERFACE IThing
PROPERTY A : BOOL
%FOLDER Properties
GET
VAR
END_VAR
END_GET
END_PROPERTY
END_INTERFACE`)

  expect(pr.errors).toEqual([])
})

test("a VAR section in the INTERFACE BODY is still illegal — the fix must not swallow it", () => {
  // C0149's subject: a VAR that is genuinely at interface level, not inside an accessor. Widening the
  // accessor to accept declarations would be worthless if it also stopped reporting this.
  const pr = parse(`INTERFACE IThing
VAR
	x : INT;
END_VAR
END_INTERFACE`)

  const itf = pr.units[0]
  if (itf?.kind !== "interface") throw new Error("expected an interface")
  expect(itf.strayVarSections ?? []).toHaveLength(1)
})

test("genuinely unexpected content inside an accessor still errors", () => {
  // The accessor consumes VAR sections and folder directives and nothing else, so a real body — which an
  // interface accessor cannot have — is still reported rather than quietly accepted.
  const pr = parse(`INTERFACE IThing
PROPERTY A : BOOL
GET
A := TRUE;
END_GET
END_PROPERTY
END_INTERFACE`)

  expect(pr.errors.length).toBeGreaterThan(0)
})

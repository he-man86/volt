/**
 * the ceiling exceptions (`baseline.ts`) — part D: openspec lsp-field-false-positives 8, the class sweeps (2026-10-29), and
 * lsp-field-followups 2, names past ASCII with "Unicode identifiers" off (2026-10-30).
 *
 * Four sweeps recorded 649 fixtures on both vendors — new ground, measured, not a regression. What each family adds to a
 * disagreement measure is one of the reasons below, per fixture, in `exceptions-lsp-field-8.json` (`[baseline, measure,
 * by, fixture]` rows, written from the measurement — each fixture's own contribution, which is what a named exception
 * is). A row goes stale, failing, the day its fixture stops producing it.
 */
import ROWS from "./exceptions-lsp-field-8.json" with { type: "json" }
import type { CeilingException } from "./baseline-shared.js"

const NICHE = "none: niche, accepted loss (0 such names in the corpora, which build)"

/** Why a fixture of each sweep family is excepted: the first family whose name pattern holds. */
const FAMILIES: readonly { name: RegExp; task: string; why: string }[] = [
  {
    name: /_crl?f?$/,
    task: "none: a twin answers as its pair does — the pair's own findings, unchanged",
    why: "the lone-CR or CRLF twin of a quick-fix pair (`fixtures/quick-fixes/line-end-twins.ts`, class 2)",
  },
  {
    name: /^wp_/,
    task: NICHE,
    why: "a vocabulary word in a name position (`fixtures/names/word-positions.ts`, class 3): the LSP gives the vendor's first line, not its recovery past it",
  },
  {
    name: /^dp_/,
    task: NICHE,
    why: "a declared path where the list takes none (`fixtures/declarations/declared-paths.ts`, class 4): TwinCAT's recovery past its refusal of the `.`, and the LSP's types and names in a list it refused",
  },
  {
    name: /^upa_/,
    task: "none: a list's own declarations have no scope in the census (`bound.ts` `withBoundFixture`)",
    why: "a GVL named past ASCII with an initializer (`fixtures/cross-object/names-past-ascii.ts`, class 1)",
  },
  {
    name: /^on_/,
    task: "none: the text is no IDE's — both refuse to create the object (`checks/names/object-name.ts` reports that alone)",
    why: "an object named by a refused word or past ASCII (`fixtures/names/object-names.ts`, openspec lsp-field-followups 3): its names and its caller's are the census's to hold, and the IDE holds none of them",
  },
  {
    name: /^uoff_/,
    task: "none: the recovery classes divergences-units.ts and divergences-declarations.ts pin (TYPE_EXPRESSION_RECOVERY, TWINCAT_NON_RETAIN_RECOVERY)",
    why: "a name past ASCII with \"Unicode identifiers\" off (`fixtures/names/unicode-identifiers-off.ts`, openspec lsp-field-followups 2): the LSP gives the vendor's first line, not its recovery past it",
  },
  {
    name: /^lex_(implicit_)?enum_value_/,
    task: "none: niche, accepted loss (0 such enum values in the corpora) — the recovery divergences-units.ts pins",
    why: "a refused word as an enum value on TwinCAT (6b.1, recorded 2026-10-29): the LSP gives the vendor's first line, not its recovery past it",
  },
]

export const CEILING_EXCEPTIONS_D: readonly CeilingException[] = (ROWS as [string, string, number, string][]).map(
  ([baseline, measure, by, fixture]) => {
    const family = FAMILIES.find((f) => f.name.test(fixture))
    if (family === undefined) throw new Error(`exceptions-lsp-field-8.json: ${fixture} belongs to no sweep family`)
    return { baseline, measure, by, fixture, task: family.task, why: family.why }
  },
)

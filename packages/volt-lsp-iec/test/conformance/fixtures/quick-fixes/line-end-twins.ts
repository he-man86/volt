/**
 * EVERY QUICK-FIX PAIR AGAIN, IN A LONE-CR AND A CRLF FILE (openspec lsp-field-false-positives 8, class 2). A fix is
 * built from the RAW text — where a line starts (`removeConstruct`, a declaration inserted before `END_VAR`, the empty
 * statement under its header), which line break it writes (`lineBreakOf`), where a `//` comment ends (`findWord`), the
 * line and column of each edit (`spanOf`) — and a BEFORE's no-op message quotes its line break. Each of those reads must
 * count a line end where the lexer does: LF, CRLF and a lone CR, one each. So each pair is asked in both other line
 * endings: the BEFORE reports its finding, and the AFTER — the BEFORE's text with the action's edits applied, held byte
 * for byte by `src/services/assist/code-actions.test.ts` — is what the compiler accepts. The push reads every line end as
 * one (`StReader.LfLines`), so the vendor answers the same program; what is asked is the LSP's reading of the raw text.
 *
 * A twin is its pair's fixture with every quick-fix fixture name `n` spelled `n_cr` / `n_crlf` (the convention every
 * pair is written in: each name it declares carries its fixture's), and its own source's line breaks in the twin's
 * spelling. PLC_PRG is the recorder's own text, and stays LF.
 */
import type { LanguageTest } from "../../types.js"
import { QF_CONVERSION_TESTS } from "./f1-conversions.js"
import { QF_NO_OP_TESTS } from "./f2-no-op.js"
import { QF_NEAR_MISS_TESTS } from "./f3-near-miss.js"
import { QF_INSERT_TOKEN_TESTS } from "./f4-insert-token.js"
import { QF_STRING_LENGTH_TESTS } from "./f5-string-length.js"
import { QF_AMBIGUOUS_GLOBAL_TESTS } from "./f6-ambiguous-global.js"
import { QF_CONSTANT_TESTS } from "./f7-constant.js"
import { QF_OOP_TESTS } from "./f8-oop.js"
import { QF_LOCAL_EDIT_TESTS } from "./f9-local-edits.js"
import { QF_LOCAL_EDIT_B_TESTS } from "./f9-local-edits-b.js"
import { QF_DUPLICATE_TESTS } from "./f10-duplicates.js"

const PAIRS: readonly LanguageTest[] = [
  ...QF_CONVERSION_TESTS,
  ...QF_NO_OP_TESTS,
  ...QF_NEAR_MISS_TESTS,
  ...QF_INSERT_TOKEN_TESTS,
  ...QF_STRING_LENGTH_TESTS,
  ...QF_AMBIGUOUS_GLOBAL_TESTS,
  ...QF_CONSTANT_TESTS,
  ...QF_OOP_TESTS,
  ...QF_LOCAL_EDIT_TESTS,
  ...QF_LOCAL_EDIT_B_TESTS,
  ...QF_DUPLICATE_TESTS,
]

/** The two twin spellings: the fixture-name suffix and the line break the twin's source is written in. */
export const LINE_END_TWINS = [
  { suffix: "_cr", lineBreak: "\r" },
  { suffix: "_crlf", lineBreak: "\r\n" },
] as const

// One pass, longest name first, so a name that is a prefix of another (`qf_c0139_remove`, `qf_c0139_remove_instance`)
// is never renamed inside the longer one.
const NAMES = new RegExp(
  [...new Set(PAIRS.map((t) => t.name))]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g",
)

function twin(t: LanguageTest, suffix: string, lineBreak: string): LanguageTest {
  const renamed = JSON.parse(JSON.stringify(t).replace(NAMES, (n) => n + suffix)) as LanguageTest
  return { ...renamed, source: renamed.source.replace(/\n/g, lineBreak) }
}

export const QF_LINE_END_TWIN_TESTS: readonly LanguageTest[] = LINE_END_TWINS.flatMap(({ suffix, lineBreak }) =>
  PAIRS.map((t) => twin(t, suffix, lineBreak)),
)

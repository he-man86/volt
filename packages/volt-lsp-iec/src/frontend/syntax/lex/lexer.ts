/**
 * IEC 61131-3 Structured Text lexer — hand-written state machine.
 *
 * Emits *all* tokens including trivia (whitespace, comments, pragma
 * blocks). The parser filters trivia by default; refactoring / format
 * tools that care about source fidelity get them.
 *
 * `lex` keeps the loop; one scanner per token class reads each token (openspec lsp-same-standard design.md §2.2):
 * `trivia.ts`, `strings.ts`, `numbers.ts`, `words.ts`, `addresses.ts`, `punctuation.ts`, over one `Scanner`.
 */
import { pointSpan } from "../span.js"
import { scanAddress } from "./addresses.js"
import { scanNumber } from "./numbers.js"
import { scanPunctuation } from "./punctuation.js"
import { Scanner } from "./scanner.js"
import { scanString } from "./strings.js"
import type { Token } from "./tokens.js"
import { scanTrivia } from "./trivia.js"
import type { Dialect } from "./vocabulary.js"
import { scanWord } from "./words.js"

/**
 * `dialect` decides only the VOCABULARY — which words are reserved and which `<prefix>#` forms are literals
 * (see `CODESYS_ONLY_KEYWORDS`). Everything else is shared.
 *
 * REQUIRED (frontend-conformance 2.1.4). It defaulted to CODESYS, "the superset", and eight re-lexers outside the parse
 * took the default — hover, semantic tokens, reachability, the binder's `qualified_only`, the attribute readers, the
 * token under the cursor, and the network-text parser's ST fragments — so a TwinCAT project was re-read with words
 * reserved that TwinCAT does not have. A consumer reads `ParseResult.tokens` (lexed once, in the parse's dialect) or
 * passes the dialect it has.
 */
export function lex(src: string, dialect: Dialect): Token[] {
  const s = new Scanner(src, dialect === "twincat")
  while (s.more) {
    s.mark()
    // the order decides where two classes share a first character: `//` and `(*` before the punctuators `/` and `(`,
    // a `%` address before the punctuator `%`
    if (scanTrivia(s) || scanString(s) || scanNumber(s) || scanWord(s) || scanAddress(s)) continue
    scanPunctuation(s)
  }

  // the end-of-input sentinel, where the incremental line/col already stand — no rescan of the source
  s.tokens.push({ kind: "eof", text: "", span: pointSpan(s.pos, s.line, s.col) })

  return s.tokens
}

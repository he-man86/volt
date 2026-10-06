/**
 * What a check is handed, and what a check is (openspec analysis-conformance design.md §2, task 1.6). A check imports
 * this, `shared/`, `messages` and `config` — never the registry or the pipeline that runs it (gate A3).
 */
import type { ParseResult, Token } from "../../frontend/syntax/index.js"
import type { Scope } from "../../frontend/symbols/index.js"
import type { ResolvedConfig } from "../config.js"
import type { Messages } from "../messages.js"
import type { DiagnosticItem } from "../shared/diagnostic-item.js"

/** Everything any check might need; a check reads only what it uses. */
export interface CheckContext {
  parseResult: ParseResult
  source: string
  project: Scope
  /** The document being checked. It is WHO IS ASKING when a type name has more than one candidate — see
   *  `symbols/precedence.ts`. REQUIRED (analysis-conformance 1.13): every caller names the document it asks about —
   *  a test by `uriFor` (`test-uri.ts`), the harnesses by the file the project bound — so no analysis runs with an
   *  asker nobody stated. */
  uri: string
  config: ResolvedConfig
  messages: Messages
  /** The source's tokens as the PARSE lexed them (`ParseResult.tokens`: once, with the parse's dialect), shared by
   *  every pragma/attribute-token check. The parser strips pragmas from the tree, so these checks read the stream —
   *  three of them used to re-lex it independently, then one memoized lex did. */
  tokens: () => readonly Token[]
}

/** A check: it appends what it finds to `out`, and reads nothing else of `out` unless its registry entry says so
 *  (`reads`, `registry.ts`). */
export type Check = (ctx: CheckContext, out: DiagnosticItem[]) => void

// A LOCALE RUN THAT DID NOT SWITCH THE LOCALE PROVES NOTHING (openspec environment-dependency-audit 1.1): volt-control's
// suite is the TS locale run (it holds the product's one locale-sensitive call), so it carries the sentinel too — the
// preload is the LSP's (bunfig.toml), and this states it took effect here. Unset, the run keeps the machine's default.
import { expect, test } from "bun:test"
import { requestedCulture } from "../../volt-lsp-iec/test/support/culture.js"

test("a locale run answers every locale-sensitive operation in the requested locale", () => {
  if (requestedCulture === undefined) return
  expect(new Intl.Collator().resolvedOptions().locale).toBe(new Intl.Collator(requestedCulture).resolvedOptions().locale)
})

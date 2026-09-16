import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { CORPUS_TYPE_TESTS as BATCH } from "../test/conformance/fixtures/corpus-types.js"
import { runPaths } from "../test/conformance/support/run-paths.js"
import { parseSource } from "../src/syntax/index.js"
for (const t of BATCH) {
  const errs = parseSource(t.source).errors
  console.log(`${t.name}: ${errs.length === 0 ? "ok" : "PARSE " + errs[0]!.message} | paths ${runPaths(t, ALL_TESTS).length}`)
}

import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { withDependencies } from "../test/conformance/support/fixture-units.js"
import { plcPrgSource } from "../test/conformance/support/plc-prg.js"
import { STANDARD_LIBRARY as LIBRARIES } from "../test/conformance/support/standard-library.js"
import { lowerSource } from "../src/transpile/index.js"
for (const name of process.argv.slice(2)) {
  const c = ALL_TESTS.find((t) => t.name === name)
  if (c === undefined) {
    console.log(`=== ${name}: no such fixture`)
    continue
  }
  const fixtures = withDependencies(c, ALL_TESTS).filter((f) => f.source !== "")
  const gvls = fixtures.filter((f) => f.kind === "gvl").map((f) => ({ uri: `${f.pouName}.gvl`, source: f.source }))
  const rest = [...fixtures.filter((f) => f.kind !== "gvl").map((f) => f.source), plcPrgSource(c)].join("\n")
  const { diagnostics } = lowerSource(rest, "PLC_PRG", [...LIBRARIES, ...gvls])
  console.log(`=== ${name}`)
  for (const d of [...new Map(diagnostics.map((d) => [d.message, d])).values()].slice(0, 6)) console.log(`  [${d.code}] ${d.message}`)
}

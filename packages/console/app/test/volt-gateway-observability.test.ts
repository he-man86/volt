import { expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"

// VOLT: pins the wiring between Volt's OWN gateway routes and opencode's tail worker.
//
// Volt serves the gateway on its own clean path — `app/src/routes/v1/*`, because `volt-config/opencode.json` points
// every agent at `https://volt-ai.dev/v1`. opencode's tail worker (`function/src/log-processor.ts`) allowlists only
// ITS paths (`/zen/v1/*`, `/zen/go/v1/*`) and `continue`s on anything else. The `routes/v1` beside-files were added
// without repointing that allowlist, so EVERY live Volt gateway request was dropped before reaching Honeycomb: the
// dashboards in `infra/monitoring.ts` were querying an empty set, and nothing anywhere went red. Typecheck, lint,
// the divergence gate and the build were all green the whole time.
//
// That is the standing hazard of the beside-file rule: a Volt route can be correct in isolation and still be
// invisible to the vendored infrastructure that was written for opencode's paths. So assert the invariant instead
// of the instance — every POST route under routes/v1 must appear in the worker's allowlist.

const V1_DIR = join(import.meta.dir, "..", "src", "routes", "v1")
const LOG_PROCESSOR = join(import.meta.dir, "..", "..", "function", "src", "log-processor.ts")

async function postRoutePaths(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue
    const full = join(entry.parentPath, entry.name)
    if (!/export\s+(async\s+)?function\s+POST/.test(await Bun.file(full).text())) continue
    // src/routes/v1/chat/completions.ts -> /v1/chat/completions
    out.push("/v1/" + relative(V1_DIR, full).split(sep).join("/").replace(/\.ts$/, ""))
  }
  return out
}

test("every POST route under routes/v1 is shipped to Honeycomb by the tail worker", async () => {
  const routes = await postRoutePaths(V1_DIR)
  const source = await Bun.file(LOG_PROCESSOR).text()

  // Guard the guard: if the walk finds nothing, the assertion below would vacuously pass.
  expect(routes.length).toBeGreaterThan(0)
  expect(routes).toContain("/v1/chat/completions")

  for (const route of routes) {
    expect(source).toContain(`"${route}"`)
  }
})

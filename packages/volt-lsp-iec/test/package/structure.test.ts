/**
 * THE PACKAGE'S STRUCTURE IS EXPLAINED AND KEPT (openspec lsp-package-structure, task 3.1): `src/` holds no loose source
 * file (the package has no barrel — nothing imports it as a module; the server entry is `server/bin.ts`), every folder of `src/` and `test/` has its sentence in `docs/architecture.md` "The tree"
 * (and that tree names no folder that is gone), and every file of `scripts/` is listed in `scripts/README.md`. The
 * layer imports are `layering.test.ts`'s, beside this file.
 *
 * No `src/` file is test support (openspec lsp-same-standard design.md §5, task 1.2): a `src/` file whose every importer
 * is a test fails, named. The server's import rule (S1) is `layering.test.ts`'s, where imports are scanned; this gate
 * borrows that scanner (`importGraph`), so the package has one.
 *
 * A colocated test is named after the source file beside it (openspec lsp-server-tests-layout): every `src/server/` and
 * `handlers/` source file has its own `<name>.test.ts`, and no test under `src/` is named after anything else — a finding,
 * a topic, a mechanism — but the topic suites listed with their reason (`TOPIC_SUITES`). The suites that drive the whole
 * server over its protocol live under `test/lsp/`.
 *
 * Data trees are one entry each: the fixtures and recordings under `test/conformance/` are grouped by concern and mapped
 * by `fixtures/map.generated.ts`, so their sub-folders are not listed; a dot-folder (`.snapshot/`) is a local cache.
 */
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { importGraph } from "../../scripts/check-layering.js"

const PACKAGE = join(import.meta.dir, "..", "..")
/** Folders whose sub-folders are data, described as one entry. */
const DATA_TREES: ReadonlySet<string> = new Set(["test/conformance/fixtures", "test/conformance/recordings"])

/** Every folder under `root` (package-relative, `/`-separated), dot-folders skipped, data trees not entered. */
function foldersUnder(root: string): string[] {
  const out: string[] = []
  const visit = (rel: string): void => {
    out.push(rel)
    if (DATA_TREES.has(rel)) return
    for (const name of readdirSync(join(PACKAGE, rel)).sort()) {
      if (name.startsWith(".") || name === "node_modules") continue
      if (statSync(join(PACKAGE, rel, name)).isDirectory()) visit(`${rel}/${name}`)
    }
  }
  visit(root)
  return out
}

/**
 * The folders "The tree" describes: the first code block after the heading, one folder per line as `<name>/  <sentence>`,
 * its depth by its indent (two spaces a level). A line with no sentence describes nothing.
 */
export function describedFolders(architecture: string): { described: Map<string, string>; malformed: string[] } {
  const section = architecture.split(/^## The tree.*$/m)[1]
  if (section === undefined) throw new Error("docs/architecture.md has no '## The tree' section")
  const block = /```\n([\s\S]*?)```/.exec(section)?.[1]
  if (block === undefined) throw new Error("docs/architecture.md '## The tree' has no code block")
  const described = new Map<string, string>()
  const malformed: string[] = []
  const stack: string[] = []
  for (const line of block.split("\n")) {
    if (line.trim() === "") continue
    const m = /^( *)([\w.-]+)(\/?)(?: {2,}(\S.*))?$/.exec(line)
    if (m === null || m[1]!.length % 2 !== 0) {
      malformed.push(line)
      continue
    }
    const depth = m[1]!.length / 2
    if (depth > stack.length) {
      malformed.push(line)
      continue
    }
    stack.length = depth
    if (m[3] !== "/") continue // a file line (`index.ts  …`) — described, not a folder
    stack.push(m[2]!)
    if (m[4] === undefined) malformed.push(line)
    else described.set(stack.join("/"), m[4])
  }
  return { described, malformed }
}

test("src/ holds no loose source file at its top level", () => {
  const loose = readdirSync(join(PACKAGE, "src")).filter((n) => statSync(join(PACKAGE, "src", n)).isFile())
  expect(loose).toEqual([])
})

test("every folder of src/ and test/ has its sentence in docs/architecture.md 'The tree', and the tree names no other", () => {
  const { described, malformed } = describedFolders(readFileSync(join(PACKAGE, "docs", "architecture.md"), "utf8").replace(/\r\n/g, "\n"))
  expect(malformed).toEqual([])
  const onDisk = [...foldersUnder("src"), ...foldersUnder("test")]
  expect(onDisk.filter((f) => !described.has(f))).toEqual([])
  const listed = [...described.keys()].filter((f) => f.startsWith("src/") || f.startsWith("test/") || f === "src" || f === "test")
  expect(listed.filter((f) => !existsSync(join(PACKAGE, f)))).toEqual([])
})

test("every file of scripts/ is listed in scripts/README.md", () => {
  const readme = readFileSync(join(PACKAGE, "scripts", "README.md"), "utf8")
  const unlisted = readdirSync(join(PACKAGE, "scripts")).filter((n) => n !== "README.md" && !n.startsWith(".") && !readme.includes(`\`${n}\``))
  expect(unlisted).toEqual([])
})

test("the tree reader: a folder's path is its indent; a folder line without a sentence, or a skipped level, is malformed", () => {
  const doc = "## The tree\n\n```\nsrc/  the code\n  a/  first\n    b/  inside a\n  index.ts  the barrel\n  c/\n      d/  too deep\n```\n"
  const { described, malformed } = describedFolders(doc)
  expect([...described]).toEqual([
    ["src", "the code"],
    ["src/a", "first"],
    ["src/a/b", "inside a"],
  ])
  expect(malformed).toEqual(["  c/", "      d/  too deep"])
})

/** A file that drives tests is not product: `*.test.ts`, anything under `test/`. */
const isTestFile = (f: string): boolean => f.startsWith("test/") || f.endsWith(".test.ts")
/** The `src/` files the rule does not ask: tests, colocated case tables, barrels and the CLI entry. */
const notAsked = (f: string): boolean => {
  const base = f.split("/").pop()!
  return isTestFile(f) || f.endsWith(".cases.ts") || base === "index.ts" || base === "bin.ts"
}

/**
 * Every `src/` file whose importers are all tests (or that nothing imports), as `<file>: <why>` — a script or a product
 * file importing it makes it product.
 */
export function testSupportInSrc(pkg: string): string[] {
  const graph = importGraph(pkg)
  const importers = new Map<string, string[]>()
  for (const [from, targets] of graph) for (const t of targets) importers.set(t, [...(importers.get(t) ?? []), from])
  const out: string[] = []
  for (const file of [...graph.keys()].filter((f) => f.startsWith("src/") && !notAsked(f)).sort()) {
    const by = importers.get(file) ?? []
    if (by.length === 0) out.push(`${file}: nothing imports it`)
    else if (by.every(isTestFile)) out.push(`${file}: only tests import it (${by.length}) — test support lives under test/`)
  }
  return out
}

/**
 * The test support still in `src/` (design.md §1.4). Measured 2026-10-12 at fddcde2a6e: `analysis/test-uri.ts`,
 * `server/diagnostic-codes.ts`, `server/harness.ts`; all three moved under `test/` in task 2.1 (design.md §2.3). Empty,
 * and it stays empty.
 */
const KNOWN_TEST_SUPPORT_IN_SRC: readonly string[] = []

/**
 * The test-support gate's verdict: a finding whose FILE the known list does not name is unexpected, a listed file with no
 * finding is stale. Keyed by the file alone — the importer count in a finding is information, so a test added beside the
 * 78 that import `test-uri.ts` changes nothing here.
 */
export function testSupportReport(found: readonly string[], known: readonly string[]): { unexpected: string[]; stale: string[] } {
  const fileOf = (finding: string): string => finding.split(": ")[0]!
  const knownFiles = new Set(known)
  const foundFiles = new Set(found.map(fileOf))
  return { unexpected: found.filter((f) => !knownFiles.has(fileOf(f))), stale: known.filter((k) => !foundFiles.has(k)) }
}

test("no src/ file is test support, but the listed ones; a listed one that moved is stale", () => {
  const found = testSupportInSrc(PACKAGE)
  expect(testSupportReport(found, KNOWN_TEST_SUPPORT_IN_SRC)).toEqual({ unexpected: [], stale: [] })
})

test("the test-support verdict is keyed by file: a moved importer count is neither unexpected nor stale", () => {
  const known = ["src/analysis/test-uri.ts", "src/server/harness.ts"]
  expect(
    testSupportReport(
      [
        "src/analysis/test-uri.ts: only tests import it (79) — test support lives under test/",
        "src/analysis/new.ts: nothing imports it",
      ],
      known,
    ),
  ).toEqual({ unexpected: ["src/analysis/new.ts: nothing imports it"], stale: ["src/server/harness.ts"] })
})

test("the test-support gate fires: a src/ file only tests import, and one nothing imports, are named", () => {
  const root = mkdtempSync(join(tmpdir(), "volt-structure-"))
  const files: Record<string, string> = {
    "src/server/harness.ts": `import { run } from "./server.js"\nexport const h = run\n`,
    "src/server/server.ts": `export const run = 1\n`,
    "src/server/index.ts": `export { run } from "./server.js"\n`,
    "src/server/server.test.ts": `import { h } from "./harness.js"\n`,
    // three levels deep, so the planted text read as THIS file's import resolves outside the package's src/
    "test/x/y/z.test.ts": `const m = await import("../../../src/analysis/uri.js")\n`,
    "src/analysis/uri.ts": `export const u = 1\n`,
    "src/analysis/orphan.ts": `export const o = 1\n`,
    "src/analysis/table.cases.ts": `export const c = 1\n`,
    "src/analysis/tool.ts": `export const t = 1\n`,
    "scripts/use-tool.ts": `import { t } from "../src/analysis/tool.js"\n`,
  }
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    expect(testSupportInSrc(root)).toEqual([
      "src/analysis/orphan.ts: nothing imports it",
      "src/analysis/uri.ts: only tests import it (1) — test support lives under test/",
      "src/server/harness.ts: only tests import it (1) — test support lives under test/",
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** Every `.test.ts` file under `dir` (package-relative, `/`-separated), dot-folders and `node_modules` skipped. */
function testFilesUnder(pkg: string, dir: string): string[] {
  const out: string[] = []
  const visit = (rel: string): void => {
    for (const name of readdirSync(join(pkg, rel)).sort()) {
      if (name.startsWith(".") || name === "node_modules") continue
      const child = `${rel}/${name}`
      if (statSync(join(pkg, child)).isDirectory()) visit(child)
      else if (name.endsWith(".test.ts")) out.push(child)
    }
  }
  if (existsSync(join(pkg, dir))) visit(dir)
  return out
}

/**
 * A colocated test is named after the source file beside it (openspec lsp-server-tests-layout): `<name>.test.ts` beside
 * `<name>.ts`. Every test under `dir` that is not, and is no listed topic suite, as `<file>: named after no source file
 * beside it`; and every listed topic suite that is gone, as `<file>: listed as a topic suite, but gone`.
 */
export function misnamedTests(pkg: string, dir: string, topicSuites: ReadonlyMap<string, string>): string[] {
  const found = testFilesUnder(pkg, dir)
  const misnamed = found
    .filter((f) => !topicSuites.has(f) && !existsSync(join(pkg, f.replace(/\.test\.ts$/, ".ts"))))
    .map((f) => `${f}: named after no source file beside it`)
  const gone = [...topicSuites.keys()]
    .filter((f) => f.startsWith(`${dir}/`) && !found.includes(f))
    .map((f) => `${f}: listed as a topic suite, but gone`)
  return [...misnamed, ...gone]
}

/** Every source file under `dir` with no `<name>.test.ts` beside it, the barrel `index.ts` aside (it re-exports, and asks nothing). */
export function untestedSources(pkg: string, dir: string): string[] {
  const out: string[] = []
  const visit = (rel: string): void => {
    for (const name of readdirSync(join(pkg, rel)).sort()) {
      const child = `${rel}/${name}`
      if (statSync(join(pkg, child)).isDirectory()) visit(child)
      else if (
        name.endsWith(".ts") &&
        !name.endsWith(".test.ts") &&
        name !== "index.ts" &&
        !existsSync(join(pkg, child.replace(/\.ts$/, ".test.ts")))
      )
        out.push(`${child}: has no ${name.replace(/\.ts$/, ".test.ts")} beside it`)
    }
  }
  visit(dir)
  return out
}

const PIPELINE = "the end-to-end pipeline for one subject, source to run, over the whole backend — no one file of it"
const NETWORK_TEXT = "network text: its tests are laid out with the change that supports every LD/FBD shape, not before"
/**
 * The colocated tests named after a TOPIC, on purpose (openspec lsp-server-tests-layout 2.4): each asks a question of a
 * whole folder, not of one file beside it.
 */
const TOPIC_SUITES: ReadonlyMap<string, string> = new Map([
  ...["aggregates", "arith", "calls", "control", "pointers", "strings", "time"].map(
    (s): [string, string] => [`src/transpile/pipeline/${s}.test.ts`, PIPELINE],
  ),
  ["src/frontend/syntax/parse/fuzz.test.ts", "the parser never throws: a mutation sweep over the whole parser"],
  ["src/transpile/lower/entry/totality.test.ts", "lowering is total: a property of all of lower/, never one file of it"],
  ["src/transpile/lower/diagnostics/classification.test.ts", "every refusal code names one kind of thing: the codes' split, over all of lower/"],
  ["src/frontend/types/network/network-implementation-line.test.ts", NETWORK_TEXT],
  ["src/frontend/types/network/network-reader.test.ts", "the network-text reader whole: syntax/network's files, composed by parseNetworkText — no one file of it"],
  ["src/frontend/types/network/network-cases.test.ts", "the shared network-text case set (volt-cli test/fixtures/network-text), read by this reader and the bridge's alike (ld-fbd-coverage 2R.3)"],
  ["src/services/network/network-real-shapes.test.ts", NETWORK_TEXT],
  ["src/services/network/highlight-network-text.test.ts", NETWORK_TEXT],
  ["src/services/network/named-output.test.ts", NETWORK_TEXT],
  ["src/services/structure/folding-network-text.test.ts", NETWORK_TEXT],
])

test("every src/server/ and handlers/ source file has its own test", () => {
  expect(untestedSources(PACKAGE, "src/server")).toEqual([])
})

test("every colocated test under src/ is named after a source file beside it, but the listed topic suites", () => {
  expect(misnamedTests(PACKAGE, "src", TOPIC_SUITES)).toEqual([])
})

test("the test-layout gate fires: a source with no test, a test named after a finding, and a listed suite that is gone, are named", () => {
  const root = mkdtempSync(join(tmpdir(), "volt-layout-"))
  const files = [
    "src/server/server.ts",
    "src/server/server.test.ts",
    "src/server/index.ts",
    "src/server/handlers/navigation.ts",
    "src/server/rename.test.ts",
    "src/services/fuzz.test.ts",
  ]
  try {
    for (const path of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), "")
    }
    expect(untestedSources(root, "src/server")).toEqual([
      "src/server/handlers/navigation.ts: has no navigation.test.ts beside it",
    ])
    expect(misnamedTests(root, "src/server", new Map())).toEqual([
      "src/server/rename.test.ts: named after no source file beside it",
    ])
    const suites = new Map([
      ["src/services/fuzz.test.ts", "a topic"],
      ["src/services/gone.test.ts", "a topic"],
    ])
    expect(misnamedTests(root, "src", suites)).toEqual([
      "src/server/rename.test.ts: named after no source file beside it",
      "src/services/gone.test.ts: listed as a topic suite, but gone",
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * THE PACKAGE'S STRUCTURE IS EXPLAINED AND KEPT (openspec lsp-package-structure, task 3.1): `src/` holds no loose source
 * file but the package barrel, every folder of `src/` and `test/` has its sentence in `docs/architecture.md` "The tree"
 * (and that tree names no folder that is gone), and every file of `scripts/` is listed in `scripts/README.md`. The
 * layer imports are `layering.test.ts`'s, beside this file.
 *
 * Data trees are one entry each: the fixtures and recordings under `test/conformance/` are grouped by concern and mapped
 * by `fixtures/map.generated.ts`, so their sub-folders are not listed; a dot-folder (`.snapshot/`) is a local cache.
 */
import { expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const PACKAGE = join(import.meta.dir, "..", "..")
/** The one file `src/` may hold at its top: the package barrel `package.json` exports. */
const SRC_ROOT_FILES: ReadonlySet<string> = new Set(["index.ts"])
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

test("src/ holds no loose source file at its top level but the package barrel", () => {
  const loose = readdirSync(join(PACKAGE, "src")).filter(
    (n) => statSync(join(PACKAGE, "src", n)).isFile() && !SRC_ROOT_FILES.has(n),
  )
  expect(loose).toEqual([])
})

test("every folder of src/ and test/ has its sentence in docs/architecture.md 'The tree', and the tree names no other", () => {
  const { described, malformed } = describedFolders(readFileSync(join(PACKAGE, "docs", "architecture.md"), "utf8"))
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

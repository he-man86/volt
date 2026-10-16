/**
 * The manifest warnings (`materialization.ts`): one per manifest another materialization wrote, keyed by its path —
 * older names the re-pull and the CLI as a possible stale side, newer names the language server — and none
 * for a manifest at this server's own format.
 */
import { expect, test } from "bun:test"
import { MATERIALIZATION, type LibraryManifest } from "../../../frontend/library/index.js"
import { materializationFindings } from "./materialization.js"

const manifest = (materialization: number): LibraryManifest => ({
  uri: "/w/Library Manager/Standard/Standard.library",
  folder: "Library Manager/Standard",
  dir: "/w/Library Manager/Standard/",
  namespace: "Standard",
  library: "Standard",
  dependencies: [],
  materialization,
})
const only = (materialization: number) => [...materializationFindings([manifest(materialization)]).values()].flat()

// Every format below this server's own is told to re-pull, naming both formats (no users, no backward compat: the
// warning no longer lists what each older format lacked).
test("every older format is told to re-pull, naming its format and this server's", () => {
  for (let format = 1; format < MATERIALIZATION; format++) {
    const [warning] = only(format)
    expect(warning?.code).toBe("library-stale")
    expect(warning!.message).toContain(`(format ${format}, now ${MATERIALIZATION}). Run \`volt pull\``)
  }
})

// The re-pull repair assumes the CLI on PATH is at least this server's format. volt-vscode is published on its own and
// bundles its own LSP, so the extension can be AHEAD of the installed CLI — and then `volt pull` writes the same old
// format back and the warning (with every graphical body unchecked) never clears. The warning must name that case.
test("an older manifest names an older CLI as a possible stale side", () => {
  const [warning] = only(MATERIALIZATION - 1)
  expect(warning?.code).toBe("library-stale")
  expect(warning!.message).toContain("volt pull")
  expect(warning!.message).toContain(`format ${MATERIALIZATION}`)
  expect(warning!.message).toMatch(/update the volt CLI/i)
})

test("a newer manifest names the language server as the stale side; one at this format says nothing", () => {
  const [warning] = only(MATERIALIZATION + 1)
  expect(warning?.code).toBe("materialization-newer")
  expect(warning!.message).toContain("newer Volt")
  expect(warning!.severity).toBe("warning")
  expect(warning!.span.startLine).toBe(1)
  expect(only(MATERIALIZATION)).toEqual([])
  expect([...materializationFindings([manifest(MATERIALIZATION + 1)]).keys()]).toEqual([manifest(0).uri])
})

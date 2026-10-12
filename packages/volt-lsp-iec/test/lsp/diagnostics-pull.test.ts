/**
 * DOES AN IDLE EDITOR COST THE SERVER NOTHING? (openspec lsp-server-scheduling 1.1) — VS Code re-pulls the workspace's
 * diagnostics two seconds after every pull, forever. A server that answers each pull with a full recompute is busy
 * recomputing findings that did not move (0.1: ~54 % of the time on pro2193). Under the protocol a pull that sends back
 * the previous resultIds may be answered `unchanged`, and that is the whole answer for an unchanged workspace: ten idle
 * pulls cost one pass. An edit re-sends only the document whose findings moved, and every report says which version of
 * an open buffer it describes.
 *
 * Written red (`test.failing`) in step 1; the `DiagnosticsPublisher` (2.1, `server/diagnostics-publisher.ts`) turned them
 * green and dropped the marks. The bench (`scripts/bench-server.ts`) measures the time; this
 * suite counts the answers AND the computes (the compute probe, `probes.ts`): `unchanged` alone cannot show the cost — a
 * server that recomputes every document and hashes the same items answers `unchanged` too.
 */
import { afterAll, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { pathToFileURL } from "node:url"
import type { PreviousResultId } from "vscode-languageserver-protocol/node"
import { CAPS, fileUri, harness, type WorkspaceReport } from "./harness.js"
import { computed, resetComputes } from "./probes.js"
import { tempWorkspace } from "./sources.js"

/** Two PROGRAMs (task roots by default, so neither is dead) that use nothing of each other. */
const PA = `PROGRAM PA\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\nIMPLEMENTATION ST\ni := i + 1;\nEND_PROGRAM\n`
const PB = PA.replace("PROGRAM PA", "PROGRAM PB")
/** PA with a type error (C0032) — an edit that moves PA's findings and nobody else's. */
const PA_BROKEN = PA.replace("i := i + 1;", "i := b;")

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})
function workspace(pa = PA): { root: string; rootUri: string; a: string; b: string } {
  const root = tempWorkspace({ "PA.pou": pa, "PB.pou": PB })
  roots.push(root)
  return { root, rootUri: pathToFileURL(root).href, a: fileUri(root, "PA.pou"), b: fileUri(root, "PB.pou") }
}

/** What a client sends back after `reports`: every resultId it was given, as VS Code does. */
const resultIdsOf = (reports: WorkspaceReport[]): PreviousResultId[] =>
  reports.flatMap((r) => (r.resultId === undefined ? [] : [{ uri: r.uri, value: r.resultId }]))

const kinds = (reports: WorkspaceReport[]) => new Map(reports.map((r) => [r.uri, r.kind]))

test("10 idle workspace pulls answer `unchanged` for every document after the first", async () => {
  const { root } = workspace()
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  const first = await h.workspacePull()
  // The first pull states every document in full, each with a resultId to send back.
  expect(first.length).toBeGreaterThanOrEqual(2)
  expect(first.every((r) => r.kind === "full" && r.resultId !== undefined)).toBe(true)
  let previous = resultIdsOf(first)
  let unchanged = 0
  let reports = 0
  for (let i = 0; i < 10; i++) {
    const r = await h.workspacePull(previous)
    reports += r.length
    unchanged += r.filter((x) => x.kind === "unchanged").length
    previous = [...new Map([...previous, ...resultIdsOf(r)].map((p) => [p.uri, p] as const)).values()]
  }
  expect({ reports, unchanged }).toEqual({ reports: 10 * first.length, unchanged: 10 * first.length })
  h.dispose()
})

test("10 idle workspace pulls compute no document after the first", async () => {
  // The generation cache: a pull at an unchanged generation reuses the last findings. Counted as computes, which the
  // answers cannot show (a recompute of the same items hashes to the same resultId).
  const { root, rootUri } = workspace()
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  resetComputes()
  let previous = resultIdsOf(await h.workspacePull())
  // The first pull after the crawl computes each (live) document once.
  expect([...computed(rootUri).values()]).toEqual([1, 1])
  resetComputes()
  for (let i = 0; i < 10; i++) previous = resultIdsOf(await h.workspacePull(previous))
  expect(computed(rootUri)).toEqual(new Map())
  h.dispose()
})

test("a document pull computes that one document and no other", async () => {
  const { root, rootUri, a } = workspace()
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  await h.open(a, PA)
  await h.change(a, 2, PA_BROKEN)
  resetComputes()
  expect((await h.pull(a)).map((d) => d.code)).toContain("C0032")
  expect(computed(rootUri)).toEqual(new Map([[a, 1]]))
  h.dispose()
})

test("before the crawl a pull answers `full` with no findings and no resultId; the first pull after it states them", async () => {
  // Nothing is cached before the crawl: the findings a pre-crawl pull would compute resolve nothing cross-file.
  const { root, a } = workspace(PA_BROKEN)
  const h = harness()
  await h.initializeIn(root, CAPS.vscode)
  const early = await h.pullReport(a)
  expect(early).toEqual({ kind: "full", items: [] })
  expect((await h.workspacePull()).filter((r) => r.resultId !== undefined || r.items.length > 0)).toEqual([])
  await h.initialized()
  const after = await h.pullReport(a)
  expect(after.kind).toBe("full")
  expect(after.kind === "full" ? after.items.map((d) => d.code) : []).toContain("C0032")
  h.dispose()
})

test("an edit answers `full` for the edited document only; the others stay `unchanged`", async () => {
  const { root, a, b } = workspace()
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  await h.open(a, PA)
  const first = await h.workspacePull()
  await h.change(a, 2, PA_BROKEN)
  const after = await h.workspacePull(resultIdsOf(first))
  expect(kinds(after).get(a)).toBe("full")
  expect(after.find((r) => r.uri === a)!.items.some((d) => d.code === "C0032")).toBe(true)
  expect(kinds(after).get(b)).toBe("unchanged")
  h.dispose()
})

test("a document pull that sends back its resultId answers `unchanged` when nothing moved", async () => {
  const { root, a } = workspace()
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  const first = await h.pullReport(a)
  expect(first.kind).toBe("full")
  const resultId = first.kind === "full" ? first.resultId : undefined
  expect(resultId).toBeDefined()
  const second = await h.pullReport(a, resultId)
  expect(second.kind).toBe("unchanged")
  h.dispose()
})

test("a workspace report carries the open buffer's version, and null for a file only on disk", async () => {
  const { root, a, b } = workspace()
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  await h.open(a, PA, 7)
  const versions = new Map((await h.workspacePull()).map((r) => [r.uri, r.version]))
  expect(versions.get(a)).toBe(7)
  expect(versions.get(b)).toBeNull()
  h.dispose()
})

test("a push carries the version of the buffer it describes", async () => {
  const { root, a } = workspace()
  const h = harness()
  await h.initIn(root, CAPS.pushWatch)
  await h.open(a, PA_BROKEN, 3)
  expect(h.published(a)?.some((d) => d.code === "C0032")).toBe(true)
  expect(h.publishedVersion(a)).toBe(3)
  await h.change(a, 4, PA)
  expect(h.publishedVersion(a)).toBe(4)
  h.dispose()
})

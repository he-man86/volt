/**
 * DOES A FILE EVENT COST ONE FILE? (openspec lsp-server-scheduling 1.2) — every watched-file event re-crawled and
 * re-parsed the whole workspace, saves included (0.1: 7759 files re-parsed and the loop blocked ~2 s per Ctrl+S on
 * pro2193). A save re-parses the one file it names; a reference file (`.library`, `.device`, `.task`,
 * `.projectsettings`) re-scans the references and re-parses no source; a folder event — which a host may send as ONE
 * event for the folder — drops exactly the entries under it and re-scans the references it may have held; a read that
 * fails while the CLI or the IDE is still writing is not a delete; and in push mode a change re-publishes every open
 * document it moved, and none it did not.
 *
 * Work is counted by the parse probe (`probes.ts`), never by wall clock. The tests written red in step 1
 * were turned green by 2.2 (incremental disk sync, `server/disk-sync.ts`) and 2.1 (the publisher's push re-publish).
 * The others pinned, before 2.2, what the wholesale re-crawl already got right, so the per-file sync could not lose it: every event kind
 * it heals today (a created, deleted or changed source; a created folder's sources; a Changed whose file is gone; a
 * `.projectsettings` edit; a deleted file's own report) and, in push mode, the re-push of an open document a watched
 * batch DID move and of the manifest set.
 */
import { afterAll, afterEach, expect, test } from "bun:test"
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { FileChangeType, type FileEvent } from "vscode-languageserver-protocol/node"
import { CAPS, fileUri, harness, type Harness } from "./harness.js"
import { busyRead, deniedList, parsed, relinked, resetParses, resetRelinks } from "./probes.js"
import { tempWorkspace } from "./sources.js"

const MAIN = `PROGRAM Main
VAR
\ta : FB_A;
\tc : FB_B;
\tx : BOOL;
END_VAR
IMPLEMENTATION ST
a();
c();
x := Dev1.xOk;
END_PROGRAM
`
const fb = (name: string) =>
  `FUNCTION_BLOCK ${name}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n`
/** A PROGRAM no task calls is dead, and its findings are quiet — until a `.task` calls it. */
const P2 = `PROGRAM P2\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\nIMPLEMENTATION ST\ni := b;\nEND_PROGRAM\n`
const TASK = (calls: string) => `Type: Cyclic\nInterval: T#10ms\nCalls: ${calls}\n`

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})
afterEach(() => {
  busyRead(undefined)
  deniedList(undefined)
})

/** `POUs/Motor` and its sibling `POUs/MotorControl` (whose name the first one prefixes), a device, a task, and three
 *  files nothing uses. */
function workspace() {
  const root = tempWorkspace({
    "Main.pou": MAIN,
    "P2.pou": P2,
    "POUs/Motor/FB_A.pou": fb("FB_A"),
    "POUs/MotorControl/FB_B.pou": fb("FB_B"),
    "Devices/Dev1.device": "Name: Dev1\n",
    "Other1.pou": fb("FB_Other1"),
    "Other2.pou": fb("FB_Other2"),
    "Other3.pou": fb("FB_Other3"),
    "Task.task": TASK("Main"),
  })
  roots.push(root)
  return {
    root,
    rootUri: pathToFileURL(root).href,
    at: (rel: string) => join(root, rel),
    uri: (rel: string) => fileUri(root, rel),
  }
}

/** The messages a workspace pull reports for `uri`. */
async function messagesOf(h: Harness, uri: string): Promise<string[]> {
  return ((await h.workspacePull()).find((r) => r.uri === uri)?.items ?? []).map((d) =>
    typeof d.message === "string" ? d.message : d.message.value,
  )
}
const unknownType = (name: string) => `Unknown type: '${name}'`

test("a watched Changed for one source re-parses that file and no other", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  appendFileSync(w.at("POUs/Motor/FB_A.pou"), "// saved\n")
  resetParses()
  await h.watched([{ uri: w.uri("POUs/Motor/FB_A.pou"), type: FileChangeType.Changed }])
  expect(parsed(w.rootUri)).toEqual(new Map([[w.uri("POUs/Motor/FB_A.pou"), 1]]))
  h.dispose()
})

test("a folder delete drops the entries under that folder, not a sibling whose name it prefixes", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  rmSync(w.at("POUs/Motor"), { recursive: true })
  await h.watched([{ uri: w.uri("POUs/Motor"), type: FileChangeType.Deleted }])
  const main = await messagesOf(h, w.uri("Main.pou"))
  expect(main).toContain(unknownType("FB_A"))
  expect(main).not.toContain(unknownType("FB_B"))
  h.dispose()
})

test("a folder delete re-parses no file", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  rmSync(w.at("POUs/Motor"), { recursive: true })
  resetParses()
  await h.watched([{ uri: w.uri("POUs/Motor"), type: FileChangeType.Deleted }])
  expect(parsed(w.rootUri)).toEqual(new Map())
  h.dispose()
})

test("a directory event re-scans the references: a deleted folder's `.device` unbinds", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  expect(await messagesOf(h, w.uri("Main.pou"))).not.toContain("Identifier 'Dev1' not defined")
  rmSync(w.at("Devices"), { recursive: true })
  await h.watched([{ uri: w.uri("Devices"), type: FileChangeType.Deleted }])
  expect(await messagesOf(h, w.uri("Main.pou"))).toContain("Identifier 'Dev1' not defined")
  h.dispose()
})

test("a directory event re-scans the references: a created folder's `.library` binds", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  // A manifest an older bridge wrote (no MATERIALIZATION line): bound, it draws `library-stale` on itself.
  mkdirSync(w.at("Library Manager/Old"), { recursive: true })
  writeFileSync(
    w.at("Library Manager/Old/Old.library"),
    "LIBRARY Old\nNAMESPACE Old\nRESOLUTION Old, 1.0.0.0 (x)\nPLACEHOLDER true\n",
  )
  await h.watched([{ uri: w.uri("Library Manager"), type: FileChangeType.Created }])
  const report = (await h.workspacePull()).find((r) => r.uri === w.uri("Library Manager/Old/Old.library"))
  expect(report?.items.map((d) => d.code)).toEqual(["library-stale"])
  h.dispose()
})

test("the server watches directories: one `**/*` watcher for Create and Delete", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  const watchers = h
    .registrations()
    .flatMap((r) => (r.registerOptions as { watchers?: { globPattern: unknown; kind?: number }[] }).watchers ?? [])
  expect(watchers.find((x) => x.globPattern === "**/*")?.kind).toBe(1 | 4) // WatchKind.Create | WatchKind.Delete
  h.dispose()
})

test("a `.task` edit applies the new task roots", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  const codes = async () =>
    ((await h.workspacePull()).find((r) => r.uri === w.uri("P2.pou"))?.items ?? []).map((d) => d.code)
  expect(await codes()).toEqual([]) // no task calls P2: dead, quiet
  writeFileSync(w.at("Task.task"), TASK("Main, P2"))
  await h.watched([{ uri: w.uri("Task.task"), type: FileChangeType.Changed }])
  expect(await codes()).toContain("C0032")
  h.dispose()
})

test("a reference-file change re-scans the references and re-parses no source", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  writeFileSync(w.at("Task.task"), TASK("Main, P2"))
  resetParses()
  await h.watched([{ uri: w.uri("Task.task"), type: FileChangeType.Changed }])
  expect(parsed(w.rootUri)).toEqual(new Map())
  h.dispose()
})

test(
  "a read failing with EBUSY keeps the entry, is logged, and is re-read at the next watched batch",
  async () => {
    const w = workspace()
    const h = harness()
    await h.initIn(w.root, CAPS.vscode)
    const main = w.uri("Main.pou")
    expect(await messagesOf(h, main)).not.toContain(unknownType("FB_A"))
    // The IDE is still writing FB_A.pou: its read fails with EBUSY. That is no delete — FB_A stays in the project.
    busyRead(w.at("POUs/Motor/FB_A.pou"))
    await h.watched([{ uri: w.uri("POUs/Motor/FB_A.pou"), type: FileChangeType.Changed }])
    expect(await messagesOf(h, main)).not.toContain(unknownType("FB_A"))
    expect(h.logs().some((l) => l.message.includes("EBUSY") && l.message.includes("FB_A.pou"))).toBe(true)
    // The write completes (FB_A renamed away) and the next batch — for another file — re-reads it.
    writeFileSync(w.at("POUs/Motor/FB_A.pou"), fb("FB_A9"))
    busyRead(undefined)
    appendFileSync(w.at("Other1.pou"), "// saved\n")
    await h.watched([{ uri: w.uri("Other1.pou"), type: FileChangeType.Changed }])
    expect(await messagesOf(h, main)).toContain(unknownType("FB_A"))
    h.dispose()
  },
)

test("push mode: an edit re-publishes the other open documents whose findings it moved", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.pushWatch)
  const main = w.uri("Main.pou")
  const a = w.uri("POUs/Motor/FB_A.pou")
  await h.open(main, MAIN)
  await h.open(a, fb("FB_A"))
  expect((h.published(main) ?? []).map((d) => d.message)).not.toContain(unknownType("FB_A"))
  await h.change(a, 2, fb("FB_Z")) // FB_A renamed away in the buffer: Main's `a : FB_A` no longer resolves
  expect((h.published(main) ?? []).map((d) => d.message)).toContain(unknownType("FB_A"))
  h.dispose()
})

test("push mode: a watched batch re-publishes no open document whose findings did not move", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.pushWatch)
  const main = w.uri("Main.pou")
  await h.open(main, MAIN)
  const before = h.pushCount(main)
  expect(before).toBeGreaterThan(0)
  appendFileSync(w.at("Other1.pou"), "// saved\n")
  await h.watched([{ uri: w.uri("Other1.pou"), type: FileChangeType.Changed }])
  expect(h.pushCount(main)).toBe(before)
  h.dispose()
})

// ─── the event kinds the wholesale re-crawl heals today (pins: 2.2 must keep each) ───

/** Main on disk, edited to use `FB_N` as well (a declaration the workspace does not have yet), and the watched
 *  `Changed` that says so. */
async function mainUsesFbN(h: Harness, w: ReturnType<typeof workspace>): Promise<void> {
  writeFileSync(w.at("Main.pou"), MAIN.replace("\tx : BOOL;", "\tx : BOOL;\n\tn : FB_N;"))
  await h.watched([{ uri: w.uri("Main.pou"), type: FileChangeType.Changed }])
  expect(await messagesOf(h, w.uri("Main.pou"))).toContain(unknownType("FB_N"))
}

test("a watched Created for one new source binds its declarations", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  await mainUsesFbN(h, w)
  writeFileSync(w.at("FB_N.pou"), fb("FB_N")) // the CLI's pull writes a new POU
  await h.watched([{ uri: w.uri("FB_N.pou"), type: FileChangeType.Created }])
  expect(await messagesOf(h, w.uri("Main.pou"))).not.toContain(unknownType("FB_N"))
  h.dispose()
})

test("a created folder, sent as ONE event for the folder, binds the sources under it", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  await mainUsesFbN(h, w)
  mkdirSync(w.at("POUs/New"), { recursive: true })
  writeFileSync(w.at("POUs/New/FB_N.pou"), fb("FB_N"))
  await h.watched([{ uri: w.uri("POUs/New"), type: FileChangeType.Created }])
  expect(await messagesOf(h, w.uri("Main.pou"))).not.toContain(unknownType("FB_N"))
  h.dispose()
})

test("a watched Deleted for one source drops its declarations", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  rmSync(w.at("POUs/Motor/FB_A.pou"))
  await h.watched([{ uri: w.uri("POUs/Motor/FB_A.pou"), type: FileChangeType.Deleted }])
  const main = await messagesOf(h, w.uri("Main.pou"))
  expect(main).toContain(unknownType("FB_A"))
  expect(main).not.toContain(unknownType("FB_B"))
  h.dispose()
})

test("a watched Changed for a file that is gone (stat: ENOENT) counts as its delete", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  rmSync(w.at("POUs/Motor/FB_A.pou"))
  await h.watched([{ uri: w.uri("POUs/Motor/FB_A.pou"), type: FileChangeType.Changed }])
  expect(await messagesOf(h, w.uri("Main.pou"))).toContain(unknownType("FB_A"))
  h.dispose()
})

test("a deleted file's own findings leave the workspace pull", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  // P2 is dead (no task calls it) and quiet; a `.task` that calls it shows its C0032, then the file goes.
  writeFileSync(w.at("Task.task"), TASK("Main, P2"))
  await h.watched([{ uri: w.uri("Task.task"), type: FileChangeType.Changed }])
  const p2 = w.uri("P2.pou")
  const codes = async () => ((await h.workspacePull()).find((r) => r.uri === p2)?.items ?? []).map((d) => d.code)
  expect(await codes()).toContain("C0032")
  rmSync(w.at("P2.pou"))
  await h.watched([{ uri: p2, type: FileChangeType.Deleted }])
  expect(await codes()).toEqual([])
  h.dispose()
})

test("a `.projectsettings` change re-resolves the project's configuration", async () => {
  // C0139 ("the code has no effect") is a warning the project can switch off; `b;` is such a statement.
  const root = tempWorkspace({
    "Prog.pou": `PROGRAM Prog\nVAR\n\tb : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nb;\nEND_PROGRAM\n`,
    "Project Settings.projectsettings": "Disabled warnings: \n",
  })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  const codes = async () =>
    ((await h.workspacePull()).find((r) => r.uri === fileUri(root, "Prog.pou"))?.items ?? []).map((d) => d.code)
  expect(await codes()).toContain("C0139")
  writeFileSync(join(root, "Project Settings.projectsettings"), "Disabled warnings: C0139\n")
  await h.watched([{ uri: fileUri(root, "Project Settings.projectsettings"), type: FileChangeType.Changed }])
  expect(await codes()).not.toContain("C0139")
  h.dispose()
})

test("each PLC project's documents are judged by that project's own `.projectsettings`", async () => {
  // A TwinCAT solution holds one Project Settings per PLC project, at the project's own node. `b;` is C0139.
  const prog = (name: string) => `PROGRAM ${name}\nVAR\n\tb : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nb;\nEND_PROGRAM\n`
  const root = tempWorkspace({
    "PLC/A/A Project/Project Settings.projectsettings": "Disabled warnings: C0139\n",
    "PLC/A/A Project/POUs/ProgA.pou": prog("ProgA"),
    "PLC/B/B Project/Project Settings.projectsettings": "Disabled warnings: C0371\n",
    "PLC/B/B Project/POUs/ProgB.pou": prog("ProgB"),
  })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  const codes = async (rel: string) =>
    ((await h.workspacePull()).find((r) => r.uri === fileUri(root, rel))?.items ?? []).map((d) => d.code)
  expect(await codes("PLC/A/A Project/POUs/ProgA.pou"), "A switched C0139 off").not.toContain("C0139")
  expect(await codes("PLC/B/B Project/POUs/ProgB.pou"), "B did not").toContain("C0139")
  // B's settings change: B follows it, and A keeps its own.
  writeFileSync(join(root, "PLC/B/B Project/Project Settings.projectsettings"), "Warnings as errors: C0139\n")
  await h.watched([{ uri: fileUri(root, "PLC/B/B Project/Project Settings.projectsettings"), type: FileChangeType.Changed }])
  expect(await codes("PLC/A/A Project/POUs/ProgA.pou")).not.toContain("C0139")
  const b = (await h.workspacePull()).find((r) => r.uri === fileUri(root, "PLC/B/B Project/POUs/ProgB.pou"))?.items ?? []
  expect(b.filter((d) => d.code === "C0139").map((d) => d.severity)).toEqual([1]) // Error
  h.dispose()
})

test("push mode: a watched batch re-publishes an open document whose findings it moved", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.pushWatch)
  const main = w.uri("Main.pou")
  await h.open(main, readFileSync(w.at("Main.pou"), "utf8"))
  expect((h.published(main) ?? []).map((d) => d.message)).not.toContain(unknownType("FB_A"))
  rmSync(w.at("POUs/Motor/FB_A.pou"))
  await h.watched([{ uri: w.uri("POUs/Motor/FB_A.pou"), type: FileChangeType.Deleted }])
  expect((h.published(main) ?? []).map((d) => d.message)).toContain(unknownType("FB_A"))
  h.dispose()
})

test("push mode: a watched batch publishes the manifest warnings it brought", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.pushWatch)
  const manifest = w.uri("Library Manager/Old/Old.library")
  expect(h.published(manifest)).toBeUndefined()
  mkdirSync(w.at("Library Manager/Old"), { recursive: true })
  writeFileSync(
    w.at("Library Manager/Old/Old.library"),
    "LIBRARY Old\nNAMESPACE Old\nRESOLUTION Old, 1.0.0.0 (x)\nPLACEHOLDER true\n",
  )
  await h.watched([{ uri: manifest, type: FileChangeType.Created }])
  expect(h.published(manifest)?.map((d) => d.code)).toEqual(["library-stale"])
  h.dispose()
})

// ─── review fixes (lsp-server-scheduling step 2) ───

test("a watched batch that moves several sources relinks the project once", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  await h.workspacePull() // the project is built: a batch now rebinds it, file by file
  const files = ["Other1.pou", "Other2.pou", "Other3.pou", "POUs/Motor/FB_A.pou"]
  for (const f of files) appendFileSync(w.at(f), "// pulled\n")
  resetRelinks()
  await h.watched(files.map((f) => ({ uri: w.uri(f), type: FileChangeType.Changed })))
  // one relink per batch: a `volt pull` of N files cost N relinks (~33 ms each on pro2193), slower than a re-crawl
  expect(relinked()).toBe(1)
  expect(await messagesOf(h, w.uri("Main.pou"))).not.toContain(unknownType("FB_A"))
  h.dispose()
})

test("a reference file the re-scan cannot read (EBUSY) keeps the last references, is logged, and is re-read at the next batch", async () => {
  // C0139 ("the code has no effect") is switched off by the project; `b;` is such a statement.
  const root = tempWorkspace({
    "Prog.pou": `PROGRAM Prog\nVAR\n\tb : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nb;\nEND_PROGRAM\n`,
    "Project Settings.projectsettings": "Disabled warnings: C0139\n",
    "Task.task": TASK("Prog"),
    "Other.pou": fb("FB_Other"),
  })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  const codes = async () =>
    ((await h.workspacePull()).find((r) => r.uri === fileUri(root, "Prog.pou"))?.items ?? []).map((d) => d.code)
  expect(await codes()).not.toContain("C0139")
  // The IDE is rewriting the settings (now enabling C0139) while a `.task` event re-scans the references.
  writeFileSync(join(root, "Project Settings.projectsettings"), "Disabled warnings: \n")
  busyRead(join(root, "Project Settings.projectsettings"))
  await h.watched([{ uri: fileUri(root, "Task.task"), type: FileChangeType.Changed }])
  expect(await codes()).not.toContain("C0139") // the last state the project said, never the editor default
  expect(h.logs().some((l) => l.message.includes("EBUSY") && l.message.includes("Project%20Settings.projectsettings"))).toBe(true)
  // The write completes; the next batch — for a source — re-reads the references.
  busyRead(undefined)
  appendFileSync(join(root, "Other.pou"), "// saved\n")
  await h.watched([{ uri: fileUri(root, "Other.pou"), type: FileChangeType.Changed }])
  expect(await codes()).toContain("C0139")
  h.dispose()
})

test("a case-only rename keeps the file's declarations, whichever event of the batch comes first", async () => {
  for (const order of ["created first", "deleted first"] as const) {
    const w = workspace()
    const h = harness()
    await h.initIn(w.root, CAPS.vscode)
    renameSync(w.at("POUs/Motor/FB_A.pou"), w.at("POUs/Motor/fb_a.pou"))
    const created: FileEvent = { uri: w.uri("POUs/Motor/fb_a.pou"), type: FileChangeType.Created }
    const deleted: FileEvent = { uri: w.uri("POUs/Motor/FB_A.pou"), type: FileChangeType.Deleted }
    await h.watched(order === "created first" ? [created, deleted] : [deleted, created])
    expect(await messagesOf(h, w.uri("Main.pou")), order).not.toContain(unknownType("FB_A"))
    h.dispose()
  }
})

test("a folder removed and re-created drops the entries the disk no longer has, in every form a host sends", async () => {
  // `git checkout` or `volt pull` rewriting a folder: Deleted + Created (either order), or one coalesced Changed.
  const forms: Record<string, (folder: string) => FileEvent[]> = {
    "deleted then created": (uri) => [
      { uri, type: FileChangeType.Deleted },
      { uri, type: FileChangeType.Created },
    ],
    "created then deleted": (uri) => [
      { uri, type: FileChangeType.Created },
      { uri, type: FileChangeType.Deleted },
    ],
    "one changed": (uri) => [{ uri, type: FileChangeType.Changed }],
  }
  for (const [form, events] of Object.entries(forms)) {
    const w = workspace()
    const h = harness()
    await h.initIn(w.root, CAPS.vscode)
    rmSync(w.at("POUs/Motor"), { recursive: true })
    mkdirSync(w.at("POUs/Motor"))
    writeFileSync(w.at("POUs/Motor/FB_C.pou"), fb("FB_C"))
    await h.watched(events(w.uri("POUs/Motor")))
    const main = await messagesOf(h, w.uri("Main.pou"))
    expect(main, form).toContain(unknownType("FB_A"))
    expect(main, form).not.toContain(unknownType("FB_B"))
    h.dispose()
  }
})

const logged = (h: Harness, ...parts: string[]) => h.logs().some((l) => parts.every((p) => l.message.includes(p)))

test("a reference re-scan that cannot list a folder keeps the last references, logs the folder, and re-scans at the next batch", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  const main = w.uri("Main.pou")
  expect(await messagesOf(h, main)).not.toContain("Identifier 'Dev1' not defined")
  deniedList(w.at("Devices"))
  await h.watched([{ uri: w.uri("Task.task"), type: FileChangeType.Changed }])
  expect(await messagesOf(h, main)).not.toContain("Identifier 'Dev1' not defined") // never a guessed unbind
  expect(logged(h, "EPERM", w.uri("Devices"))).toBe(true)
  // The device goes while the folder cannot be listed; once it can, the next batch — for a source — re-scans.
  rmSync(w.at("Devices/Dev1.device"))
  deniedList(undefined)
  appendFileSync(w.at("Other1.pou"), "// saved\n")
  await h.watched([{ uri: w.uri("Other1.pou"), type: FileChangeType.Changed }])
  expect(await messagesOf(h, main)).toContain("Identifier 'Dev1' not defined")
  h.dispose()
})

test("a directory event under which a folder cannot be listed keeps that folder's entries, logs it, and re-reads it at the next batch", async () => {
  const w = workspace()
  const h = harness()
  await h.initIn(w.root, CAPS.vscode)
  const main = w.uri("Main.pou")
  deniedList(w.at("POUs/Motor"))
  await h.watched([{ uri: w.uri("POUs"), type: FileChangeType.Changed }])
  expect(await messagesOf(h, main)).not.toContain(unknownType("FB_A")) // never a guessed delete
  expect(logged(h, "EPERM", w.uri("POUs/Motor"))).toBe(true)
  rmSync(w.at("POUs/Motor/FB_A.pou"))
  deniedList(undefined)
  appendFileSync(w.at("Other1.pou"), "// saved\n")
  await h.watched([{ uri: w.uri("Other1.pou"), type: FileChangeType.Changed }])
  expect(await messagesOf(h, main)).toContain(unknownType("FB_A"))
  h.dispose()
})

test("a folder the crawl cannot list is logged, and its sources are read at the next batch", async () => {
  const w = workspace()
  const h = harness()
  deniedList(w.at("POUs/Motor"))
  await h.initIn(w.root, CAPS.vscode)
  expect(logged(h, "EPERM", w.uri("POUs/Motor"))).toBe(true)
  deniedList(undefined)
  appendFileSync(w.at("Other1.pou"), "// saved\n")
  await h.watched([{ uri: w.uri("Other1.pou"), type: FileChangeType.Changed }])
  expect(await messagesOf(h, w.uri("Main.pou"))).not.toContain(unknownType("FB_A"))
  h.dispose()
})

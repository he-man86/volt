import { afterEach, expect, mock, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DetectedProject } from "./connector.js"
import { boundWorkspace as ws } from "../test-support.js"


/**
 * The ARGV contract between this package and the `volt` CLI.
 *
 * This layer was untested, and that is exactly where a real bug lived: volt-control faithfully passed `--force`
 * for a Force Pull while the CLI had no such parameter and silently ignored the unknown flag — so the user
 * confirmed a "this cannot be undone" dialog and got a plain pull. The CLI-side tests were green (they call
 * Commands.Pull directly) and the C# side was green; nobody checked the seam.
 *
 * So: assert the flags each action actually sends. A flag that the CLI does not implement is still a bug, but it
 * is a bug these tests can be pointed at, instead of one that only shows up as "the button does nothing".
 */
// Intercept the ONE function that shells out, so each test can read back the exact argv. mock.module has to be
// installed before actions.js is imported, hence the dynamic import below.
let lastArgs: string[] = []
let nextStdout = "{}"
void mock.module("./cli.js", () => ({
  runVolt: async (_root: string, args: string[]) => {
    lastArgs = args
    return { code: 0, stdout: nextStdout, stderr: "" }
  },
  cliScript: () => "volt",
  setBundledCli: () => {},
}))

const { pull, push, fetchStatus, rebind, init, build, mergeContinue, mergeAbort, mergeResolve } =
  await import("./actions.js")
const { __resetSessionForTest } = await import("./session.js")

const detected = (over: Partial<DetectedProject>): DetectedProject =>
  ({ id: "codesys::P:", vendor: "codesys", dirty: false, projectName: "Disp", ...over })

// rebind validates the bridge via a session select (POST /session + /sync). Mock that API: `serving` decides whether
// the /sync view shows the picked project (id "codesys::P:") as serving, which is what gates the config rewrite.
function stubConnect(serving: boolean): () => void {
  const real = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith("/session") && init?.method === "POST") return { ok: true, status: 200, json: async () => ({ sessionId: "s1", leaseSeconds: 15 }) } as Response
    if (u.includes("/sync")) {
      // Echo the declared interests back as serving rows (that's what selectPickedProject checks), so the mock works
      // for whatever project a test picks.
      const interests = init?.body ? (JSON.parse(String(init.body)).interests as { vendor: string; projectName: string }[]) : []
      const projects = serving ? interests.map((i) => ({ id: `${i.vendor}::${i.projectName}:`, vendor: i.vendor, dirty: false, status: "healthy", projectName: i.projectName })) : []
      return { ok: true, status: 200, json: async () => ({ projects }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as typeof fetch
  return () => void (globalThis.fetch = real)
}

function captureArgs(stdout = "{}"): void {
  lastArgs = []
  nextStdout = stdout
}

afterEach(() => {
  lastArgs = []
  __resetSessionForTest() // rebind now uses the module-singleton session client
})


const boundWorkspace = () => ws({ vendor: "codesys", projectName: "P" })

test("pull sends --force ONLY when asked — the flag the Force Pull button depends on", async () => {
  const dir = boundWorkspace()
  try {
    captureArgs('{"kind":"ok","synced":[]}')
    await pull(dir)
    expect(lastArgs).not.toContain("--force")

    captureArgs('{"kind":"ok","synced":[]}')
    await pull(dir, { force: true })
    expect(lastArgs).toContain("--force") // the whole reason Force Pull exists
    expect(lastArgs[0]).toBe("pull")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("push sends --force only when asked", async () => {
  const dir = boundWorkspace()
  try {
    captureArgs('{"kind":"ok","items":[]}')
    await push(dir)
    expect(lastArgs).not.toContain("--force")

    captureArgs('{"kind":"ok","items":[]}')
    await push(dir, { force: true })
    expect(lastArgs).toContain("--force")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// rebind is config-only: reconnect the bridge, then `volt rebind` with the row's name. It must never fall
// through to the destructive init re-seed it replaced.
//
// This used to pass a row with BOTH `projectName: "NewName"` and `displayName: "ShouldNotBeUsed"`, to prove
// rebind reads the first — a distinction the connector never produced, since both fields were filled from the
// one `health` field on every row. With `displayName` gone there is one name and nothing to pick wrongly.
test("rebind reconnects, then sends `rebind` with the row's projectName", async () => {
  const dir = boundWorkspace()
  const restore = stubConnect(true)
  try {
    captureArgs()
    const r = await rebind(dir, detected({ id: "codesys::New:", projectName: "NewName" }))
    expect(r.ok).toBe(true)
    expect(lastArgs).toEqual(["rebind", "--vendor", "codesys", "--project-name", "NewName", "--workspace", dir])
  } finally {
    restore()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rebind rewrites NOTHING when the bridge won't attach — no CLI call", async () => {
  const dir = boundWorkspace()
  const restore = stubConnect(false) // the bridge won't attach (not serving)
  try {
    captureArgs()
    const r = await rebind(dir, detected({}))
    expect(r.ok).toBe(false)
    expect(lastArgs).toEqual([]) // never reached `volt rebind`, so the config is left alone
  } finally {
    restore()
    rmSync(dir, { recursive: true, force: true })
  }
})

// `--local` skips the IDE walk (/refs), which is what stops a local save from freezing CODESYS for seconds. If
// this flag stops being sent, nothing breaks visibly — it just gets slow again, which is the kind of regression
// that survives for months.
test("fetchStatus sends --local only in local mode", async () => {
  const dir = boundWorkspace()
  const realFetch = globalThis.fetch
  // fetchStatus consults the connector for health first; report a live, serving project so it reaches the CLI.
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        projects: [{ id: "codesys::P:", vendor: "codesys", dirty: false, status: "healthy", projectName: "P" }],
      }),
    }) as Response) as typeof fetch
  try {
    captureArgs('{"initialized":true,"incoming":{"added":[],"removed":[],"modified":[]},"outgoing":{"added":[],"removed":[],"modified":[]},"pathByName":{},"summary":""}')
    await fetchStatus(dir)
    expect(lastArgs).toEqual(["status", "--json"])

    captureArgs('{"initialized":true,"incoming":{"added":[],"removed":[],"modified":[]},"outgoing":{"added":[],"removed":[],"modified":[]},"pathByName":{},"summary":"","incomingStale":true}')
    await fetchStatus(dir, true)
    expect(lastArgs).toContain("--local")
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

/*
 * THE OTHER HALF OF THE SAME SEAM.
 *
 * The tests above cover pull/push/rebind/fetchStatus. `init`, `build` and the three merge verbs send argv the same
 * way and had no test at all — including `mergeResolve`'s side→flag mapping, which is precisely the shape of the
 * `--force` bug this file exists for: a value the UI picks, translated into a flag the CLI must implement, with
 * nothing checking the translation. Both frontends drive all of these.
 */

// `--json`, like every other action. It did not pass it and returned the raw CliResult, and both shells then
// read `stderr` — where a build writes nothing, because the diagnostics go to stdout and `runCli` strips the
// progress frames stderr does carry. A failing build reported "exit 2" and showed none of the errors.
test("build asks for json, so the shells get diagnostics rather than an exit code", async () => {
  const dir = boundWorkspace()
  try {
    await build(dir)
    expect(lastArgs).toEqual(["build", "--json", "--workspace", dir])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("merge --continue and --abort each send their own flag", async () => {
  const dir = boundWorkspace()
  try {
    await mergeContinue(dir)
    expect(lastArgs).toEqual(["merge", "--continue", "--workspace", dir])

    await mergeAbort(dir)
    expect(lastArgs).toEqual(["merge", "--abort", "--workspace", dir])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("mergeResolve maps MINE to --use-ours and IDE to --use-theirs", async () => {
  // The mapping is the whole test. "mine" is the workspace side (ours) and "ide" is the incoming side (theirs);
  // swapping them silently resolves every conflict the wrong way — the file is staged, the merge finishes, and
  // the engineer's edit is gone with no error anywhere.
  const dir = boundWorkspace()
  try {
    await mergeResolve(dir, "POUs/FB_X.fb", "mine")
    expect(lastArgs).toEqual(["merge", "--resolve", "POUs/FB_X.fb", "--use-ours", "--workspace", dir])

    await mergeResolve(dir, "POUs/FB_X.fb", "ide")
    expect(lastArgs).toEqual(["merge", "--resolve", "POUs/FB_X.fb", "--use-theirs", "--workspace", dir])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("init names the vendor, asks for JSON, and creates under the PARENT", async () => {
  const parent = boundWorkspace()
  nextStdout = JSON.stringify({ workspace: join(parent, "Proj") })
  try {
    const r = await init(parent, "twincat")
    expect(lastArgs).toEqual(["init", "--vendor", "twincat", "--json", "--workspace", parent])
    // `volt init` makes <parent>/<project>/ and RETURNS it — the shells must bind the returned path, not the
    // parent they passed in, so the lift out of --json is part of the contract too.
    expect(r.workspace).toBe(join(parent, "Proj"))
  } finally { nextStdout = "{}"; rmSync(parent, { recursive: true, force: true }) }
})

test("init lifts a --json {reason} failure into stderr, where both shells read it", async () => {
  // With --json the CLI reports the failure as {reason} and leaves stderr EMPTY. Without this lift the user sees
  // a blank error.
  const parent = boundWorkspace()
  nextStdout = JSON.stringify({ reason: "no project is open in that IDE" })
  try {
    const r = await init(parent, "codesys")
    expect(r.stderr).toBe("no project is open in that IDE")
  } finally { nextStdout = "{}"; rmSync(parent, { recursive: true, force: true }) }
})


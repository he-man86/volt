import { afterEach, expect, mock, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"


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

const { pull, push, fetchStatus } = await import("./actions.js")

function captureArgs(stdout = "{}"): void {
  lastArgs = []
  nextStdout = stdout
}

afterEach(() => {
  lastArgs = []
})

function boundWorkspace(): string {
  const dir = join(tmpdir(), `volt-args-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, ".git", "volt"), { recursive: true })
  writeFileSync(join(dir, ".git", "volt", "config.json"), JSON.stringify({ bridge: { vendor: "codesys" }, project: { platform: "codesys", projectName: "P" } }))
  return dir
}

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
        status: "Connected",
        bridges: [{ vendor: "codesys", displayName: "CODESYS", status: "Connected", projectName: "P", dirty: false, activeOp: null }],
        projects: [{ id: "codesys::P:", displayName: "P", vendor: "codesys", dirty: false, connected: true, serving: true, projectName: "P" }],
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

import { test, expect, afterAll } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import electronPath from "electron"

/**
 * The opencode integration, driven end to end — the ONE part of Volt that reads someone else's UI, so the one part
 * that must never be verified by reading a log and nodding. This launches the REAL shell (which spawns the REAL
 * installed opencode), drives opencode's GUI over the Chrome DevTools Protocol, and asserts the consequence at the
 * far end of the chain: the connector actually serving (or not serving) the project.
 *
 *   route in opencode's GUI → classifyRoute → bindWorkspace → connectWorkspace → connector binds the bridge
 *
 * Every link is exercised; nothing is stubbed. What it pins:
 *   1. HOME binds nothing and serves nothing. (Volt used to bind the last project here — opencode's client keeps
 *      naming it on its requests — and auto-connect then made the connector SERVE a project nobody had opened.)
 *   2. A PROJECT page binds that project and the connector serves it, with NO chat session needed. (The old
 *      request-stream sniff saw nothing until you sent a chat message, because a session-less project emits only
 *      `/global/health`.)
 *   3. Going back HOME releases it and the connector stops serving.
 *
 * SKIPS (never fails) when the environment can't support it: no opencode installed, no connector running, or no
 * detected CODESYS/TwinCAT project to bind. Run it with a project open in the IDE:
 *     bun run build && bun test test/e2e/opencode-binding.test.ts
 */

const root = join(import.meta.dir, "..", "..")
const CONTROL = process.env.VOLT_CONTROL_BASE ?? "http://127.0.0.1:8550"
const CDP_PORT = Number(process.env.VOLT_CDP_PORT ?? 9333)

interface Row { displayName: string; projectName: string; vendor: string; status?: string }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function connectorProjects(): Promise<Row[] | undefined> {
  try {
    const r = await fetch(`${CONTROL}/status`, { signal: AbortSignal.timeout(4000) })
    return r.ok ? ((await r.json()) as { projects: Row[] }).projects : undefined
  } catch {
    return undefined
  }
}

/** Poll until `check` passes or the deadline — the app is event-driven, so this is "settled by", not "sleep". */
async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 25_000): Promise<T> {
  const deadline = Date.now() + ms
  let last = await get()
  while (!ok(last) && Date.now() < deadline) {
    await sleep(500)
    last = await get()
  }
  return last
}

const serving = (rows: Row[] | undefined, name: string): boolean =>
  (rows ?? []).some((p) => p.projectName === name && (p.status === "healthy" || p.status === "degraded"))

/** The GUI page (not the Volt shell) among electron's CDP targets — it's the one on opencode's server. */
async function guiTarget(): Promise<{ id: string; url: string } | undefined> {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(4000) })
    const targets = (await r.json()) as { id: string; type: string; url: string }[]
    return targets.find((t) => t.type === "page" && /^https?:\/\/127\.0\.0\.1:\d+\//.test(t.url) && !t.url.includes("shell.html"))
  } catch {
    return undefined
  }
}

/** Navigate the GUI page by URL — CDP's HTTP endpoint can open a target, but driving the EXISTING page needs the
 *  websocket, so talk to it directly. One command per call keeps this dependency-free. */
async function navigate(url: string): Promise<void> {
  const t = await guiTarget()
  if (t === undefined) throw new Error("no opencode GUI target")
  const ws = new WebSocket(`ws://127.0.0.1:${CDP_PORT}/devtools/page/${t.id}`)
  await new Promise((res, rej) => {
    ws.onopen = () => res(undefined)
    ws.onerror = () => rej(new Error("CDP websocket failed"))
  })
  ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } }))
  await sleep(1500) // let the SPA route settle (did-navigate → classifyRoute → bind)
  ws.close()
}

/** Kill whatever LISTENS on a port, process tree and all. The app frees its own pinned opencode port at startup, but
 *  this test must also clean up after ITSELF: `app.kill()` reaps electron without running its clean-quit handler, so
 *  the `opencode serve` it spawned survives — and that orphan then owns the port the NEXT run needs, which failed the
 *  second run of this very test while the first one passed. */
function killPortListener(port: number): void {
  const out = spawnSync("cmd", ["/c", `netstat -ano | findstr LISTENING | findstr :${port}`], { encoding: "utf8" }).stdout ?? ""
  for (const pid of new Set(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter((p) => p && /^\d+$/.test(p) && p !== "0")))
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"])
}

const OPENCODE_PORT = Number(process.env.VOLT_E2E_OPENCODE_PORT ?? 8549)

let app: ChildProcess | undefined
afterAll(() => {
  if (app?.pid !== undefined) spawnSync("taskkill", ["/pid", String(app.pid), "/T", "/F"]) // the TREE — see above
  killPortListener(OPENCODE_PORT)
})

test("the binding follows opencode's route: home serves nothing, a project page serves it, home releases it", async () => {
  if (!existsSync(join(root, "main.mjs"))) return console.log("SKIP: run `bun run build` first")

  const before = await connectorProjects()
  if (before === undefined) return console.log("SKIP: the Volt Connector isn't running")
  const target = before.find((p) => p.vendor === "codesys" || p.vendor === "twincat")
  if (target === undefined) return console.log("SKIP: no PLC project detected — open one in your IDE")

  // A Volt workspace bound to that project must exist for the bind to connect anything.
  const workspace = process.env.VOLT_E2E_WORKSPACE
  if (workspace === undefined || !existsSync(join(workspace, ".git", "volt", "config.json")))
    return console.log("SKIP: set VOLT_E2E_WORKSPACE to a Volt workspace bound to the detected project")

  killPortListener(OPENCODE_PORT) // a previous run's orphan would make this one's opencode fail to bind
  app = spawn(electronPath as unknown as string, ["--no-sandbox", `--remote-debugging-port=${CDP_PORT}`, "."], {
    cwd: root,
    // A dedicated opencode port: the shell frees its pinned port before binding it, so sharing the default would
    // kill the opencode of any Volt app the developer has open.
    env: { ...process.env, OPENCODE_PORT: String(OPENCODE_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  app.stdout?.on("data", (b: Buffer) => (log += String(b)))
  app.stderr?.on("data", (b: Buffer) => (log += String(b)))

  // 1. HOME — the shell loads opencode's home route. Nothing may bind, nothing may be served.
  const gui = await until(guiTarget, (t) => t !== undefined, 60_000)
  // On failure the app's own output is the diagnosis (opencode missing, port taken, a crash) — print it, don't
  // leave the reader with "expected defined".
  if (gui === undefined) console.log(["  --- app output ---", log].join("\n"))
  expect(gui, "opencode GUI never loaded — see the app output above").toBeDefined()
  console.log(`  GUI at ${gui!.url}`)
  await sleep(3000) // give a wrong implementation time to bind off the request stream
  expect(log).toContain("nav / → home")
  console.log(`  home:    ${(await connectorProjects())?.map((p) => `${p.displayName}[${p.status}]`).join(", ")}`)
  expect(serving(await connectorProjects(), target.projectName), "home must not serve a project").toBe(false)

  // 2. PROJECT — navigate straight to the project page. No chat, no session: the route alone must bind + connect.
  const base = new URL(gui!.url).origin
  await navigate(`${base}/${Buffer.from(workspace, "utf8").toString("base64url")}`)
  const rows = await until(connectorProjects, (r) => serving(r, target.projectName))
  console.log(`  project: ${rows?.map((p) => `${p.displayName}[${p.status}]`).join(", ")}`)
  expect(serving(rows, target.projectName), "a project page must bind and connect it — with no chat session").toBe(true)
  expect(log).toContain(`project ${workspace}`)

  // 3. HOME again — leaving the project releases it, and the connector gates the bridge.
  await navigate(`${base}/`)
  const after = await until(connectorProjects, (r) => !serving(r, target.projectName))
  console.log(`  home:    ${after?.map((p) => `${p.displayName}[${p.status}]`).join(", ")}`)
  const binds = log.split(/\r?\n/).filter((l) => l.includes("[desktop]"))
  console.log(["  --- bind log ---", ...binds.map((l) => "  " + l)].join("\n"))
  expect(serving(after, target.projectName), "leaving the project must stop serving it").toBe(false)
}, 180_000)

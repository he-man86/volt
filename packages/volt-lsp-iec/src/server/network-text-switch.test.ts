/**
 * LD AND FBD ARE OFF IN THE LSP UNLESS ITS PROCESS SAYS `VOLT_GRAPHICAL=1` (openspec `implementation-keyword` 3c:
 * "exactly one flag per runtime: one in the C# engine and one in the LSP … the LSP SHALL read nothing under an LD/FBD
 * line").
 *
 * WHY a switch here too: network text is not ready to ship, and a shipped editor must not analyse it any more than a
 * shipped bridge pulls it. A production bridge already pulls every LD and FBD body as its UNSUPPORTED line; this is the
 * editor's half, for a file that states `IMPLEMENTATION LD|FBD` anyway (pulled from a development bridge, or written by
 * hand). Off, such a body is read by NEITHER parser and draws nothing — no network finding, and no refusal: whether the
 * push accepts it is the bridge's answer, from the bridge's own switch, which this process cannot see. ST is untouched.
 * The switch is read once from the environment, so "off" is proved in a child process started without the variable,
 * as an editor launched normally starts this server; the suite itself runs with it on (`bunfig.toml`).
 */
import { expect, test } from "bun:test"
import path from "node:path"
import { NETWORK_TEXT_ENABLED } from "../syntax/index.js"

const PACKAGE = path.resolve(import.meta.dir, "..", "..")

/** Pull diagnostics for `src` from a server running in a child process whose environment is `graphical`. */
async function diagnostics(src: string, graphical: "1" | undefined): Promise<{ code: string; message: string }[]> {
  const script = `
    import { CAPS, harness } from "./src/server/harness.ts"
    const h = harness()
    await h.init(CAPS.pull)
    await h.open("file:///F.fb", ${JSON.stringify(src)})
    const ds = await h.pull("file:///F.fb")
    h.dispose()
    console.log(JSON.stringify(ds.map((d) => ({ code: String(d.code), message: typeof d.message === "string" ? d.message : d.message.value }))))
    process.exit(0)
  `
  const env: Record<string, string | undefined> = { ...process.env }
  if (graphical === undefined) delete env.VOLT_GRAPHICAL
  else env.VOLT_GRAPHICAL = graphical
  const proc = Bun.spawn([process.execPath, "-e", script], { cwd: PACKAGE, env, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  expect(err).not.toContain("error:")
  expect(code).toBe(0)
  return JSON.parse(out.trim().split("\n").at(-1)!)
}

/** A function block whose body is `impl`. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\n\ti : INT;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

// ST under an LD line is a NETWORK_ finding — proof the network parser read the body.
const LADDER_THAT_IS_NOT = fb("IMPLEMENTATION LD\nout := a;")

test("the suite runs with the switch on", () => {
  expect(process.env.VOLT_GRAPHICAL).toBe("1")
  expect(NETWORK_TEXT_ENABLED).toBe(true)
})

test("with VOLT_GRAPHICAL=1, an LD body is read as network text", async () => {
  const ds = await diagnostics(LADDER_THAT_IS_NOT, "1")
  expect(ds.some((d) => d.code.startsWith("NETWORK_"))).toBe(true)
}, 30_000)

test("without VOLT_GRAPHICAL, nothing under an LD or FBD line is read: no network finding, no refusal claimed", async () => {
  for (const language of ["LD", "FBD"])
    expect(await diagnostics(fb(`IMPLEMENTATION ${language}\nout := a;`), undefined)).toEqual([])
}, 30_000)

test("without VOLT_GRAPHICAL, ST is read as before", async () => {
  const ds = await diagnostics(fb("IMPLEMENTATION ST\nout := ;"), undefined)
  expect(ds.length).toBeGreaterThan(0)
  expect(ds.some((d) => d.code.startsWith("NETWORK_"))).toBe(false)
}, 30_000)

test("without VOLT_GRAPHICAL, the UNSUPPORTED line a bridge with LD and FBD off pulls draws nothing", async () => {
  for (const language of ["LD", "FBD"])
    expect(await diagnostics(fb(`IMPLEMENTATION ${language} UNSUPPORTED\n`), undefined)).toEqual([])
}, 30_000)

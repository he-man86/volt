/**
 * The LSP reads a body as the file states it, whatever its OWN environment says about LD and FBD (openspec
 * `implementation-keyword` 3c).
 *
 * WHY: whether network text is enabled is the BRIDGE's switch (`NetworkTextSwitch` in volt-cli), and the bridge is a
 * different process from the editor that starts this server — `ide.ps1` turns it on for CODESYS and the TwinCAT worker,
 * while an editor opened from the Start menu never sees it. An LSP with a switch of its own therefore disagreed with the
 * bridge in the ordinary dev loop: it called a pulled `IMPLEMENTATION LD` body one "the push refuses" while that
 * bridge accepted the push, and dropped every network finding under it. The file already carries the bridge's verdict —
 * a bridge with LD and FBD off pulls such a body as `IMPLEMENTATION LD|FBD UNSUPPORTED`, which draws nothing here — and
 * network text written by hand at such a bridge is refused by name on push. So this server has no switch.
 *
 * The server is started in a child process whose environment lacks `VOLT_GRAPHICAL`, as an editor launched normally
 * starts it.
 */
import { expect, test } from "bun:test"
import path from "node:path"

const PACKAGE = path.resolve(import.meta.dir, "..", "..")

/** Pull diagnostics for `src` from a server running in a process without `VOLT_GRAPHICAL`. */
async function diagnosticsWithoutTheVariable(src: string): Promise<{ code: string; message: string }[]> {
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
  delete env.VOLT_GRAPHICAL
  const proc = Bun.spawn([process.execPath, "-e", script], { cwd: PACKAGE, env, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  expect(err).not.toContain("error:")
  expect(code).toBe(0)
  return JSON.parse(out.trim().split("\n").at(-1)!)
}

/** A function block whose body is `impl`. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\n\ti : INT;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

test("without VOLT_GRAPHICAL, an LD body is still read as network text: its network findings, no refusal claimed", async () => {
  // ST under an LD line is a NETWORK_ finding — proof the network parser read the body.
  const ds = await diagnosticsWithoutTheVariable(fb("IMPLEMENTATION LD\nout := a;"))
  expect(ds.some((d) => d.code.startsWith("NETWORK_"))).toBe(true)
  expect(ds.some((d) => d.message.includes("not enabled"))).toBe(false)
}, 30_000)

test("without VOLT_GRAPHICAL, the UNSUPPORTED line a bridge with LD and FBD off pulls draws nothing", async () => {
  for (const language of ["LD", "FBD"])
    expect(await diagnosticsWithoutTheVariable(fb(`IMPLEMENTATION ${language} UNSUPPORTED\n`))).toEqual([])
}, 30_000)

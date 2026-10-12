/**
 * The `volt-lsp-iec` CLI entry (`bin.ts`), run as a process: `--version` prints the version (`(dev)` when compiled without
 * the build's define), `--codesys` and `--twincat` together are refused, and no `--stdio` is the usage. What `--stdio`
 * serves is `runServer`'s (`server.test.ts`); which vendor it serves is `vendor.test.ts`'s.
 */
import { expect, test } from "bun:test"
import { join } from "node:path"

const BIN = join(import.meta.dir, "bin.ts")

/** Run the entry with `args`; its exit code and both streams. */
async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn([process.execPath, BIN, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, out: out.trim(), err: err.trim() }
}

test("--version prints the name and the version, and exits 0", async () => {
  expect(await run("--version")).toEqual({ code: 0, out: "volt-lsp-iec (dev)", err: "" })
})

test("--codesys and --twincat together are refused by name", async () => {
  expect(await run("--stdio", "--codesys", "--twincat")).toEqual({
    code: 1,
    out: "",
    err: "volt-lsp-iec: --codesys and --twincat are exclusive",
  })
})

test("without --stdio the entry prints its usage and exits 1", async () => {
  expect(await run()).toEqual({ code: 1, out: "", err: "usage: volt-lsp-iec --stdio [--codesys|--twincat]" })
})

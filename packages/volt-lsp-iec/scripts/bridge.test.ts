/**
 * `requireNetworkText` / `pipeName` — the guards the corpus refresh and the language recorder run before they touch a
 * bridge (openspec `implementation-keyword` 3c; which pipe: the fixture-instance rule in volt-cli's `fixture-ide.ts`,
 * unit-tested there as facts — here only that `bridge.ts` goes through it and keeps no fallback name of its own).
 *
 * WHY: LD and FBD network text is switched on in the BRIDGE's process (`VOLT_GRAPHICAL=1`), which these scripts cannot
 * set. A bridge started by the connector has it off, pulls every LD and FBD body as its UNSUPPORTED line, and a corpus
 * refreshed through it silently lost every ladder. The bridge reports its switch in `health`; these tests serve that
 * answer from a real named pipe, as a bridge does, and hold the guard to it.
 */
import { afterEach, expect, test } from "bun:test"
import { createServer, type Server } from "node:net"
import { FixtureRefusal } from "../../volt-cli/test/e2e/lib/fixture-ide.js"
import { landedInFull, pipeName, requireNetworkText } from "./bridge.js"

const servers: Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
  delete process.env.VOLT_PIPE
})

/** A pipe that answers `health` with `result`, one newline-JSON frame per connection, as the pipe host does. */
async function bridgeAnswering(name: string, result: unknown): Promise<string> {
  const server = createServer((sock) => {
    sock.once("data", () => sock.end(JSON.stringify({ result }) + "\n"))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(`\\\\.\\pipe\\${name}`, resolve))
  return name
}

const unique = (what: string) => `volt.test.${what}.${process.pid}.${Math.random().toString(36).slice(2)}`

test("a bridge with LD and FBD on passes", async () => {
  const pipe = await bridgeAnswering(unique("on"), { projects: [], networkText: true })
  await requireNetworkText(pipe)
})

test("a bridge with LD and FBD off is refused, naming the switch and how to turn it on", async () => {
  const pipe = await bridgeAnswering(unique("off"), { projects: [], networkText: false })
  const err = await requireNetworkText(pipe).then(() => undefined, (e: Error) => e)
  expect(err?.message).toContain("OFF")
  expect(err?.message).toContain("VOLT_GRAPHICAL=1")
  expect(err?.message).toContain("ide.ps1 up")
})

test("a bridge that does not say is refused: absent is off", async () => {
  const pipe = await bridgeAnswering(unique("silent"), { projects: [] })
  expect(requireNetworkText(pipe)).rejects.toThrow("OFF")
})

test("pipeName has no name of its own: the bare `volt.bridge.<vendor>` it used to fall back to is refused as a prefix", () => {
  // Refused before any pipe is touched — on Windows because a prefix is discovery, elsewhere because there is no
  // process table to prove ownership from. Either way: no fixture instance's word, no pipe.
  process.env.VOLT_PIPE = "volt.bridge.codesys"
  expect(() => pipeName("codesys")).toThrow(FixtureRefusal)
})

// `landedInFull` — `accepted` alone no longer means "every op is in the IDE" (openspec push-keeps-what-landed): an
// apply-time refusal after earlier ops landed answers accepted WITH conflicts, and a recorder that reads `accepted`
// alone records a build of a project missing the refused item.
test("a push lands in full only when it is accepted with no conflict", () => {
  expect(landedInFull({ accepted: true })).toBe(true)
  expect(landedInFull({ accepted: true, conflicts: null })).toBe(true)
  expect(landedInFull({ accepted: true, conflicts: [] })).toBe(true)
  expect(landedInFull({ accepted: false, conflicts: [{ name: "A.pou", code: "INVALID_ST" }] })).toBe(false)
  expect(
    landedInFull({
      accepted: true,
      conflicts: [{ name: "PRG_caller.pou", code: "UNSUPPORTED", reason: "the IDE builds that box with no ENO output" }],
    }),
  ).toBe(false)
})

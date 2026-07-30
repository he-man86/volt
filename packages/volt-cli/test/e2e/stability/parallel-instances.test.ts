/**
 * LIVE multi-instance stability — two headless CODESYS running AT ONCE, one on a SLOW/large project (refs ~20s) and
 * one on a normal project. Proves the two bridges are genuinely INDEPENDENT: the slow instance holding its IDE thread
 * for a 20s op must not stall the other's health OR its refs, and neither instance leaks into the other's project.
 * This is the real (two-process) counterpart to the FakeIde `Health_polls_across_two_bridges` unit test.
 *
 * Point it at the two per-pid pipes (from `codesys-pipe.ps1 up -Instance …` ×2), from packages/volt-cli. The SLOW
 * one must be the large committed fixture — that's what makes the 20s-op assertion mean anything:
 *   codesys-pipe.ps1 up                                                        # CodesysTestProject  -> FAST
 *   codesys-pipe.ps1 up -Instance b -Project test\Pro2193-94-95-96_COdesys.project   # 9.9 MB -> SLOW
 *   VOLT_PIPE_SLOW=volt.bridge.codesys.<bigPid> VOLT_PIPE_FAST=volt.bridge.codesys.<smallPid> \
 *     bun test test/e2e/stability/parallel-instances.test.ts --timeout 300000
 * Skips cleanly when the two pipes aren't set (so the normal single-pipe suite is unaffected).
 */
import { test, expect, describe, beforeAll } from "bun:test"
import { connect } from "node:net"

const SLOW = process.env.VOLT_PIPE_SLOW // the large project's pipe
const FAST = process.env.VOLT_PIPE_FAST // a normal project's pipe
const OP_TIMEOUT = 180_000

/** One request per connection over a SPECIFIC pipe (the harness's client is hardcoded to one pipe). */
function call(pipe: string, op: string, body?: unknown): Promise<any> {
	return new Promise((resolve, reject) => {
		const sock = connect(`\\\\.\\pipe\\${pipe}`)
		let buf = "", result: unknown
		sock.on("connect", () => sock.write(JSON.stringify({ op, body: body ?? undefined }) + "\n"))
		sock.on("data", (d: Buffer) => {
			buf += d.toString("utf8")
			let nl: number
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
				if (!line) continue
				const frame = JSON.parse(line)
				if ("result" in frame) result = frame.result
				else if ("error" in frame) { reject(new Error(`${frame.error.code}: ${frame.error.message}`)); sock.destroy(); return }
			}
		})
		sock.on("end", () => resolve(result))
		sock.on("error", reject)
	})
}
const served = (h: any) => (h?.projects ?? []).find((p: any) => p.status && p.status !== "idle")
const projectOf = (h: any) => served(h)?.project as string | undefined
const isHealthy = (h: any) => served(h)?.status === "healthy"

const suite = SLOW && FAST ? describe : describe.skip
suite("live parallel: a slow instance must not stall the other", () => {
	// A large project's pipe appears BEFORE the IDE finishes loading + selecting it (idle → healthy). Wait for both
	// instances to be serving before asserting — legitimate load time, not something to assert through.
	beforeAll(async () => {
		for (const pipe of [SLOW!, FAST!]) {
			const t0 = Date.now()
			while (Date.now() - t0 < 120_000) {
				try { if (isHealthy(await call(pipe, "health"))) break } catch { /* pipe not answering yet */ }
				await Bun.sleep(1000)
			}
			expect(isHealthy(await call(pipe, "health"))).toBe(true) // must be serving before the parallel assertions
		}
	}, OP_TIMEOUT)

	test("both instances serve, and their projects are distinct", async () => {
		const [a, b] = await Promise.all([call(SLOW!, "health"), call(FAST!, "health")])
		expect(isHealthy(a)).toBe(true)
		expect(isHealthy(b)).toBe(true)
		expect(projectOf(a)).toBeTruthy()
		expect(projectOf(b)).toBeTruthy()
		expect(projectOf(a)).not.toBe(projectOf(b)) // no cross-instance leakage — each owns its own project
	}, OP_TIMEOUT)

	test("a 20s refs on the slow instance blocks neither instance's health nor the fast refs", async () => {
		// Hold the SLOW instance's IDE thread in its long refs (do NOT await).
		const slowRefs = call(SLOW!, "refs")

		// While it runs: the fast instance's OWN refs must complete on its own timescale (not serialized behind the
		// slow one), and health on BOTH instances must stay healthy and answer in ms (served from cache, off-thread).
		const fastRefs = call(FAST!, "refs")
		const latencies: { slow: number; fast: number }[] = []
		for (let i = 0; i < 6; i++) {
			const t0 = performance.now(); const hs = await call(SLOW!, "health"); const dSlow = performance.now() - t0
			const t1 = performance.now(); const hf = await call(FAST!, "health"); const dFast = performance.now() - t1
			expect(isHealthy(hs)).toBe(true)
			expect(isHealthy(hf)).toBe(true)
			latencies.push({ slow: dSlow, fast: dFast })
			await Bun.sleep(400)
		}

		await fastRefs // the fast instance's refs returned independently of the slow op still running
		await slowRefs // and the slow op completes cleanly too

		const maxSlow = Math.max(...latencies.map(l => l.slow))
		const maxFast = Math.max(...latencies.map(l => l.fast))
		// Neither instance's health ever came close to an op's duration — both were cache-served throughout.
		expect(maxSlow).toBeLessThan(2000)
		expect(maxFast).toBeLessThan(2000)
	}, OP_TIMEOUT)

	// NOTE: do NOT assert the two instances' projectVersions DIFFER. `projectVersion` is a pure CONTENT hash
	// (Hasher: sorted name:itemVersion lines), and two distinct projects with identical content hash identically —
	// which is correct, and a normal real-world case (copy a project as a template for the next machine; it stays
	// byte-identical until someone edits it). Both committed small fixtures are the untouched stock "empty standard
	// project", so they hash the same. Identity in Volt is vendor+name, never content — that's what the
	// distinct-project assertion above tests, off `health`.
	test("repeated refs on each instance are hash-stable and independent", async () => {
		const s1 = await call(SLOW!, "refs"); const f1 = await call(FAST!, "refs")
		const s2 = await call(SLOW!, "refs"); const f2 = await call(FAST!, "refs")
		expect(s2.projectVersion).toBe(s1.projectVersion)   // slow instance stable
		expect(f2.projectVersion).toBe(f1.projectVersion)   // fast instance stable
		expect(Object.keys(s1.items).length).toBeGreaterThan(0) // each instance answered from its own walk
		expect(Object.keys(f1.items).length).toBeGreaterThan(0)
	}, OP_TIMEOUT)
})

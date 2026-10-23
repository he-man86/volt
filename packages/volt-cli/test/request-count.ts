// The e2e harness counts every request it sends (`test/e2e/lib/pipe.ts` countOp); this prints the tally once, after
// the last test file of the run. A preloaded `afterAll` is the run's own end — bun runs no `exit` handler under
// `bun test`. A run that sent nothing (the unit tests) prints nothing.
import { afterAll } from "bun:test"

afterAll(() => {
	const counts = (globalThis as any).__voltE2eRequests as Map<string, number> | undefined
	if (!counts || counts.size === 0) return
	console.log(`[e2e] requests sent: ${[...counts].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(", ")}`)
})

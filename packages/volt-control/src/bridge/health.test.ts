import { expect, test } from "bun:test"
import { bridgeActiveOp, type HealthState } from "./health.js"

// bridgeActiveOp is the shared "a mutation is in flight" signal every frontend reads off /health, so trackers
// hold off on /refs while the single-threaded bridge is churning the project. These pin its extraction.
test("bridgeActiveOp: reads the op off a connected/degraded/disconnected health payload", () => {
	const busy = (kind: "connected" | "degraded" | "disconnected"): HealthState =>
		({ kind, health: { status: "healthy", connected: true, activeOp: "init" } }) as HealthState
	expect(bridgeActiveOp(busy("connected"))).toBe("init")
	expect(bridgeActiveOp(busy("degraded"))).toBe("init")
	expect(bridgeActiveOp(busy("disconnected"))).toBe("init")
})

test("bridgeActiveOp: undefined when idle, unreachable, or unknown", () => {
	const idle: HealthState = { kind: "connected", health: { status: "healthy", connected: true } }
	expect(bridgeActiveOp(idle)).toBeUndefined()
	expect(bridgeActiveOp({ kind: "connected", health: { status: "healthy", connected: true, activeOp: null } })).toBeUndefined()
	expect(bridgeActiveOp({ kind: "unreachable", reason: "timeout" })).toBeUndefined()
	expect(bridgeActiveOp({ kind: "unknown" })).toBeUndefined()
})

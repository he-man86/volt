import { describe, test, expect } from "bun:test"
import { withGate, isMutationInFlight } from "./gate.js"

/**
 * The mutation gate must wrap ONLY the work, and must release even when the work fails — otherwise a
 * rejected push/pull would leave isMutationInFlight stuck true and wedge the next operation (the "push
 * keeps pending" symptom). doPush/doPull keep their outcome dialogs OUTSIDE withGate for the same reason.
 */
describe("withGate", () => {
	test("releases the gate after the work resolves", async () => {
		const ws = "/ws-resolve"
		let sawInFlight = false
		await withGate(ws, async () => { sawInFlight = isMutationInFlight(ws) })
		expect(sawInFlight).toBe(true)
		expect(isMutationInFlight(ws)).toBe(false)
	})

	test("releases the gate even when the work REJECTS (a failed push must not wedge the next)", async () => {
		const ws = "/ws-reject"
		await expect(withGate(ws, async () => { throw new Error("boom") })).rejects.toThrow("boom")
		expect(isMutationInFlight(ws)).toBe(false)
	})
})

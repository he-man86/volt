/** The mixed-version cell's judgement (`scripts/mixed-version-lib.ts`), offline: a pair of another protocol must be
 *  refused by name before any op, a pair of one protocol must work, and a shape change under one number is named. */
import { describe, expect, it } from "bun:test"
import { capabilityGap, judgeCell, judgeDirection, type Direction, type OpenRpcLike } from "../../scripts/mixed-version-lib"
import { loadOpenRpc } from "../e2e/lib/openrpc"

const refused = "BRIDGE_PROTOCOL: the bridge speaks wire protocol 2, this volt speaks 1: update Volt. Nothing was sent to it."
const dir = (bridgeProtocol: number | null, runs: Direction["runs"]): Direction => ({ name: "d", cliProtocol: 1, bridgeProtocol, bridgeOps: null, runs })

describe("a direction of the mixed-version cell", () => {
	it("is green when both speak one protocol and every verb works", () => {
		expect(judgeDirection(dir(1, [{ verb: "init", exit: 0, output: "" }, { verb: "status", exit: 0, output: "" }])).green).toBe(true)
	})

	it("is red when both speak one protocol and a verb fails — the pair was declared compatible", () => {
		const v = judgeDirection(dir(1, [{ verb: "init", exit: 0, output: "" }, { verb: "push (create)", exit: 1, output: "x\nBAD_REQUEST: unknown member" }]))
		expect(v.green).toBe(false)
		expect(v.why).toContain("`push (create)` exited 1: BAD_REQUEST: unknown member")
	})

	it("is green when the protocols differ and every verb is refused by name", () => {
		expect(judgeDirection(dir(2, [{ verb: "init", exit: 1, output: refused }])).green).toBe(true)
		expect(judgeDirection(dir(null, [{ verb: "init", exit: 1, output: "the bridge speaks wire protocol none" }])).green).toBe(true)
	})

	it("is red when the protocols differ and a verb went through, or failed for another reason (misread)", () => {
		expect(judgeDirection(dir(2, [{ verb: "init", exit: 0, output: "" }])).green).toBe(false)
		expect(judgeDirection(dir(2, [{ verb: "init", exit: 1, output: "IDE_LOST_ITEM" }])).green).toBe(false)
		expect(judgeDirection(dir(1, [])).green).toBe(false)
	})
})

describe("what one protocol number cannot refuse", () => {
	const doc = loadOpenRpc() as unknown as OpenRpcLike

	it("finds no gap between a document and itself", () => {
		expect(capabilityGap(doc, doc)).toEqual([])
	})

	it("names an op and a member one release has and the other lacks", () => {
		const older = structuredClone(doc)
		older.methods = older.methods.filter((m) => m.name !== "grep")
		delete older.components.schemas.FetchRequest.properties!.onlyItems
		delete older.components.schemas.HealthResponse.properties!.ops
		const gap = capabilityGap(older, doc)
		expect(gap).toContain(`op 'grep' is new (the previous bridge answers it BAD_REQUEST "unknown op"; health.ops tells a client)`)
		expect(gap).toContain("fetch: request member 'onlyItems' is new")
		expect(gap).toContain("health: response member 'ops' is new")
		expect(capabilityGap(doc, older)).toContain("op 'grep' is gone")
	})

	it("says what the cell could not detect: one number over two shapes", () => {
		const r = judgeCell("0.1.1", "abc", [dir(1, [{ verb: "init", exit: 0, output: "" }])], ["fetch: request member 'x' is new"])
		expect(r.green).toBe(true)
		expect(r.undetectable).toContain("ONE protocol number over DIFFERENT shapes")
		expect(judgeCell("0.1.1", "abc", [dir(1, [{ verb: "init", exit: 0, output: "" }])], []).undetectable).toContain("same shape")
	})
})

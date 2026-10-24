/** The contract suite's reading of the OpenRPC document (`test/e2e/lib/openrpc.ts`), offline: the validator must refuse
 *  what the schema refuses, or every contract case it judges passes for the wrong reason. */
import { describe, expect, it } from "bun:test"
import { bodySchema, loadOpenRpc, method, otherCase, resolve, reversed, sample, validate, wrongType, type Schema } from "../e2e/lib/openrpc"

const doc = loadOpenRpc()
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` })

describe("openrpc reader", () => {
	it("reads every method and schema of the committed document with the keywords it implements", () => {
		const walk = (s: Schema) => {
			// validate() throws on a keyword it does not implement; a conforming sample exercises every node.
			validate(doc, s, sample(doc, s))
			for (const p of Object.values(s.properties ?? {})) walk(p)
			if (s.items) walk(s.items)
			if (typeof s.additionalProperties === "object") walk(s.additionalProperties)
		}
		for (const s of Object.values(doc.components.schemas)) walk(s)
		expect(doc.methods.map((m) => m.name)).toContain("push")
	})

	it("accepts a conforming answer and names each way a broken one breaks", () => {
		const health = {
			projects: [{ vendor: "codesys", project: "P", status: "healthy", dirty: false }],
			languages: ["ST"], kinds: [{ extension: "pou", writable: true }], protocol: 1, ops: ["health"],
		}
		expect(validate(doc, ref("HealthResponse"), health, { strict: true })).toEqual([])
		const { protocol: _, ...noProtocol } = health
		expect(validate(doc, ref("HealthResponse"), noProtocol)).toEqual(["$: lacks the required member 'protocol'"])
		expect(validate(doc, ref("HealthResponse"), { ...health, protocol: "1" })).toEqual(["$.protocol: is string, the schema says integer"])
		expect(validate(doc, ref("HealthResponse"), { ...health, status: "healthy" })).toEqual([])
		expect(validate(doc, ref("HealthResponse"), { ...health, status: "healthy" }, { strict: true }))
			.toEqual(["$: has the member 'status' the schema does not name"])
		// `dirty` is optional (absent when the IDE did not say): a row lacks only its project and status
		expect(validate(doc, ref("HealthResponse"), { ...health, projects: [{ vendor: "codesys" }] }).length).toBe(2)
	})

	it("judges a map by its value schema and a request by its closed member set", () => {
		const refs = { projectVersion: "v", items: { "A/B.pou": "1" }, applications: [], unreadable: [], unreadableNodes: [], removed: [], unwalkedFolders: [] }
		expect(validate(doc, ref("RefsResponse"), refs, { strict: true })).toEqual([])
		expect(validate(doc, ref("RefsResponse"), { ...refs, items: { "A/B.pou": 1 } })).toEqual(['$.items["A/B.pou"]: is number, the schema says string'])
		expect(validate(doc, ref("RefsRequest"), { knownItem: {} })).toEqual(["$: has the member 'knownItem' the schema does not name"])
	})

	it("tells the push op union's arms apart by the discriminator", () => {
		expect(validate(doc, ref("PushOp"), { op: "set", name: "A/X.pou", sourceText: "x" })).toEqual([])
		expect(validate(doc, ref("PushOp"), { op: "deleteItem", name: "A/X.pou" })).toEqual([])
		expect(validate(doc, ref("PushOp"), { op: "deleteItem", name: "A/X.pou", to: "A/Y.pou" }).join()).toContain("oneOf")
		expect(validate(doc, ref("PushOp"), { op: "rename", name: "A/X.pou" }).length).toBeGreaterThan(0)
	})

	it("refuses a schema keyword it does not implement instead of skipping it", () => {
		expect(() => validate(doc, { type: "string", pattern: "^x" } as Schema, "x")).toThrow("pattern")
	})

	it("derives the variations: request bodies, other case, another type, another order", () => {
		expect(bodySchema(doc, method(doc, "health"))).toBeUndefined()
		expect(Object.keys(bodySchema(doc, method(doc, "fetch"))!.properties!)).toContain("onlyItems")
		expect(resolve(doc, ref("PushRequest")).required).toEqual(["ops", "expectedPlatform", "expectedProjectName"])
		expect(otherCase("knownItems")).toBe("KnownItems")
		expect(otherCase("Ops")).toBe("ops")
		expect(typeof wrongType(doc, { type: "string" })).toBe("number")
		expect(Array.isArray(wrongType(doc, { type: "object" }))).toBe(true)
		expect(Object.keys(reversed({ a: 1, b: 2, c: 3 }))).toEqual(["c", "b", "a"])
	})
})

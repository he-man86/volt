import { describe, expect, test } from "bun:test"
import { TestBridge } from "../../bridge/test-bridge.js"

describe("test bridge /refs response carries folders", () => {
	test("emits a folder entry for every item", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs", sourceText: "FUNCTION_BLOCK FB_Motor END_FUNCTION_BLOCK" },
				{ name: "Nested", kind: "function_block", folder: "POUs/Subsystem", sourceText: "FUNCTION_BLOCK Nested END_FUNCTION_BLOCK" },
				{ name: "RootItem", kind: "function_block", folder: "", sourceText: "FUNCTION_BLOCK RootItem END_FUNCTION_BLOCK" },
			],
		})

		const refs = await bridge.getRefs()
		expect(refs.folders).toEqual({
			FB_Motor: "POUs",
			Nested: "POUs/Subsystem",
			RootItem: "",
		})
		expect(Object.keys(refs.folders).sort()).toEqual(Object.keys(refs.items).sort())
	})

	test("items without an explicit folder report empty string", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "NoFolder", kind: "function_block", sourceText: "FUNCTION_BLOCK NoFolder END_FUNCTION_BLOCK" },
			],
		})

		const refs = await bridge.getRefs()
		expect(refs.folders).toEqual({ NoFolder: "" })
	})
})

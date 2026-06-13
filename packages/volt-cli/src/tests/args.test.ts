import { describe, test, expect } from "bun:test"
import { parseArgs } from "../args.js"

describe("parseArgs", () => {
	test("verb resolves when --workspace precedes it (the init regression)", () => {
		const p = parseArgs(["--workspace", "/tmp/proj", "init", "--port", "8555"], {})
		expect(p.verb).toBe("init")
		expect(p.workspace).toBe("/tmp/proj")
		expect(p.port).toBe(8555)
	})

	test("verb-first order also works", () => {
		const p = parseArgs(["status", "--json", "--port", "8556"], {})
		expect(p.verb).toBe("status")
		expect(p.has("--json")).toBe(true)
		expect(p.port).toBe(8556)
	})

	test("operands are the positionals after the verb (show <ref> <path>)", () => {
		const p = parseArgs(["--workspace", "/w", "show", "HEAD", "POUs/FB.st"], {})
		expect(p.verb).toBe("show")
		expect(p.operands).toEqual(["HEAD", "POUs/FB.st"])
	})

	test("no positional → help", () => {
		expect(parseArgs(["--json"], {}).verb).toBe("help")
		expect(parseArgs([], {}).verb).toBe("help")
	})

	test("value() reads a flag's value; has() detects presence", () => {
		const p = parseArgs(["merge", "--resolve", "POUs/FB.st", "--use-ours"], {})
		expect(p.value("--resolve")).toBe("POUs/FB.st")
		expect(p.has("--use-ours")).toBe(true)
		expect(p.has("--use-theirs")).toBe(false)
	})

	test("env fallbacks for workspace/port", () => {
		const p = parseArgs(["status"], { VOLT_WORKSPACE: "/env/ws", VOLT_BRIDGE_PORT: "9000" })
		expect(p.workspace).toBe("/env/ws")
		expect(p.port).toBe(9000)
	})

	test("port is undefined when neither flag nor env set (caller resolves config/8555)", () => {
		expect(parseArgs(["status"], {}).port).toBeUndefined()
	})
})

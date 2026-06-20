import { describe, test, expect } from "bun:test"
import { PushResponseSchema, BuildResponseSchema, HealthResponseSchema } from "../bridge/types.js"

/**
 * Contract test: the CLI's response schemas must accept the EXACT shapes the real bridge emits — not just
 * the fuller shapes the mock TestBridge happens to build. The bridge serializes with WhenWritingNull, so
 * null fields are OMITTED, not sent as null. A schema that requires an omitted key fails at the transport
 * boundary as "malformed payload", hiding the real reason (this regression shipped: a thrown-op-error
 * conflict came over as `{name, reason}` and `.nullable()` rejected the missing version keys).
 */
describe("PushResponseSchema accepts the real bridge wire shapes", () => {
	test("a THROWN-error conflict: only name + reason (bridge omits null version fields)", () => {
		const wire = {
			accepted: false,
			conflicts: [{ name: "fbd.fbd", reason: "Creation of object 'fbd' failed.\nReason: Object reference not set." }],
			currentProjectVersion: "a9eeaecbd22ad3cc",
		}
		expect(() => PushResponseSchema.parse(wire)).not.toThrow()
	})

	test("a VERSION-mismatch conflict: name + reason + both version fields present", () => {
		const wire = {
			accepted: false,
			conflicts: [{ name: "FB_Motor.st", yourVersion: "aaa", currentVersion: "bbb", reason: "item changed since you fetched its version" }],
			currentProjectVersion: "ccc",
		}
		expect(() => PushResponseSchema.parse(wire)).not.toThrow()
	})

	test("an accepted push: newProjectVersion + newItems (full wire names)", () => {
		const wire = { accepted: true, newProjectVersion: "ddd", newItems: { "FB_Motor.st": "v1", "PLC_PRG.st": "v2" } }
		expect(() => PushResponseSchema.parse(wire)).not.toThrow()
	})

	test("a structured VG diagnostic conflict carries code + line", () => {
		const wire = {
			accepted: false,
			conflicts: [{ name: "fbd.fbd", reason: "graphical body is not in canonical form …", code: "VG_NOT_CANONICAL", line: 14 }],
			currentProjectVersion: "abc",
		}
		expect(() => PushResponseSchema.parse(wire)).not.toThrow()
	})

	test("a partially-present conflict (yourVersion set, currentVersion omitted) still parses", () => {
		const wire = {
			accepted: false,
			conflicts: [{ name: "X.st", yourVersion: "aaa", reason: "expected item to exist but it doesn't" }],
			currentProjectVersion: "eee",
		}
		expect(() => PushResponseSchema.parse(wire)).not.toThrow()
	})
})

// The same WhenWritingNull divergence existed (untested) on /build and /health — guard them too.
describe("Build/Health schemas tolerate the bridge's WhenWritingNull omissions", () => {
	test("a build diagnostic with object + section OMITTED (project-level, no section) parses", () => {
		const wire = { success: false, duration: 12, diagnostics: [{ severity: "error", message: "syntax error", line: 1 }] }
		expect(() => BuildResponseSchema.parse(wire)).not.toThrow()
	})

	test("a health response with degradedReason OMITTED (not degraded) parses", () => {
		const wire = { status: "healthy", platform: "beckhoff", connected: true, ideAlive: true, degraded: false, version: "1.0.0" }
		expect(() => HealthResponseSchema.parse(wire)).not.toThrow()
	})
})

/**
 * Cross-vendor /health schema parity.
 *
 * Both bridge implementations (Beckhoff C#, CODESYS Python) MUST produce
 * /health responses that pass `HealthResponseSchema.strict()`. Without
 * an enforcement test, vendor drift is silent: one bridge adds a field,
 * the other doesn't, the field becomes load-bearing in the extension,
 * and the lagging bridge fails MALFORMED_RESPONSE in the wild.
 *
 * The samples below are frozen snapshots of real responses from each
 * bridge. Update them deliberately: change the schema, re-capture, paste
 * here. This is a tripwire — if it goes off, someone broke parity.
 *
 * Capture commands:
 *   curl http://localhost:8555/health    # Beckhoff
 *   curl http://localhost:8556/health    # CODESYS (port may vary)
 */
import { describe, expect, test } from "bun:test";
import { HealthResponseSchema } from "../../bridge/types.js";

// ─── Beckhoff samples ────────────────────────────────────────────────

const BECKHOFF_HEALTHY = {
	status: "healthy",
	platform: "beckhoff",
	platformVariant: null,
	connected: true,
	ideAlive: true,
	degraded: false,
	degradedReason: null,
	ideName: "TcXaeShell",
	ideVersion: "3.1.4024.62",
	version: "5.0.0",
	projectName: "TwinCAT Project1",
	plcProjectName: "Untitled2",
	projectDirty: false,
};

const BECKHOFF_UNAVAILABLE = {
	status: "unavailable",
	platform: "beckhoff",
	platformVariant: null,
	connected: false,
	ideAlive: false,
	degraded: false,
	degradedReason: null,
	ideName: null,
	ideVersion: null,
	version: "5.0.0",
	projectName: null,
	plcProjectName: null,
	projectDirty: false,
};

const BECKHOFF_DEGRADED = {
	status: "degraded",
	platform: "beckhoff",
	platformVariant: null,
	connected: true,
	ideAlive: true,
	degraded: true,
	degradedReason: "/refs: previous call failed",
	ideName: "TcXaeShell",
	ideVersion: "3.1.4024.62",
	version: "5.0.0",
	projectName: "TwinCAT Project1",
	plcProjectName: "Untitled2",
	projectDirty: false,
};

// ─── CODESYS samples ─────────────────────────────────────────────────

const CODESYS_HEALTHY = {
	status: "healthy",
	platform: "codesys",
	platformVariant: null,
	connected: true,
	ideAlive: true,
	degraded: false,
	degradedReason: null,
	ideName: "CODESYS",
	ideVersion: "3.5.21.40",
	version: "5.0.0",
	projectName: "Untitled4",
	plcProjectName: "Untitled4",
	projectDirty: false,
};

const CODESYS_UNAVAILABLE_NO_PROJECT = {
	status: "unavailable",
	platform: "codesys",
	platformVariant: null,
	connected: false,
	ideAlive: false,
	degraded: false,
	degradedReason: null,
	ideName: "CODESYS",
	ideVersion: "3.5.21.40",
	version: "5.0.0",
	projectName: null,
	plcProjectName: null,
	projectDirty: false,
};

const CODESYS_OEM_LENZE = {
	status: "healthy",
	platform: "codesys",
	platformVariant: "lenze",
	connected: true,
	ideAlive: true,
	degraded: false,
	degradedReason: null,
	ideName: "Lenze PLC Designer",
	ideVersion: "3.5.21.40",
	version: "5.0.0",
	projectName: "Demo",
	plcProjectName: "Demo",
	projectDirty: false,
};

describe("bridge /health response parity", () => {
	const samples: Array<[string, unknown]> = [
		["Beckhoff healthy", BECKHOFF_HEALTHY],
		["Beckhoff unavailable", BECKHOFF_UNAVAILABLE],
		["Beckhoff degraded", BECKHOFF_DEGRADED],
		["CODESYS healthy", CODESYS_HEALTHY],
		["CODESYS unavailable (no project)", CODESYS_UNAVAILABLE_NO_PROJECT],
		["CODESYS OEM (Lenze rebrand)", CODESYS_OEM_LENZE],
	];

	for (const [name, sample] of samples) {
		test(`schema accepts: ${name}`, () => {
			const parsed = HealthResponseSchema.parse(sample);
			expect(parsed.platform).toBeDefined();
			expect(typeof parsed.connected).toBe("boolean");
		});
	}

	test("schema rejects unknown fields (.strict() trip-wire)", () => {
		// If a bridge adds a new field, this test fails until the schema
		// is updated AND a fresh sample is captured. That's the whole
		// point — silent drift is the bug we're guarding against.
		const withExtra = { ...BECKHOFF_HEALTHY, brandNewField: "oops" };
		expect(() => HealthResponseSchema.parse(withExtra)).toThrow();
	});

	test("schema rejects missing required fields (connected)", () => {
		const { connected: _, ...broken } = BECKHOFF_HEALTHY;
		expect(() => HealthResponseSchema.parse(broken)).toThrow();
	});

	test("Beckhoff and CODESYS both report identical `connected` semantics", () => {
		// When `connected: false`, both bridges must set `status:
		// "unavailable"` and `ideAlive: false`. This is the contract the
		// volt-agent defense (BridgeClient.getRefs cross-check) relies on.
		const disconnectedSamples = [BECKHOFF_UNAVAILABLE, CODESYS_UNAVAILABLE_NO_PROJECT];
		for (const sample of disconnectedSamples) {
			expect(sample.connected).toBe(false);
			expect(sample.status).toBe("unavailable");
			expect(sample.ideAlive).toBe(false);
		}
	});
});

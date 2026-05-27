/**
 * Verifies the bridge binaries stay in sync with `bridges/version.json`.
 *
 * Inherited from the reference PLCAssist repo after a real version-drift
 * incident: a multi-bridge build script aborted on the first failed
 * bridge, leaving the others frozen at an old version while users hit a
 * frontend that required the new one.
 *
 * Checks:
 *   1. version.json is well-formed semver
 *   2. If dist/manifest.json exists (written by build-bridges.sh after
 *      each successful build), every bridge listed there matches
 *      version.json
 *
 * The manifest-based approach works cross-platform — the test doesn't
 * need to execute .exe files (which would fail on Linux CI).
 * build-bridges.sh runs `<exe> --version` on the build machine
 * (Windows) and writes the results to manifest.json, which this test
 * then reads from any platform.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BRIDGES_DIR = __dirname;
const VERSION_JSON_PATH = resolve(BRIDGES_DIR, "version.json");
const DIST_MANIFEST_PATH = resolve(BRIDGES_DIR, "dist/manifest.json");

const expectedVersion = (
	JSON.parse(readFileSync(VERSION_JSON_PATH, "utf-8")) as { version: string }
).version;

describe("bridge versions are in sync", () => {
	it("version.json contains a valid semver string", () => {
		expect(expectedVersion).toMatch(/^\d+\.\d+\.\d+$/);
	});

	describe("built binaries", () => {
		const manifestExists = existsSync(DIST_MANIFEST_PATH);

		if (!manifestExists) {
			it.skip("dist/manifest.json missing — run `npm run build:bridges` to build and generate it", () => {});
			return;
		}

		const manifest = JSON.parse(readFileSync(DIST_MANIFEST_PATH, "utf-8")) as {
			builtAt: string;
			bridges: Record<string, string>;
		};

		it("manifest.json has at least one built bridge", () => {
			expect(Object.keys(manifest.bridges).length).toBeGreaterThan(0);
		});

		it.each(
			Object.entries(manifest.bridges),
		)("%s bridge binary version matches version.json", (bridgeName, reportedVersion) => {
			expect(
				reportedVersion,
				`Built ${bridgeName} bridge reports version "${reportedVersion}" ` +
					`but version.json says "${expectedVersion}". ` +
					`Rebuild required: npm run build:bridges`,
			).toBe(expectedVersion);
		});
	});
});

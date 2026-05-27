#!/usr/bin/env node
/**
 * MCP e2e — drive the `plc-mcp` server over stdio with a real MCP
 * client and exercise every tool against the live bridge + IDE.
 *
 * Lighter than `cli/conformance.ts` because that suite already proves
 * every verb's behavior end-to-end. This script only proves: the MCP
 * wiring works, each tool is registered with the right schema, and the
 * structured responses parse correctly.
 *
 * Scenarios (7):
 *   M01 — listTools advertises the 5 expected tools
 *   M02 — plc_status on an uninitialized workspace
 *   M03 — plc_init
 *   M04 — plc_pull (first pull from IDE)
 *   M05 — plc_status post-import (clean)
 *   M06 — plc_push with a single edit
 *   M07 — plc_compile
 *
 * Requires bridge on 127.0.0.1:8555 and an IDE project open.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BridgeClient } from "../bridge/client.js";

const BRIDGE_PORT = Number.parseInt(process.env.PLCASSIST_BRIDGE_PORT ?? "8555", 10);
const TEST_PREFIX = "FB_MCP_E2E_";
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
// `plc-mcp` bin lives alongside this script at dist/tools/bin.js.
const MCP_SERVER = resolve(THIS_DIR, "bin.js");

const bridge = new BridgeClient({ port: BRIDGE_PORT });

let pass = 0;
let fail = 0;
const failures: string[] = [];

function section(label: string): void {
	const line = "─".repeat(72);
	console.log(`\n${line}\n  ${label}\n${line}`);
}
function ok(msg: string): void { console.log(`  ✓ ${msg}`); pass += 1; }
function bad(msg: string, err?: string): void {
	console.log(`  ✗ ${msg}`);
	if (err !== undefined && err.length > 0) console.log(`      ${err}`);
	failures.push(msg);
	fail += 1;
}
function assert(cond: boolean, msg: string, err?: string): void {
	if (cond) ok(msg); else bad(msg, err);
}

interface ToolJson { content: Array<{ type: string; text: string }>; isError?: boolean; }

function parseToolJson(result: ToolJson): { error?: string; data?: Record<string, unknown> } {
	const text = result.content[0]?.text ?? "";
	if (result.isError === true) return { error: text };
	try {
		return { data: JSON.parse(text) as Record<string, unknown> };
	} catch {
		return { error: `non-JSON response: ${text}` };
	}
}

async function cleanupTestPous(): Promise<void> {
	let safety = 5;
	while (safety-- > 0) {
		const { changed } = await bridge.fetchChanges({ knownItems: {} });
		const test = changed.filter((c) => c.name.startsWith(TEST_PREFIX));
		if (test.length === 0) return;
		const refs = await bridge.getRefs();
		for (const item of test) {
			const ifVersion = refs.items[item.name];
			if (ifVersion === undefined) continue;
			try { await bridge.pushBatch({ ops: [{ op: "deletePou", name: item.name, ifVersion }] }); }
			catch { /* keep trying */ }
		}
	}
}

async function main(): Promise<void> {
	console.log("plc MCP e2e\n");
	console.log(`  bridge:    http://127.0.0.1:${BRIDGE_PORT}`);
	console.log(`  MCP entry: ${MCP_SERVER}`);

	try { await bridge.getHealth(); }
	catch (err) {
		console.error(`pre-flight: bridge unreachable: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
	if (!existsSync(MCP_SERVER)) {
		console.error(`pre-flight: MCP server not built. Run \`npm run build\` first.`);
		process.exit(1);
	}

	const rootTmp = mkdtempSync(join(tmpdir(), "plc-mcp-e2e-"));
	const workspace = join(rootTmp, "workspace");
	mkdirSync(workspace, { recursive: true });

	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [MCP_SERVER],
		env: {
			...process.env,
			PLCASSIST_BRIDGE_PORT: String(BRIDGE_PORT),
			PLCASSIST_WORKSPACE: workspace,
		},
	});
	const client = new Client({ name: "plc-mcp-e2e", version: "0.0.0" }, { capabilities: {} });
	await client.connect(transport);

	try {
		await runScenarios(client, workspace);
	} finally {
		console.log("\n─── teardown ─────────────────────────────────────────────────────────");
		try { await client.close(); } catch { /* ignore */ }
		await cleanupTestPous();
		try { rmSync(rootTmp, { recursive: true, force: true }); } catch { /* ignore */ }
		console.log("  ✓ MCP client closed, test POUs cleaned up");
	}

	console.log("");
	console.log(`${pass} PASS, ${fail} FAIL`);
	if (fail > 0) {
		console.log("\nFailed expectations:");
		for (const f of failures) console.log(`  - ${f}`);
	}
	process.exit(fail > 0 ? 1 : 0);
}

async function runScenarios(client: Client, workspace: string): Promise<void> {
	// ─── M01: listTools ──────────────────────────────────────────────
	section("M01 — listTools advertises the 5 expected tools");
	{
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();
		const expected = ["plc_compile", "plc_init", "plc_pull", "plc_push", "plc_status"];
		assert(
			JSON.stringify(names) === JSON.stringify(expected),
			"tools = [plc_compile, plc_init, plc_pull, plc_push, plc_status]",
			`got ${JSON.stringify(names)}`,
		);
		for (const name of expected) {
			const t = tools.find((x) => x.name === name);
			assert(
				typeof t?.description === "string" && t!.description.length > 20,
				`${name} has a real description`,
			);
		}
	}

	// ─── M02: plc_status on uninitialized workspace ──────────────────
	section("M02 — plc_status on an uninitialized workspace");
	{
		const r = await client.callTool({ name: "plc_status", arguments: {} });
		const { data, error } = parseToolJson(r as ToolJson);
		assert(error === undefined, "plc_status didn't error pre-init", error);
		assert(data?.initialized === false, "reports initialized=false");
		assert(data?.nextAction === "init", "nextAction is 'init' on uninitialized workspace");
		assert(
			typeof data?.summary === "string" && (data!.summary as string).toLowerCase().includes("init"),
			"summary tells the user to init",
		);
	}

	// ─── M03: plc_init ───────────────────────────────────────────────
	section("M03 — plc_init binds the workspace");
	{
		const r = await client.callTool({ name: "plc_init", arguments: {} });
		const { data, error } = parseToolJson(r as ToolJson);
		assert(error === undefined, "plc_init succeeded", error);
		assert(data?.status === "initialized", `status=initialized, got ${String(data?.status)}`);
		assert(existsSync(join(workspace, ".plcassist", "config.json")), ".plcassist/config.json exists");
	}

	// ─── M04: plc_pull populates workspace ─────────────────────────
	section("M04 — plc_pull populates the workspace");
	{
		const r = await client.callTool({ name: "plc_pull", arguments: {} });
		const { data, error } = parseToolJson(r as ToolJson);
		assert(error === undefined, "plc_pull succeeded", error);
		assert(data?.status === "pulled", `status=pulled, got ${String(data?.status)}`);
		const written = (data?.written as string[] | undefined) ?? [];
		assert(written.length > 0, "imported at least one file");
	}

	// ─── M05: plc_status post-import is clean ────────────────────────
	section("M05 — plc_status post-import: IDE in sync, workspace clean");
	{
		const r = await client.callTool({ name: "plc_status", arguments: {} });
		const { data, error } = parseToolJson(r as ToolJson);
		assert(error === undefined, "plc_status succeeded", error);
		assert(data?.initialized === true, "initialized=true post-init");
		assert(data?.ideDrifted === false, "ideDrifted=false");
		assert(data?.workspaceDirty === false, "workspaceDirty=false");
		const changes = data?.incoming as { added?: unknown[]; modified?: unknown[]; removed?: unknown[] } | undefined;
		assert(
			changes?.added?.length === 0 && changes?.modified?.length === 0 && changes?.removed?.length === 0,
			"incoming is empty (all three arrays)",
		);
		assert(data?.nextAction === null, "nextAction is null when everything in sync");
		assert(typeof data?.summary === "string" && (data!.summary as string).length > 0, "summary is a non-empty string");
	}

	// ─── M06: plc_push with an edit ────────────────────────────────
	section("M06 — plc_push with a single edit");
	{
		const fbPath = join(workspace, `${TEST_PREFIX}TOOL.st`);
		mkdirSync(dirname(fbPath), { recursive: true });
		writeFileSync(
			fbPath,
			`FUNCTION_BLOCK ${TEST_PREFIX}TOOL\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);
		const r = await client.callTool({ name: "plc_push", arguments: {} });
		const { data, error } = parseToolJson(r as ToolJson);
		assert(error === undefined, "plc_push succeeded", error);
		assert(data?.status === "pushed", `status=pushed, got ${String(data?.status)}`);
		// Verify the FB actually landed on the bridge.
		const { changed } = await bridge.fetchChanges({ knownItems: {} });
		assert(
			changed.some((c) => c.name === `${TEST_PREFIX}TOOL`),
			"new FB is now visible on the bridge",
		);
	}

	// ─── M07: dry-run flags exposed to the AI ───────────────────────
	// AI must be able to PREVIEW both directions without mutating state —
	// `git push --dry-run` / `git fetch --dry-run` semantics. We test both
	// directions and assert the response carries `dryRun: true` so the AI
	// can branch on it, AND that the bridge / workspace were untouched.
	section("M07 — plc_push & plc_pull dry-run: AI can preview without mutating");
	{
		// 7a. dry-run pull on a clean baseline — nothing should change.
		// First make sure we're up to date.
		const baseline = await client.callTool({ name: "plc_pull", arguments: {} });
		const baselineData = parseToolJson(baseline as ToolJson).data;
		assert(
			baselineData?.status === "pulled" || baselineData?.status === "already_up_to_date",
			"baseline plc_pull succeeded",
		);

		// Engineer adds a POU directly via the bridge.
		const dryProbe = `${TEST_PREFIX}DRYPROBE`;
		await bridge.pushBatch({
			ops: [{
				op: "createPou",
				name: dryProbe,
				folder: "POUs",
				kind: "function_block",
				declaration: `FUNCTION_BLOCK ${dryProbe}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
				ifVersion: null,
			}],
		});

		// 7b. plc_pull dryRun: must REPORT the incoming addition WITHOUT
		// writing the file to the workspace or advancing the snapshot.
		const dryPull = await client.callTool({
			name: "plc_pull",
			arguments: { dryRun: true },
		});
		const dryPullData = parseToolJson(dryPull as ToolJson).data;
		assert(dryPullData?.status === "would_pull", `dry pull status=would_pull, got ${String(dryPullData?.status)}`);
		assert(dryPullData?.dryRun === true, "dry pull response carries dryRun:true");
		const inc = dryPullData?.incoming as { added?: string[] } | undefined;
		assert(
			inc?.added?.includes(dryProbe) === true,
			`dry pull incoming.added lists ${dryProbe}`,
			JSON.stringify(inc),
		);
		assert(!existsSync(join(workspace, `POUs/${dryProbe}.st`)), "dry pull did NOT write the file");

		// 7c. Now a REAL pull lands it. Then we dirty the workspace and
		// dry-run a push to assert preview without bridge mutation.
		await client.callTool({ name: "plc_pull", arguments: {} });
		assert(existsSync(join(workspace, `POUs/${dryProbe}.st`)), "real pull DID write the file");

		const targetPath = join(workspace, `${TEST_PREFIX}TOOL.st`);
		writeFileSync(
			targetPath,
			`FUNCTION_BLOCK ${TEST_PREFIX}TOOL\nVAR_INPUT\n    aiPreview : BOOL;\nEND_VAR\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);
		const dryPush = await client.callTool({
			name: "plc_push",
			arguments: { dryRun: true },
		});
		const dryPushData = parseToolJson(dryPush as ToolJson).data;
		assert(dryPushData?.status === "would_push", `dry push status=would_push, got ${String(dryPushData?.status)}`);
		assert(dryPushData?.dryRun === true, "dry push response carries dryRun:true");
		const out = dryPushData?.pushed as { modified?: string[] } | undefined;
		assert(
			out?.modified?.includes(`${TEST_PREFIX}TOOL`) === true,
			`dry push pushed.modified lists ${TEST_PREFIX}TOOL`,
			JSON.stringify(out),
		);
		// Bridge must NOT have aiPreview yet.
		const { changed: chPre } = await bridge.fetchChanges({ knownItems: {} });
		const toolFb = chPre.find((c) => c.name === `${TEST_PREFIX}TOOL`);
		assert(
			toolFb?.declaration?.includes("aiPreview") !== true,
			"dry push did NOT mutate the bridge",
		);

		// Cleanup the probe POU we created so the rest of the suite is clean.
		const refs = await bridge.getRefs();
		const ifVersion = refs.items[dryProbe];
		if (ifVersion !== undefined) {
			try { await bridge.pushBatch({ ops: [{ op: "deletePou", name: dryProbe, ifVersion }] }); }
			catch { /* best effort */ }
		}
	}

	// ─── M08: capability lease enforcement ──────────────────────────
	// AI's `force: true` must be REFUSED without a lease, and ALLOWED
	// (with the lease consumed on success when one-shot) after the
	// human grants via the CLI. This is the core "AI can't force itself"
	// guarantee — if it breaks, we've regressed on the asymmetric-force
	// rule that was the whole reason this lease system exists.
	section("M08 — plc_push force is GATED on a `push-force` lease");
	{
		// Engineer adds something via the bridge so we have drift.
		const driftPou = `${TEST_PREFIX}LEASEPROBE`;
		await bridge.pushBatch({
			ops: [{
				op: "createPou",
				name: driftPou,
				folder: "POUs",
				kind: "function_block",
				declaration: `FUNCTION_BLOCK ${driftPou}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
				ifVersion: null,
			}],
		});
		// AI dirties the workspace (so a non-force push would be blocked on drift).
		const targetPath = join(workspace, `${TEST_PREFIX}TOOL.st`);
		writeFileSync(
			targetPath,
			`FUNCTION_BLOCK ${TEST_PREFIX}TOOL\nVAR_INPUT\n    aiLeaseTest : BOOL;\nEND_VAR\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);

		// 8a. force without lease: REFUSED with status=force_unauthorized,
		// stable hint pointing at `plc grant push-force`. The bridge MUST
		// not have aiLeaseTest yet.
		const noLeaseAttempt = await client.callTool({
			name: "plc_push",
			arguments: { force: true },
		});
		const noLeaseData = parseToolJson(noLeaseAttempt as ToolJson).data;
		assert(
			noLeaseData?.status === "force_unauthorized",
			`force without lease → status=force_unauthorized, got ${String(noLeaseData?.status)}`,
		);
		assert(
			(noLeaseData?.capability as string | undefined) === "push-force",
			"force_unauthorized response names the capability",
		);
		assert(
			typeof noLeaseData?.hint === "string" &&
				(noLeaseData!.hint as string).includes("plc grant push-force"),
			"force_unauthorized hint shows the exact CLI command",
			String(noLeaseData?.hint),
		);
		const { changed: noLeaseAfter } = await bridge.fetchChanges({ knownItems: {} });
		const fbAfterRefusal = noLeaseAfter.find((c) => c.name === `${TEST_PREFIX}TOOL`);
		assert(
			fbAfterRefusal?.declaration?.includes("aiLeaseTest") !== true,
			"bridge UNCHANGED after force-unauthorized — engine was not invoked",
		);

		// 8b. status surfaces NO availableCapabilities yet.
		const preGrant = await client.callTool({ name: "plc_status", arguments: {} });
		const preGrantData = parseToolJson(preGrant as ToolJson).data;
		const preCaps = preGrantData?.availableCapabilities as unknown[] | undefined;
		assert(
			Array.isArray(preCaps) && preCaps.length === 0,
			"plc_status reports empty availableCapabilities pre-grant",
			JSON.stringify(preCaps),
		);

		// 8c. Human grants the capability via the CLI path (one-shot).
		const { issueLease } = await import("../engine/lease.js");
		const lease = issueLease(workspace, "push-force", { ttlMs: 60_000, oneShot: true });
		assert(typeof lease.nonce === "string" && lease.nonce.length > 0, "lease has nonce");

		// 8d. status now lists the lease for the AI.
		const postGrant = await client.callTool({ name: "plc_status", arguments: {} });
		const postGrantData = parseToolJson(postGrant as ToolJson).data;
		const postCaps = postGrantData?.availableCapabilities as
			| Array<{ capability?: string; oneShot?: boolean }>
			| undefined;
		assert(
			postCaps?.some((c) => c.capability === "push-force" && c.oneShot === true) === true,
			"plc_status surfaces the granted push-force lease (one-shot)",
			JSON.stringify(postCaps),
		);

		// 8e. force WITH lease: succeeds, leaseConsumed:true in the response.
		const withLease = await client.callTool({
			name: "plc_push",
			arguments: { force: true },
		});
		const withLeaseData = parseToolJson(withLease as ToolJson).data;
		assert(
			withLeaseData?.status === "pushed",
			`force with lease → status=pushed, got ${String(withLeaseData?.status)}`,
		);
		assert(
			withLeaseData?.leaseConsumed === true,
			"one-shot lease was consumed on successful force-push",
			JSON.stringify(withLeaseData),
		);
		const { changed: chPost } = await bridge.fetchChanges({ knownItems: {} });
		const fbPost = chPost.find((c) => c.name === `${TEST_PREFIX}TOOL`);
		assert(
			fbPost?.declaration?.includes("aiLeaseTest") === true,
			"bridge DID receive force-push after lease was honored",
		);

		// 8f. lease is gone now; another force attempt fails the same as 8a.
		const reAttempt = await client.callTool({
			name: "plc_push",
			arguments: { force: true },
		});
		const reAttemptData = parseToolJson(reAttempt as ToolJson).data;
		// Could be force_unauthorized (no lease) OR nothing_to_push if the
		// workspace is now clean — either proves the lease was consumed.
		assert(
			reAttemptData?.status === "force_unauthorized" ||
				reAttemptData?.status === "nothing_to_push" ||
				reAttemptData?.status === "drift_detected",
			"after one-shot consumption, force is no longer free",
			String(reAttemptData?.status),
		);

		// Cleanup the probe POU.
		const refs = await bridge.getRefs();
		const ifv = refs.items[driftPou];
		if (ifv !== undefined) {
			try { await bridge.pushBatch({ ops: [{ op: "deletePou", name: driftPou, ifVersion: ifv }] }); }
			catch { /* best effort */ }
		}
	}

	// ─── M09: implementation language field flows through /fetch ─────
	// Bridge prep for the future graphical-language LSP. Every POU that
	// has an implementation body carries a `language` field at the wire
	// level (ST / FBD / LD / SFC / CFC / UNKNOWN). AI clients can route
	// per language without parsing the body; graphical bodies are still
	// masked behind a placeholder for now, but the field tells you what
	// the mask is hiding. Once an LSP lands the mask drops; the field
	// stays — protocol shape unchanged.
	section("M09 — implementation language flows through /fetch (bridge prep for graphical LSP)");
	{
		// Fresh fetch — knownItems={} forces the bridge to emit every
		// item with its full body + language.
		const { changed } = await bridge.fetchChanges({ knownItems: {} });
		assert(changed.length > 0, "fetchChanges returned at least one item");

		// Every item should declare a language. Empty body → "ST".
		const known = new Set(["ST", "FBD", "LD", "SFC", "CFC", "UNKNOWN"]);
		const missingLang = changed
			.filter((c) => c.implementation !== undefined && c.implementation !== "")
			.filter((c) => c.language === undefined);
		assert(
			missingLang.length === 0,
			"every item with a body carries a `language` field",
			missingLang.map((c) => c.name).join(", "),
		);
		const badLang = changed
			.filter((c) => c.language !== undefined)
			.filter((c) => !known.has(c.language as string));
		assert(
			badLang.length === 0,
			"all language values are from the known vocabulary (ST/FBD/LD/SFC/CFC/UNKNOWN)",
			badLang.map((c) => `${c.name}=${c.language}`).join(", "),
		);

		// Smoke: TOOL was just pushed as plain ST, so its language must be ST.
		const tool = changed.find((c) => c.name === `${TEST_PREFIX}TOOL`);
		assert(tool !== undefined, `${TEST_PREFIX}TOOL is on the bridge`);
		assert(
			tool?.language === "ST",
			`${TEST_PREFIX}TOOL.language === "ST"`,
			String(tool?.language),
		);

		// If the project has any graphical POUs (e.g. a manually-created
		// FBD program), assert the body is masked and the language is
		// surfaced. Tolerant of projects without one — this is a smoke
		// for live projects, not a hard requirement.
		const graphical = changed.find(
			(c) => c.language !== undefined && c.language !== "ST",
		);
		if (graphical !== undefined) {
			assert(
				graphical.implementation?.startsWith("(graphical language") === true,
				`graphical item ${graphical.name} (${graphical.language}) has masked body`,
				graphical.implementation,
			);
		}
	}

	// ─── M10: plc_compile ────────────────────────────────────────────
	section("M10 — plc_compile returns a structured diagnostics report");
	{
		const r = await client.callTool({ name: "plc_compile", arguments: {} });
		const { data, error } = parseToolJson(r as ToolJson);
		assert(error === undefined, "plc_compile succeeded", error);
		assert(
			data?.status === "ok" || data?.status === "failed",
			`status is ok|failed, got ${String(data?.status)}`,
		);
		assert(typeof data?.durationMs === "number", "durationMs is a number");
		assert(Array.isArray(data?.diagnostics), "diagnostics is an array");
	}
}

void main().catch((err) => {
	console.error("\nFATAL:", err instanceof Error ? err.message : err);
	process.exit(1);
});

/**
 * `plc_push` MCP tool — push workspace state to the IDE.
 *
 * Returns one of four structured statuses (pushed / nothing_to_push
 * / drift_detected / rejected) so the AI can branch on the result
 * without parsing prose.
 *
 * ── `force` is GATED, not absent ────────────────────────────────────
 * The AI can pass `force: true`, but the call is rejected unless the
 * human has issued a `push-force` capability lease via the CLI
 * (`plc grant push-force [--ttl 5m] [--once]`). See [engine/lease.ts]
 * for why a filesystem lease beats a conversational "yes do it":
 *   - lease lives on disk, not in chat — prompt injection can't forge it
 *   - lease originates from a CLI session the AI can never reach
 *   - leases auto-expire (default 5m) so latent capability doesn't pile up
 *   - `--once` consumes the lease after the first use
 *
 * On a successful force-push, the lease is consumed (if one-shot) so
 * the next call needs a fresh grant. Without a lease, AI clients get
 * `status: "force_unauthorized"` with the exact CLI command the
 * human must run to grant — same shape as `drift_detected`, AI
 * surfaces it and asks the human.
 *
 * Without `force`, the tool behaves identically to the pre-lease
 * design: drift refusal still kicks in via `status: drift_detected`,
 * and the AI's job is to surface the per-item engineer-side change
 * list (`incoming`) so the human can decide whether to plc_pull or
 * grant a force lease.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPush } from "../engine/push.js";
import { checkLease, consumeLeaseIfOneShot } from "../engine/lease.js";
import {
	commonArgs,
	errorContent,
	jsonContent,
	newBridge,
	resolvePort,
	resolveWorkspace,
	safeRun,
} from "./_shared.js";

export function registerPlcPush(server: McpServer): void {
	server.registerTool(
		"plc_push",
		{
			description:
				"Push the workspace's current state to the IDE. Atomic: either the whole batch lands or nothing does. On IDE drift, this tool REFUSES (status=drift_detected) with the per-item engineer-side change list — you must stop, surface the diff to the human, and let them decide whether to plc_pull (absorb engineer's work) or whether they want to grant a force-push capability. `force: true` is allowed ONLY if the human has issued a `push-force` capability lease via the CLI (`plc grant push-force [--ttl 5m] [--once]`); without a lease, force is rejected with status=force_unauthorized and the exact grant command the human must run. Pass dryRun: true to PREVIEW which items would be pushed without contacting the bridge for a write (models `git push --dry-run`) — safe to call before the real push.",
			inputSchema: {
				...commonArgs,
				force: z
					.boolean()
					.optional()
					.describe(
						"Bypass the drift refusal. REQUIRES an active 'push-force' capability lease — the human grants this via `plc grant push-force [--ttl 5m] [--once]` from their terminal. Without a lease, this returns status=force_unauthorized with the exact CLI command to run. On successful force-push with a one-shot lease, the lease is consumed; subsequent calls need a fresh grant. Check plc_status for `availableCapabilities` to see whether you can use force right now without trying-and-failing.",
					),
				dryRun: z
					.boolean()
					.optional()
					.describe(
						"Preview only — compute what would be pushed (per-item) without writing to the bridge, snapshot, or workspace. Modeled on `git push --dry-run`. Drift refusal still applies — a dry-run that would hit drift returns status=drift_detected the same way a real push would, so callers can preview both the happy path and the refusal.",
					),
			},
		},
		async (args) => {
			const port = resolvePort(args.port);
			const ws = resolveWorkspace(args.workspace);
			const forceRequested = args.force === true;

			// Lease check happens BEFORE engine work. If the AI asked
			// for force but no lease exists, refuse loudly with the exact
			// CLI command to grant — so the AI's response to the human
			// can be "ask me to run `plc grant push-force` and try again."
			if (forceRequested) {
				const lease = checkLease(ws, "push-force");
				if (lease === null) {
					return jsonContent({
						status: "force_unauthorized",
						workspace: ws,
						capability: "push-force",
						hint:
							"You asked for force-push but the human has not granted that capability. " +
							"Tell the human: \"Run `plc grant push-force --ttl 5m --once` in your terminal, " +
							"then ask me to retry the push.\" The grant must come from the CLI — AI clients " +
							"cannot self-grant. Without force you can still call plc_pull to absorb the " +
							"engineer's changes (the safe default).",
					});
				}
			}

			const r = await safeRun(() =>
				runPush(ws, newBridge(port), {
					force: forceRequested,
					dryRun: args.dryRun === true,
				}),
			);
			if (!r.ok) return errorContent(r.error);
			const result = r.value;
			switch (result.status) {
				case "ok": {
					// Consume the one-shot lease on REAL force-push success.
					// Dry-runs don't consume — they didn't actually use the
					// capability. Non-force pushes have no lease in play.
					const leaseConsumed =
						forceRequested &&
						result.dryRun !== true &&
						consumeLeaseIfOneShot(ws, "push-force");
					return jsonContent({
						status: result.dryRun === true ? "would_push" : "pushed",
						workspace: ws,
						snapshotCommit: result.commitSha,
						// Per-item proof of what landed on the bridge (modeled
						// on `git push --porcelain` per-ref outcome lines).
						// The AI can quote these names directly when telling
						// the human "I just pushed X, Y, Z" — no guessing.
						pushed: result.pushed,
						...(result.adoptedFromBridge !== undefined && {
							adoptedFromBridge: result.adoptedFromBridge,
						}),
						...(leaseConsumed && { leaseConsumed: true }),
						...(result.dryRun === true && {
							dryRun: true,
							hint:
								"This was a dry-run — the bridge, snapshot, and workspace were NOT touched. " +
								"Call plc_push without dryRun to actually send.",
						}),
					});
				}
				case "nothing_to_push":
					return jsonContent({
						status: "nothing_to_push",
						workspace: ws,
						hint: "Workspace matches the last pulled snapshot — no diff to apply.",
					});
				case "lease_stale":
				case "drift_detected":
					return jsonContent({
						status: "drift_detected",
						workspace: ws,
						localProjectVersion:
							result.status === "drift_detected"
								? result.localProjectVersion
								: result.expectedProjectVersion,
						bridgeProjectVersion: result.bridgeProjectVersion,
						incoming: result.incoming,
						hint:
							"The engineer (or another client) changed the IDE since your last pull. " +
							"STOP and surface this to the human. To absorb their changes you can call plc_pull; " +
							"to overwrite them the human must run `plc push --force` from the CLI themselves " +
							"(AI clients cannot force).",
					});
				case "rejected":
					return jsonContent({
						status: "rejected",
						workspace: ws,
						reason: result.reason,
					});
			}
		},
	);
}

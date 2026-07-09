/**
 * Bridge wire types + schemas — the HTTP shape every bridge daemon speaks (Beckhoff, CODESYS, …).
 * Protocol: git-inspired refs + atomic batched push. Schemas are the source of truth and are
 * `.parse()`-validated at the client boundary.
 *
 *   GET  /health  → liveness + stable identifiers (platform, projectName)
 *   GET  /refs    → project + per-item content versions (cheap, no payload)
 *   POST /fetch   → only items changed since the client's known versions
 *   POST /push    → atomic batch with per-item ifVersion guards (optimistic concurrency)
 *   POST /build   → build + diagnostics
 */
import { z } from "zod";

// ─── Wire-protocol version ──────────────────────────────────────────────────
// The HTTP wire-contract version this client speaks. Bump ONLY on an incompatible wire change, and bump the C#
// `WireProtocol.Version` in `Volt.Bridge.Core/Wire/HealthResponse.cs` to the SAME number — the two are kept in
// lockstep by `volt-scripts/check-volt-integration.ts`. Distinct from a bridge's display `version` string.
export const WIRE_VERSION = 1;

// ─── Progress (streamed on a long op's own response, NDJSON) ─────────────────
// When the client sends `Accept: application/x-ndjson`, /fetch·/push·/build stream `{progress}` frames then one
// terminal `{result}` (or `{error}`). `total` is absent for an indeterminate op (a build).
export const ProgressFrameSchema = z.object({
	operation: z.string(),
	done: z.number().int(),
	total: z.number().int().nullish(),
	phase: z.string().nullish(),
});
export type ProgressFrame = z.infer<typeof ProgressFrameSchema>;
export type ProgressHandler = (p: ProgressFrame) => void;

// ─── Health ───────────────────────────────────────────────────────────────
export const HealthResponseSchema = z
	.object({
		status: z.enum(["healthy", "degraded", "unavailable"]),
		// Optional so a pre-`wireVersion` bridge still parses; the client then treats "absent" as a mismatch
		// (PROTOCOL_MISMATCH) rather than a schema error.
		wireVersion: z.number().int().optional(),
		platform: z.string(),
		platformVariant: z.string().nullish(),
		connected: z.boolean(),
		ideAlive: z.boolean(),
		degraded: z.boolean(),
		degradedReason: z.string().nullish(),
		ideName: z.string().nullish(),
		ideVersion: z.string().nullish(),
		version: z.string(),
		projectName: z.string().nullish(),
		projectDirty: z.boolean().optional(),
	})
	.strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ─── Build ────────────────────────────────────────────────────────────────
export const BuildRequestSchema = z.object({ buildType: z.enum(["incremental", "full"]) });
export type BuildRequest = z.infer<typeof BuildRequestSchema>;

const OBJECT_RE = /^[^.]+(?:\.[^.]+)*$/;
export const BridgeDiagnosticSchema = z
	.object({
		severity: z.enum(["error", "warning", "info"]),
		message: z.string().min(1),
		line: z.number().int().nonnegative(),
		/** 1-based column; some bridges (live TC) supply it. 0/absent when not. */
		column: z.number().int().nullish(),
		object: z.string().regex(OBJECT_RE).nullish(),
		section: z.enum(["decl", "impl"]).nullish(),
	})
	.strict();
export type BridgeDiagnostic = z.infer<typeof BridgeDiagnosticSchema>;

export const BuildResponseSchema = z
	.object({
		success: z.boolean(),
		duration: z.number(),
		diagnostics: z.array(BridgeDiagnosticSchema),
	})
	.strict();
export type BuildResponse = z.infer<typeof BuildResponseSchema>;

// ─── Item content (used by /fetch and /push) ────────────────────────────────
// An item on the wire is one assembled file. Every writable source kind (POU/DUT/GVL/interface) is one
// kind-named file (.fb/.prg/.fun/.itf/.struct/.enum/.union/.alias/.gvl), including editable FBD/LD
// graphical bodies (materialized as VG text); only read-only CFC/SFC + reference manifests carry a
// distinct extension. The client sees each item's `sourceText` (ST, or VG for graphical bodies). The
// extension is part of `name` and drives access (rw source kinds vs r reference kinds).
export const FetchedItemSchema = z
	.object({
		name: z.string(),
		folder: z.string().optional(),
		sourceText: z.string(),
		version: z.string(),
	})
	.strict();
export type FetchedItem = z.infer<typeof FetchedItemSchema>;

// ─── /refs ──────────────────────────────────────────────────────────────────
export const RefsResponseSchema = z
	.object({
		projectVersion: z.string(),
		structureVersion: z.string(),
		items: z.record(z.string(), z.string()),
		folders: z.record(z.string(), z.string()),
	})
	.strict();
export type RefsResponse = z.infer<typeof RefsResponseSchema>;

// ─── /fetch ─────────────────────────────────────────────────────────────────
export const FetchRequestSchema = z.object({
	knownItems: z.record(z.string(), z.string()).optional(),
	onlyItems: z.array(z.string()).optional(),
});
export type FetchRequest = z.infer<typeof FetchRequestSchema>;

export const FetchResponseSchema = z
	.object({
		projectVersion: z.string(),
		structureVersion: z.string(),
		changed: z.array(FetchedItemSchema),
		removed: z.array(z.string()),
		items: z.record(z.string(), z.string()),
		folders: z.record(z.string(), z.string()),
	})
	.strict();
export type FetchResponse = z.infer<typeof FetchResponseSchema>;

// ─── /push ──────────────────────────────────────────────────────────────────
// One declarative `set` op per changed item: the item named `name` ends up as `toName ?? name`, in
// `toFolder ?? (current)`, with `sourceText ?? (current)`. Each absent = unchanged. ifVersion: null =
// create, string = update guard. `delete` is the one distinct verb. The whole batch validates + applies
// atomically against pre-batch state.
export const SetItemOpSchema = z.object({
	op: z.literal("set"),
	name: z.string(),
	toName: z.string().optional(),
	toFolder: z.string().optional(),
	sourceText: z.string().optional(),
	ifVersion: z.string().nullable(),
});
export type SetItemOp = z.infer<typeof SetItemOpSchema>;

export const DeleteItemOpSchema = z.object({
	op: z.literal("deleteItem"),
	name: z.string(),
	ifVersion: z.string(),
});
export type DeleteItemOp = z.infer<typeof DeleteItemOpSchema>;

export const PushOpSchema = z.discriminatedUnion("op", [SetItemOpSchema, DeleteItemOpSchema]);
export type PushOp = z.infer<typeof PushOpSchema>;

export const PushRequestSchema = z.object({
	ops: z.array(PushOpSchema),
	expectedProjectVersion: z.string().optional(),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export const PushConflictSchema = z
	.object({
		name: z.string(),
		yourVersion: z.string().nullable().optional(),
		currentVersion: z.string().nullable().optional(),
		reason: z.string(),
		code: z.string().nullish(),
		line: z.number().int().nullish(),
	})
	.strict();
export type PushConflict = z.infer<typeof PushConflictSchema>;

export const PushAcceptedSchema = z.object({
	accepted: z.literal(true),
	newProjectVersion: z.string(),
	newItems: z.record(z.string(), z.string()),
});
export type PushAccepted = z.infer<typeof PushAcceptedSchema>;

export const PushRejectedSchema = z
	.object({
		accepted: z.literal(false),
		conflicts: z.array(PushConflictSchema),
		currentProjectVersion: z.string(),
	})
	.passthrough();
export type PushRejected = z.infer<typeof PushRejectedSchema>;

export const PushResponseSchema = z.union([PushAcceptedSchema, PushRejectedSchema]);
export type PushResponse = z.infer<typeof PushResponseSchema>;

// ─── Remote surface ─────────────────────────────────────────────────────────
export type Remote = {
	readonly port: number;
	getHealth(): Promise<HealthResponse>;
	getRefs(): Promise<RefsResponse>;
	// onProgress (optional) opts into streamed progress; without it the call is the plain buffered request.
	fetchChanges(req: FetchRequest, onProgress?: ProgressHandler): Promise<FetchResponse>;
	pushBatch(req: PushRequest, onProgress?: ProgressHandler): Promise<PushResponse>;
	build(req: BuildRequest, onProgress?: ProgressHandler): Promise<BuildResponse>;
	/** Bootstrap: fetch every item with source text — equivalent to POST /init on the bridge. */
	init(onProgress?: ProgressHandler): Promise<FetchResponse>;
};

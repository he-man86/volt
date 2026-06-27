/**
 * Bridge wire types + schemas — the HTTP shape every bridge daemon speaks (Beckhoff, CODESYS, …).
 * Protocol: git-inspired refs + atomic batched push. Schemas are the source of truth and are
 * `.parse()`-validated at the client boundary. Verbatim contract copy from volt-cli.
 *
 *   GET  /health  → liveness + stable identifiers (platform, projectName, plcProjectName)
 *   GET  /refs    → project + per-item content versions (cheap, no payload)
 *   POST /fetch   → only items changed since the client's known versions
 *   POST /push    → atomic batch with per-item ifVersion guards (optimistic concurrency)
 *   POST /build   → build + diagnostics
 */
import { z } from "zod";

// ─── Health ───────────────────────────────────────────────────────────────
export const HealthResponseSchema = z
	.object({
		status: z.enum(["healthy", "degraded", "unavailable"]),
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
		plcProjectName: z.string().nullish(),
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
// An item on the wire is one assembled file (.st/.gvl/.itf/…). The bridge owns the POU↔children split
// and transpiles graphical bodies to ST; the client only ever sees plain ST `sourceText`. The extension
// is part of `name` and drives access (rw source vs r reference).
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
	})
	.strict();
export type FetchResponse = z.infer<typeof FetchResponseSchema>;

// ─── /push ──────────────────────────────────────────────────────────────────
// One op per affected file. ifVersion: pushItem null = create, string = update; delete/rename/move
// string = must match current. The whole batch validates atomically against pre-batch state.
export const PushItemOpSchema = z.object({
	op: z.literal("pushItem"),
	name: z.string(),
	folder: z.string().optional(),
	sourceText: z.string(),
	ifVersion: z.string().nullable(),
});
export type PushItemOp = z.infer<typeof PushItemOpSchema>;

export const DeleteItemOpSchema = z.object({
	op: z.literal("deleteItem"),
	name: z.string(),
	ifVersion: z.string(),
});
export type DeleteItemOp = z.infer<typeof DeleteItemOpSchema>;

export const RenameItemOpSchema = z.object({
	op: z.literal("renameItem"),
	name: z.string(),
	newName: z.string(),
	ifVersion: z.string(),
});
export type RenameItemOp = z.infer<typeof RenameItemOpSchema>;

export const MoveItemOpSchema = z.object({
	op: z.literal("moveItem"),
	name: z.string(),
	newFolder: z.string(),
	ifVersion: z.string(),
});
export type MoveItemOp = z.infer<typeof MoveItemOpSchema>;

export const PushOpSchema = z.discriminatedUnion("op", [
	PushItemOpSchema,
	DeleteItemOpSchema,
	RenameItemOpSchema,
	MoveItemOpSchema,
]);
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
	fetchChanges(req: FetchRequest): Promise<FetchResponse>;
	pushBatch(req: PushRequest): Promise<PushResponse>;
	build(req: BuildRequest): Promise<BuildResponse>;
};
